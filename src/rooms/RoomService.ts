import logger from "pino";
import RedisRoomRepository from "../repositories/RedisRoomRepository";
import { generateId } from "../utils/ids";
import { Player, Room, RoomPublicState } from "./roomTypes";
import { PLAYER_RECONNECT_TTL_MS } from "../config/env";
import MongoThemeRepository from "../repositories/MongoThemeRepository";
import {
  THEME_POOL_SIZE,
  ThemeReaction,
  TOTAL_ROUNDS,
} from "../game/gameTypes";

const repo = new RedisRoomRepository();
const log = logger();
const themeRepo = new MongoThemeRepository();

export const MIN_PLAYERS_TO_START = 2;

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

  static async startGame(
    roomCode: string,
    requesterId: string,
  ): Promise<RoomPublicState> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    const requester = room.players[requesterId];
    if (!requester?.isHost) {
      throw Object.assign(new Error("Only the host can start the game"), {
        code: "FORBIDDEN",
      });
    }
    const playingCount = Object.values(room.players).filter(
      (player) => player.isPlaying,
    ).length;
    if (playingCount < MIN_PLAYERS_TO_START) {
      throw Object.assign(new Error("Not enough players to start the game"), {
        code: "NOT_ENOUGH_PLAYERS",
      });
    }
    if (room.status !== "LOBBY") {
      throw Object.assign(new Error("The game has already started"), {
        code: "GAME_ALREADY_STARTED",
      });
    }
    const themePool = await themeRepo.randomPool(THEME_POOL_SIZE);
    if (themePool.length < TOTAL_ROUNDS) {
      throw Object.assign(new Error("Not enough eligible themes"), {
        code: "NOT_ENOUGH_THEMES",
      });
    }
    room.game = {
      round: 1,
      totalRounds: TOTAL_ROUNDS,
      phase: "THEME_SELECTION",
      themePool,
      themePoolIndex: 0,
      playedThemeIds: [],
      rejectedThemeIds: [],
      currentTheme: themePool[0],
      reactions: {},
    };
    room.status = "THEME_REVEAL";
    await repo.saveRoom(normalizedCode, room);
    log.info({ roomCode: normalizedCode, requesterId }, "game started");
    return this.toPublicState(room);
  }

  static async reactToTheme(
    roomCode: string,
    playerId: string,
    reaction: ThemeReaction | null,
  ): Promise<RoomPublicState> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    if (!room.players[playerId]) throw roomNotFound();
    if (!room.game || room.game.phase !== "THEME_SELECTION") {
      throw Object.assign(new Error("Theme reactions are closed"), { code: "INVALID_PHASE" });
    }
    if (reaction) room.game.reactions[playerId] = reaction;
    else delete room.game.reactions[playerId];
    await repo.saveRoom(normalizedCode, room);
    return this.toPublicState(room);
  }

  static async swapTheme(roomCode: string, requesterId: string): Promise<RoomPublicState> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    if (!room.players[requesterId]?.isHost) {
      throw Object.assign(new Error("Only the host can swap themes"), { code: "FORBIDDEN" });
    }
    if (!room.game || room.game.phase !== "THEME_SELECTION") {
      throw Object.assign(new Error("Theme cannot be swapped now"), { code: "INVALID_PHASE" });
    }
    let nextIndex = room.game.themePoolIndex + 1;
    if (!room.game.themePool[nextIndex]) {
      const seenIds = [
        ...room.game.playedThemeIds,
        ...room.game.rejectedThemeIds,
        room.game.currentTheme.id,
      ];
      const extraThemes = await themeRepo.randomPool(THEME_POOL_SIZE, seenIds);
      if (extraThemes.length === 0) {
        throw Object.assign(new Error("Theme pool exhausted"), { code: "THEME_POOL_EXHAUSTED" });
      }
      room.game.themePool.push(...extraThemes);
      nextIndex = room.game.themePoolIndex + 1;
    }
    room.game.rejectedThemeIds.push(room.game.currentTheme.id);
    room.game.themePoolIndex = nextIndex;
    room.game.currentTheme = room.game.themePool[nextIndex];
    room.game.reactions = {};
    await repo.saveRoom(normalizedCode, room);
    return this.toPublicState(room);
  }

  static async startRound(roomCode: string, requesterId: string): Promise<RoomPublicState> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    if (!room.players[requesterId]?.isHost) {
      throw Object.assign(new Error("Only the host can start a round"), { code: "FORBIDDEN" });
    }
    if (!room.game || room.game.phase !== "THEME_SELECTION") {
      throw Object.assign(new Error("Round has already started"), { code: "INVALID_PHASE" });
    }
    room.game.playedThemeIds.push(room.game.currentTheme.id);
    room.game.phase = "PLAYING";
    room.status = "CHOOSING";
    await repo.saveRoom(normalizedCode, room);
    return this.toPublicState(room);
  }

  static async getPlayerThemeReaction(roomCode: string, playerId: string) {
    const room = await this.getRoomWithCleanup(this.normalizeRoomCode(roomCode));
    return room?.game?.reactions[playerId] ?? null;
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
      game: room.game
        ? {
            round: room.game.round,
            totalRounds: room.game.totalRounds,
            phase: room.game.phase,
            currentTheme: room.game.currentTheme,
            likes: Object.values(room.game.reactions).filter((value) => value === "like").length,
            dislikes: Object.values(room.game.reactions).filter((value) => value === "dislike").length,
            reactedPlayers: Object.keys(room.game.reactions).length,
            playersCount: Object.values(room.players).filter((player) => player.isPlaying).length,
          }
        : null,
    };
  }
}
