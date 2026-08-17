import RedisRoomRepository from "../repositories/RedisRoomRepository";
import { generateId } from "../utils/ids";

const repo = new RedisRoomRepository();

export default class RoomService {
  static async createRoom(username: string) {
    const playerId = generateId("player");
    const playerToken = generateId("token");
    const hostPlayer = {
      playerId,
      username,
      playerToken,
      isHost: true,
      connected: true,
    };
    const room = await repo.createRoom(hostPlayer);
    return { roomCode: room.roomCode, playerId, playerToken, isHost: true };
  }

  static async joinRoom(roomCode: string, username: string) {
    const room = await repo.getRoom(roomCode);
    if (!room)
      throw Object.assign(new Error("Room not found"), {
        code: "ROOM_NOT_FOUND",
      });
    // simple capacity limit 20
    const players = room.players || {};
    if (Object.keys(players).length >= 20)
      throw Object.assign(new Error("Room full"), { code: "ROOM_FULL" });
    const playerId = generateId("player");
    const playerToken = generateId("token");
    const player = {
      playerId,
      username,
      playerToken,
      isHost: false,
      connected: true,
    };
    players[playerId] = player;
    room.players = players;
    await repo.saveRoom(room.roomCode, room);
    return { roomCode: room.roomCode, playerId, playerToken, isHost: false };
  }

  static async getPublicRoomState(roomCode: string) {
    const room = await repo.getRoom(roomCode);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const players = Object.values(room.players || {}).map((p: any) => ({
      playerId: p.playerId,
      username: p.username,
      submitted: !!p.submission,
    }));
    return { roomCode: room.roomCode, players, status: room.status };
  }
}
