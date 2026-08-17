import logger from "pino";
import RedisRoomRepository from "../repositories/RedisRoomRepository";
import { generateId } from "../utils/ids";
import { Player, Room, RoomPublicState } from "./roomTypes";
import { PLAYER_RECONNECT_TTL_MS } from "../config/env";

const repo = new RedisRoomRepository();
const log = logger();

function roomNotFound() {
  return Object.assign(new Error("Room not found"), { code: "ROOM_NOT_FOUND" });
}

function publicPlayer(player: Player) {
  return {
    playerId: player.playerId,
    username: player.username,
    isHost: player.isHost,
    isPlaying: player.isPlaying,
    connected: player.connected,
  };
}

export default class RoomService {
  static normalizeRoomCode(roomCode: string) {
    return roomCode.replace(/\s+/g, "").toUpperCase();
  }

  static async createRoom(username: string, isPlaying = true) {
    const playerId = generateId("player");
    const playerToken = generateId("token");
    const hostPlayer: Player = {
      playerId,
      playerToken,
      username: username.trim(),
      isHost: true,
      isPlaying,
      connected: false,
      disconnectedAt: null,
      lastSeenAt: Date.now(),
    };
    const room = await repo.createRoom(hostPlayer);
    log.info({ roomCode: room.roomCode, playerId }, "room created");
    return { roomCode: room.roomCode, player: publicPlayer(hostPlayer), playerToken };
  }

  static async joinRoom(roomCode: string, username: string) {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    if (Object.keys(room.players).length >= 20) {
      throw Object.assign(new Error("Room full"), { code: "ROOM_FULL" });
    }
    const playerId = generateId("player");
    const playerToken = generateId("token");
    const player: Player = {
      playerId,
      playerToken,
      username: username.trim(),
      isHost: false,
      isPlaying: true,
      connected: false,
      disconnectedAt: null,
      lastSeenAt: Date.now(),
    };
    room.players[playerId] = player;
    await repo.saveRoom(normalizedCode, room);
    log.info({ roomCode: normalizedCode, playerId }, "player joined");
    return { roomCode: normalizedCode, player: publicPlayer(player), playerToken };
  }

  static async authenticatePlayer(roomCode: string, playerId: string, playerToken: string) {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    const player = room.players[playerId];
    if (!player) {
      const reason = await repo.getInvalidSessionReason(normalizedCode, playerId);
      if (reason === "expired") {
        throw Object.assign(new Error("Player session expired"), {
          code: "PLAYER_SESSION_EXPIRED",
        });
      }
      if (reason === "removed") {
        throw Object.assign(new Error("Player was removed"), {
          code: "PLAYER_REMOVED",
        });
      }
      throw Object.assign(new Error("Invalid player session"), {
        code: "INVALID_PLAYER_SESSION",
      });
    }
    if (
      !player.connected &&
      player.disconnectedAt !== null &&
      Date.now() - player.disconnectedAt > PLAYER_RECONNECT_TTL_MS
    ) {
      if (player.isHost) {
        player.playerToken = "";
      } else {
        delete room.players[playerId];
      }
      await Promise.all([
        repo.saveRoom(normalizedCode, room),
        repo.markSessionInvalid(normalizedCode, playerId, "expired"),
      ]);
      throw Object.assign(new Error("Player session expired"), {
        code: "PLAYER_SESSION_EXPIRED",
      });
    }
    if (player.playerToken !== playerToken) {
      throw Object.assign(new Error("Invalid player session"), {
        code: "INVALID_PLAYER_SESSION",
      });
    }
    return { roomCode: normalizedCode, player };
  }

  static async setPlayerConnected(
    roomCode: string,
    playerId: string,
    connected: boolean,
  ): Promise<RoomPublicState> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    const player = room.players[playerId];
    if (!player) throw roomNotFound();
    player.connected = connected;
    player.disconnectedAt = connected ? null : Date.now();
    player.lastSeenAt = Date.now();
    await repo.saveRoom(normalizedCode, room);
    return this.toPublicState(room);
  }

  static async getPublicRoomState(roomCode: string): Promise<RoomPublicState> {
    const room = await this.getRoomWithCleanup(this.normalizeRoomCode(roomCode));
    if (!room) throw roomNotFound();
    return this.toPublicState(room);
  }

  static async removePlayer(
    roomCode: string,
    requesterId: string,
    targetPlayerId: string,
  ): Promise<RoomPublicState> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    const requester = room.players[requesterId];
    if (!requester?.isHost) {
      throw Object.assign(new Error("Only the host can remove players"), {
        code: "FORBIDDEN",
      });
    }
    const target = room.players[targetPlayerId];
    if (!target) {
      throw Object.assign(new Error("Player not found"), {
        code: "PLAYER_NOT_FOUND",
      });
    }
    if (target.isHost || target.playerId === requesterId) {
      throw Object.assign(new Error("The host cannot be removed"), {
        code: "FORBIDDEN",
      });
    }
    delete room.players[targetPlayerId];
    await Promise.all([
      repo.saveRoom(normalizedCode, room),
      repo.markSessionInvalid(normalizedCode, targetPlayerId, "removed"),
    ]);
    log.info(
      { roomCode: normalizedCode, requesterId, targetPlayerId },
      "player removed",
    );
    return this.toPublicState(room);
  }

  static async cleanupExpiredPlayers(roomCode: string): Promise<RoomPublicState> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    return this.toPublicState(room);
  }

  private static async getRoomWithCleanup(roomCode: string): Promise<Room | null> {
    const room = await repo.getRoom(roomCode);
    if (!room) return null;
    const now = Date.now();
    const expired = Object.values(room.players).filter(
      (player) =>
        !player.isHost &&
        !player.connected &&
        player.disconnectedAt !== null &&
        now - player.disconnectedAt > PLAYER_RECONNECT_TTL_MS,
    );
    if (expired.length === 0) return room;
    for (const player of expired) delete room.players[player.playerId];
    await Promise.all([
      repo.saveRoom(roomCode, room),
      ...expired.map((player) =>
        repo.markSessionInvalid(roomCode, player.playerId, "expired"),
      ),
    ]);
    log.info(
      { roomCode, playerIds: expired.map((player) => player.playerId) },
      "expired player sessions removed",
    );
    return room;
  }

  private static toPublicState(room: Room): RoomPublicState {
    const host = room.players[room.host];
    if (!host) throw new Error("Room host not found");
    return {
      roomCode: room.roomCode,
      status: room.status,
      host: publicPlayer(host),
      players: Object.values(room.players)
        .filter((player) => !player.isHost)
        .map(publicPlayer),
    };
  }
}
