import { getRedis } from "../config/redis";
import { generateId } from "../utils/ids";
import { generateRoomCode } from "../utils/roomCode";
import { env } from "../config/env";

const PREFIX = "room:";

export default class RedisRoomRepository {
  redis = getRedis();

  async createRoom(hostPlayer: any) {
    // ensure unique code
    for (let i = 0; i < 5; i++) {
      const code = generateRoomCode(4).toUpperCase();
      const key = PREFIX + code;
      const exists = await this.redis.exists(key);
      if (!exists) {
        const room = {
          roomCode: code,
          players: { [hostPlayer.playerId]: hostPlayer },
          host: hostPlayer.playerId,
          status: "LOBBY",
          sessionId: null,
          createdAt: Date.now(),
        };
        await this.redis.set(
          key,
          JSON.stringify(room),
          "EX",
          env.ROOM_TTL_SECONDS,
        );
        return room;
      }
    }
    throw new Error("UNABLE_TO_GENERATE_ROOM");
  }

  async getRoom(code: string) {
    const key = PREFIX + code;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async saveRoom(code: string, data: any) {
    const key = PREFIX + code;
    await this.redis.set(key, JSON.stringify(data), "EX", env.ROOM_TTL_SECONDS);
  }
}
