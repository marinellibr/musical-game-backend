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
vi.mock("../src/repositories/MongoThemeRepository", () => ({
  default: class {
    async randomPool() {
      return Array.from({ length: 20 }, (_, index) => ({
        id: `theme_${index + 1}`,
        title: `Tema ${index + 1}`,
        type: "MUSIC",
      }));
    }
  },
}));
vi.mock("../src/integrations/spotify/spotifyClient", () => ({
  getSpotifyAlbumTracks: async () => ({ items: [{ id: "allowed-track" }] }),
}));

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

  it("starts the game when the host has at least two playing participants", async () => {
    const host = await RoomService.createRoom("Host", true);
    await RoomService.joinRoom(host.roomCode, "Bruno");

    const state = await RoomService.startGame(host.roomCode, host.player.playerId);

    expect(state.status).toBe("THEME_REVEAL");
  });

  it("does not start the game with fewer than two playing participants", async () => {
    const host = await RoomService.createRoom("Host", true);

    await expect(
      RoomService.startGame(host.roomCode, host.player.playerId),
    ).rejects.toMatchObject({ code: "NOT_ENOUGH_PLAYERS" });
  });

  it("records typed reactions and clears them when the host swaps the theme", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.startGame(host.roomCode, host.player.playerId);

    const reacted = await RoomService.reactToTheme(
      host.roomCode,
      player.player.playerId,
      "dislike",
    );
    expect(reacted.game).toMatchObject({ dislikes: 1, reactedPlayers: 1 });
    const firstThemeId = reacted.game?.currentTheme.id;

    const swapped = await RoomService.swapTheme(host.roomCode, host.player.playerId);
    expect(swapped.game).toMatchObject({ dislikes: 0, reactedPlayers: 0, round: 1 });
    expect(swapped.game?.currentTheme.id).not.toBe(firstThemeId);
  });

  it("lets only the host start a round and prevents starting it twice", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.startGame(host.roomCode, host.player.playerId);

    await expect(
      RoomService.startRound(host.roomCode, player.player.playerId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const started = await RoomService.startRound(host.roomCode, host.player.playerId);
    expect(started).toMatchObject({ status: "CHOOSING", game: { phase: "CHOOSING" } });
    await expect(
      RoomService.startRound(host.roomCode, host.player.playerId),
    ).rejects.toMatchObject({ code: "INVALID_PHASE" });
  });

  it("deduplicates playback and distributes grouped votes only to other players", async () => {
    const host = await RoomService.createRoom("Luiz", true);
    const pedro = await RoomService.joinRoom(host.roomCode, "Pedro");
    const ana = await RoomService.joinRoom(host.roomCode, "Ana");
    const joao = await RoomService.joinRoom(host.roomCode, "João");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    const midnight = { source: "SPOTIFY" as const, title: "Midnight City", artist: "M83", spotifyTrackId: "midnight" };
    await RoomService.submitChoice(host.roomCode, host.player.playerId, midnight);
    await RoomService.submitChoice(host.roomCode, pedro.player.playerId, midnight);
    await RoomService.submitChoice(host.roomCode, ana.player.playerId, midnight);
    await RoomService.submitChoice(host.roomCode, joao.player.playerId, { source: "SPOTIFY", title: "Nightcall", spotifyTrackId: "nightcall" });

    const listening = await RoomService.startListening(host.roomCode, host.player.playerId);
    expect(listening.total).toBe(2);
    await RoomService.moveListening(host.roomCode, host.player.playerId, "next");
    await RoomService.moveListening(host.roomCode, host.player.playerId, "next");
    await RoomService.startVoting(host.roomCode, host.player.playerId);

    const view = await RoomService.getVotingView(host.roomCode, host.player.playerId);
    expect(view?.ownSubmission?.title).toBe("Midnight City");
    expect(view?.groups.map((group) => group.media.title).sort()).toEqual(["Midnight City", "Nightcall"]);
    const midnightGroup = view?.groups.find((group) => group.media.title === "Midnight City");
    const nightcallGroup = view?.groups.find((group) => group.media.title === "Nightcall");
    await RoomService.submitVote(host.roomCode, host.player.playerId, {
      likedGroupId: midnightGroup!.groupId,
      dislikedGroupId: nightcallGroup!.groupId,
    });
    const persisted = JSON.parse(redisStore.get(`room:${host.roomCode}`)!) as {
      game: { submissions: Record<string, { likes: number; dislikes: number }> };
    };
    expect(persisted.game.submissions[host.player.playerId].likes).toBe(0);
    expect(persisted.game.submissions[pedro.player.playerId].likes).toBe(1);
    expect(persisted.game.submissions[ana.player.playerId].likes).toBe(1);
    expect(persisted.game.submissions[joao.player.playerId].dislikes).toBe(1);
    await RoomService.submitVote(host.roomCode, pedro.player.playerId, {
      likedGroupId: nightcallGroup!.groupId,
      dislikedGroupId: midnightGroup!.groupId,
    });
    const afterDislike = JSON.parse(redisStore.get(`room:${host.roomCode}`)!) as {
      game: { submissions: Record<string, { dislikes: number }> };
    };
    expect(afterDislike.game.submissions[host.player.playerId].dislikes).toBe(1);
    expect(afterDislike.game.submissions[pedro.player.playerId].dislikes).toBe(0);
    expect(afterDislike.game.submissions[ana.player.playerId].dislikes).toBe(1);
    const state = await RoomService.getVotingView(host.roomCode, host.player.playerId);
    expect(state?.hasVoted).toBe(true);
    await expect(RoomService.submitVote(host.roomCode, host.player.playerId, {
      likedGroupId: midnightGroup!.groupId,
      dislikedGroupId: nightcallGroup!.groupId,
    })).rejects.toMatchObject({ code: "ALREADY_VOTED" });
  });

  it("keeps a unique own submission out of that player's voting options", async () => {
    const host = await RoomService.createRoom("TV", false);
    const luiz = await RoomService.joinRoom(host.roomCode, "Luiz");
    const ana = await RoomService.joinRoom(host.roomCode, "Ana");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    await RoomService.submitChoice(host.roomCode, luiz.player.playerId, { source: "SPOTIFY", title: "Midnight City", spotifyTrackId: "midnight" });
    await RoomService.submitChoice(host.roomCode, ana.player.playerId, { source: "SPOTIFY", title: "Nightcall", spotifyTrackId: "nightcall" });
    await RoomService.startListening(host.roomCode, host.player.playerId);
    await RoomService.moveListening(host.roomCode, host.player.playerId, "next");
    await RoomService.moveListening(host.roomCode, host.player.playerId, "next");
    await RoomService.startVoting(host.roomCode, host.player.playerId);

    const luizView = await RoomService.getVotingView(host.roomCode, luiz.player.playerId);
    expect(luizView?.groups.map((group) => group.media.title)).toEqual(["Nightcall"]);
    const hostView = await RoomService.getVotingView(host.roomCode, host.player.playerId);
    expect(hostView).toMatchObject({ canVote: false, ownSubmission: null });
  });

  it("preserves listening and voting state for reconnects", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Player");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    const roomWithMoment = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    roomWithMoment.game.currentTheme.type = "MOMENT";
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(roomWithMoment));
    await RoomService.startRound(host.roomCode, host.player.playerId);
    await RoomService.submitChoice(host.roomCode, host.player.playerId, { source: "YOUTUBE", title: "Moment", youtubeVideoId: "abc123", startTime: 184 });
    await RoomService.submitChoice(host.roomCode, player.player.playerId, { source: "YOUTUBE", title: "Outro", youtubeVideoId: "def456", startTime: 0 });
    const before = await RoomService.startListening(host.roomCode, host.player.playerId);
    const restored = await RoomService.getListeningState(host.roomCode);
    expect(restored).toEqual(before);
  });

  it("keeps an active player reconnectable beyond 90 seconds during choosing", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Player");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    await RoomService.setPlayerConnected(host.roomCode, player.player.playerId, true);
    await RoomService.setPlayerConnected(host.roomCode, player.player.playerId, false);
    vi.advanceTimersByTime(120_000);
    await expect(RoomService.authenticatePlayer(host.roomCode, player.player.playerId, player.playerToken)).resolves.toMatchObject({ player: { playerId: player.player.playerId } });
  });

  it("marks late joins as waiting and blocks their submission", async () => {
    const host = await RoomService.createRoom("Host", true);
    await RoomService.joinRoom(host.roomCode, "Active");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    const late = await RoomService.joinRoom(host.roomCode, "Late");
    expect(late.player.participationStatus).toBe("WAITING_NEXT_ROUND");
    await expect(RoomService.submitChoice(host.roomCode, late.player.playerId, { source: "SPOTIFY", title: "Late song", spotifyTrackId: "late" })).rejects.toMatchObject({ code: "PLAYER_NOT_ACTIVE_THIS_ROUND" });
  });

  it("activates waiting players before the next round", async () => {
    const host = await RoomService.createRoom("Host", true);
    await RoomService.joinRoom(host.roomCode, "Active");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    const late = await RoomService.joinRoom(host.roomCode, "Late");
    const persisted = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    persisted.status = "ROUND_RESULTS";
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(persisted));
    const next = await RoomService.prepareNextRound(host.roomCode, host.player.playerId);
    expect(next.players.find((player) => player.playerId === late.player.playerId)?.participationStatus).toBe("ACTIVE");
  });

  it("allows only tracks from the configured album", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Player");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    const persisted = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    persisted.game.currentTheme.type = "ALBUM";
    persisted.game.currentTheme.sourceReference = { provider: "SPOTIFY", resourceType: "ALBUM", id: "album-1" };
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(persisted));
    await RoomService.startRound(host.roomCode, host.player.playerId);
    await expect(RoomService.submitChoice(host.roomCode, player.player.playerId, { source: "SPOTIFY", title: "Allowed", spotifyTrackId: "allowed-track" })).resolves.toMatchObject({ spotifyTrackId: "allowed-track" });
    await expect(RoomService.submitChoice(host.roomCode, player.player.playerId, { source: "SPOTIFY", title: "Blocked", spotifyTrackId: "other-track" })).rejects.toMatchObject({ code: "TRACK_NOT_IN_ALBUM" });
  });

  it("publishes only consolidated prior-round scores and excludes a host-only", async () => {
    const host = await RoomService.createRoom("TV", false);
    const luiz = await RoomService.joinRoom(host.roomCode, "Luiz");
    const carol = await RoomService.joinRoom(host.roomCode, "Carol");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    const persisted = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    persisted.status = "ROUND_RESULTS";
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(persisted));

    const scored = await RoomService.consolidateRoundScores(host.roomCode, {
      [host.player.playerId]: 100,
      [luiz.player.playerId]: 10,
      [carol.player.playerId]: 10,
    });
    expect(scored.game?.leaderboard).toEqual([
      { playerId: carol.player.playerId, username: "Carol", score: 10, position: 1 },
      { playerId: luiz.player.playerId, username: "Luiz", score: 10, position: 1 },
    ]);
    const repeated = await RoomService.consolidateRoundScores(host.roomCode, {
      [luiz.player.playerId]: 10,
    });
    expect(repeated.game?.leaderboard.find((entry) => entry.playerId === luiz.player.playerId)?.score).toBe(10);
  });
});
