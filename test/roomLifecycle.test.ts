import { beforeEach, describe, expect, it, vi } from "vitest";

const redisStore = vi.hoisted(() => new Map<string, string>());
const fakeRedis = vi.hoisted(() => ({
  async exists(key: string) {
    return redisStore.has(key) ? 1 : 0;
  },
  async get(key: string) {
    return redisStore.get(key) ?? null;
  },
  async set(key: string, value: string) {
    redisStore.set(key, value);
    return "OK";
  },
}));

vi.mock("../src/config/redis", () => ({ getRedis: () => fakeRedis }));

import RoomService from "../src/rooms/RoomService";

describe("room player lifecycle", () => {
  beforeEach(() => {
    redisStore.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00Z"));
  });

  it("reconnects the same player inside the 90-second window", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.setPlayerConnected(host.roomCode, player.player.playerId, true);
    await RoomService.setPlayerConnected(host.roomCode, player.player.playerId, false);

    vi.advanceTimersByTime(89_000);
    const authenticated = await RoomService.authenticatePlayer(
      host.roomCode,
      player.player.playerId,
      player.playerToken,
    );

    expect(authenticated.player.playerId).toBe(player.player.playerId);
    expect((await RoomService.getPublicRoomState(host.roomCode)).players).toHaveLength(1);
  });

  it("expires and removes a disconnected player after 90 seconds", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Carol");
    await RoomService.setPlayerConnected(host.roomCode, player.player.playerId, true);
    await RoomService.setPlayerConnected(host.roomCode, player.player.playerId, false);

    vi.advanceTimersByTime(91_000);
    await expect(
      RoomService.authenticatePlayer(
        host.roomCode,
        player.player.playerId,
        player.playerToken,
      ),
    ).rejects.toMatchObject({ code: "PLAYER_SESSION_EXPIRED" });
    expect((await RoomService.getPublicRoomState(host.roomCode)).players).toHaveLength(0);
  });

  it("allows the host to remove a player and invalidates that session", async () => {
    const host = await RoomService.createRoom("TV", false);
    const player = await RoomService.joinRoom(host.roomCode, "Bruno");

    const state = await RoomService.removePlayer(
      host.roomCode,
      host.player.playerId,
      player.player.playerId,
    );

    expect(state.players).toHaveLength(0);
    await expect(
      RoomService.authenticatePlayer(
        host.roomCode,
        player.player.playerId,
        player.playerToken,
      ),
    ).rejects.toMatchObject({ code: "PLAYER_REMOVED" });
  });

  it("rejects removal by a non-host and keeps the target", async () => {
    const host = await RoomService.createRoom("Host", true);
    const bruno = await RoomService.joinRoom(host.roomCode, "Bruno");
    const carol = await RoomService.joinRoom(host.roomCode, "Carol");

    await expect(
      RoomService.removePlayer(
        host.roomCode,
        bruno.player.playerId,
        carol.player.playerId,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await RoomService.getPublicRoomState(host.roomCode)).players).toHaveLength(2);
  });
});
