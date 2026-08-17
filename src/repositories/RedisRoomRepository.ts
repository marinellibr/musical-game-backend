import { getRedis } from "../config/redis";
import { env } from "../config/env";
import { Player, Room } from "../rooms/roomTypes";
import { generateRoomCode } from "../utils/roomCode";

const PREFIX = "room:";
const SESSION_PREFIX = "room-session:";

export type InvalidSessionReason = "expired" | "removed";

export default class RedisRoomRepository {
  private readonly redis = getRedis();

  async createRoom(hostPlayer: Player): Promise<Room> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateRoomCode(4).toUpperCase();
      const key = PREFIX + code;
      if (!(await this.redis.exists(key))) {
        const room: Room = {
          roomCode: code,
          players: { [hostPlayer.playerId]: hostPlayer },
          host: hostPlayer.playerId,
          status: "LOBBY",
          sessionId: null,
          createdAt: Date.now(),
        };
        await this.redis.set(key, JSON.stringify(room), "EX", env.ROOM_TTL_SECONDS);
        return room;
      }
    }
    throw Object.assign(new Error("Unable to generate a room code"), {
      code: "UNABLE_TO_GENERATE_ROOM",
    });
  }

  async getRoom(code: string): Promise<Room | null> {
    const raw = await this.redis.get(PREFIX + code);
    return raw ? (JSON.parse(raw) as Room) : null;
  }

  async saveRoom(code: string, data: Room): Promise<void> {
    await this.redis.set(
      PREFIX + code,
      JSON.stringify(data),
      "EX",
      env.ROOM_TTL_SECONDS,
    );
  }

  async markSessionInvalid(
    roomCode: string,
    playerId: string,
    reason: InvalidSessionReason,
  ): Promise<void> {
    await this.redis.set(
      `${SESSION_PREFIX}${roomCode}:${playerId}`,
      reason,
      "EX",
      env.ROOM_TTL_SECONDS,
    );
  }

  async getInvalidSessionReason(
    roomCode: string,
    playerId: string,
  ): Promise<InvalidSessionReason | null> {
    return (await this.redis.get(
      `${SESSION_PREFIX}${roomCode}:${playerId}`,
    )) as InvalidSessionReason | null;
  }
}
