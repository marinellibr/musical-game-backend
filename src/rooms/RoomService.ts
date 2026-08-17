import logger from "pino";
import RedisRoomRepository from "../repositories/RedisRoomRepository";
import { generateId } from "../utils/ids";
import { Player, Room, RoomPublicState } from "./roomTypes";

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
      lastSeenAt: Date.now(),
    };
    const room = await repo.createRoom(hostPlayer);
    log.info({ roomCode: room.roomCode, playerId }, "room created");
    return { roomCode: room.roomCode, player: publicPlayer(hostPlayer), playerToken };
  }

  static async joinRoom(roomCode: string, username: string) {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await repo.getRoom(normalizedCode);
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
      lastSeenAt: Date.now(),
    };
    room.players[playerId] = player;
    await repo.saveRoom(normalizedCode, room);
    log.info({ roomCode: normalizedCode, playerId }, "player joined");
    return { roomCode: normalizedCode, player: publicPlayer(player), playerToken };
  }

  static async authenticatePlayer(roomCode: string, playerId: string, playerToken: string) {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await repo.getRoom(normalizedCode);
    if (!room) throw roomNotFound();
    const player = room.players[playerId];
    if (!player || player.playerToken !== playerToken) {
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
    const room = await repo.getRoom(normalizedCode);
    if (!room) throw roomNotFound();
    const player = room.players[playerId];
    if (!player) throw roomNotFound();
    player.connected = connected;
    player.lastSeenAt = Date.now();
    await repo.saveRoom(normalizedCode, room);
    return this.toPublicState(room);
  }

  static async getPublicRoomState(roomCode: string): Promise<RoomPublicState> {
    const room = await repo.getRoom(this.normalizeRoomCode(roomCode));
    if (!room) throw roomNotFound();
    return this.toPublicState(room);
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
