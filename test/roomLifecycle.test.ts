import { beforeEach, describe, expect, it, vi } from "vitest";

const redisStore = vi.hoisted(() => new Map<string, string>());
const mongoCreates = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const mongoUpdates = vi.hoisted(() => [] as Array<{ sessionId: string; patch: Record<string, unknown> }>);
const mongoFinalizations = vi.hoisted(() => [] as Array<{ sessionId: string; snapshot: Record<string, unknown> }>);
const finalizationFailure = vi.hoisted(() => ({ enabled: false }));
const redisSets = vi.hoisted(() => [] as Array<unknown[]>);
const fakeRedis = vi.hoisted(() => ({
  async exists(key: string) {
    return redisStore.has(key) ? 1 : 0;
  },
  async get(key: string) {
    return redisStore.get(key) ?? null;
  },
  async set(key: string, value: string, ...args: unknown[]) {
    redisStore.set(key, value);
    redisSets.push([key, ...args]);
    return "OK";
  },
}));

vi.mock("../src/config/redis", () => ({ getRedis: () => fakeRedis }));
vi.mock("../src/repositories/MongoThemeRepository", () => ({
  default: class {
    async listCategories() {
      return ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"].map((id) => ({ id, label: id, description: id, examples: [{ id: `${id}_1`, title: `${id} 1` }] }));
    }
    async balancedPool(categories: string[], size: number) {
      const capacity = categories.length === 2 && categories.includes("COVERS") ? 7 : categories.length * 5;
      return Array.from({ length: Math.min(size, capacity) }, (_, index) => ({
        id: `${categories[index % categories.length]}_${Math.floor(index / categories.length)}`,
        title: `Tema ${index + 1}`,
        type: "MUSIC",
        category: categories[index % categories.length],
      }));
    }
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
vi.mock("../src/repositories/MongoSessionRepository", () => ({
  default: class {
    async create(session: Record<string, unknown>) { mongoCreates.push(session); return null; }
    async update(sessionId: string, patch: Record<string, unknown>) { mongoUpdates.push({ sessionId, patch }); return null; }
    async finalize(sessionId: string, snapshot: Record<string, unknown>) { if (finalizationFailure.enabled) throw new Error("mongo unavailable"); mongoFinalizations.push({ sessionId, snapshot }); return { sessionId, ...snapshot }; }
    async findResult() { return null; }
  },
}));

import RoomService from "../src/rooms/RoomService";

describe("room player lifecycle", () => {
  beforeEach(() => {
    redisStore.clear();
    mongoCreates.length = 0;
    mongoUpdates.length = 0;
    mongoFinalizations.length = 0;
    redisSets.length = 0;
    finalizationFailure.enabled = false;
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

  it("starts the game when the host has at least three playing participants", async () => {
    const host = await RoomService.createRoom("Host", true);
    await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.joinRoom(host.roomCode, "Carol");

    const state = await RoomService.startGame(host.roomCode, host.player.playerId);

    expect(state.status).toBe("THEME_REVEAL");
  });

  it("configures categories from real availability and balances the preselected pool", async () => {
    const host = await RoomService.createRoom("Host", true);
    const bruno = await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.joinRoom(host.roomCode, "Carol");
    const initial = await RoomService.getPublicRoomState(host.roomCode);
    expect(initial).toMatchObject({ settings: { selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] } });
    await expect(RoomService.updateSettings(host.roomCode, bruno.player.playerId, { ...initial.settings, selectedCategories: ["INSTRUMENTS", "ALBUM"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(RoomService.updateSettings(host.roomCode, host.player.playerId, { ...initial.settings, selectedCategories: ["INSTRUMENTS"] })).rejects.toMatchObject({ code: "MIN_CATEGORIES_REQUIRED" });
    await expect(RoomService.updateSettings(host.roomCode, host.player.playerId, { ...initial.settings, selectedCategories: ["INSTRUMENTS", "INVALID"] })).rejects.toMatchObject({ code: "INVALID_CATEGORY" });
    await RoomService.updateSettings(host.roomCode, host.player.playerId, { ...initial.settings, totalRounds: 10, selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] });
    await RoomService.startGame(host.roomCode, host.player.playerId);
    const stored = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    const firstTen = stored.game.themePool.slice(0, 10);
    expect(new Set(firstTen.map((theme: { id: string }) => theme.id)).size).toBe(10);
    const counts = firstTen.reduce((result: Record<string, number>, theme: { category: string }) => ({ ...result, [theme.category]: (result[theme.category] || 0) + 1 }), {});
    expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBeLessThanOrEqual(1);
    expect(mongoCreates.at(-1)).toMatchObject({ settings: { selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] } });
    stored.status = "GAME_RESULTS";
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(stored));
    const replay = await RoomService.restartGame(host.roomCode, host.player.playerId);
    expect(replay).toMatchObject({ status: "LOBBY", settings: { selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] } });
    expect(mongoCreates.at(-1)).toMatchObject({ settings: { selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] } });
  });

  it("rejects a category combination with an insufficient distinct theme pool", async () => {
    const host = await RoomService.createRoom("Host", true);
    await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.joinRoom(host.roomCode, "Carol");
    const state = await RoomService.getPublicRoomState(host.roomCode);
    await RoomService.updateSettings(host.roomCode, host.player.playerId, { ...state.settings, totalRounds: 10, selectedCategories: ["INSTRUMENTS", "COVERS"] });
    await expect(RoomService.startGame(host.roomCode, host.player.playerId)).rejects.toMatchObject({ code: "NOT_ENOUGH_THEMES" });
    expect((await RoomService.getPublicRoomState(host.roomCode)).status).toBe("LOBBY");
  });

  it("uses typed lobby settings and blocks non-host updates", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.joinRoom(host.roomCode, "Carol");
    expect((await RoomService.getPublicRoomState(host.roomCode)).settings).toEqual({ totalRounds: 10, choosingDurationSeconds: 180, selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] });

    await expect(RoomService.updateSettings(host.roomCode, player.player.playerId, { totalRounds: 5, choosingDurationSeconds: 360, selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const updated = await RoomService.updateSettings(host.roomCode, host.player.playerId, { totalRounds: 5, choosingDurationSeconds: 360, selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] });
    expect(updated.settings).toEqual({ totalRounds: 5, choosingDurationSeconds: 360, selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] });
    await RoomService.startGame(host.roomCode, host.player.playerId);
    const choosing = await RoomService.startRound(host.roomCode, host.player.playerId);
    expect(choosing.game?.totalRounds).toBe(5);
    expect((choosing.game?.roundEndsAt || 0) - (choosing.game?.roundStartedAt || 0)).toBe(360_000);
    expect(mongoCreates[0]).toMatchObject({ status: "ACTIVE", settings: { totalRounds: 5, choosingDurationSeconds: 360 } });
  });

  it("restarts into the same room with a new session and inherited settings", async () => {
    const host = await RoomService.createRoom("TV", false);
    const player = await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.joinRoom(host.roomCode, "Carol");
    await RoomService.joinRoom(host.roomCode, "Rafa");
    await RoomService.updateSettings(host.roomCode, host.player.playerId, { totalRounds: 3, choosingDurationSeconds: 540, selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] });
    await RoomService.startGame(host.roomCode, host.player.playerId);
    const before = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    const previousSessionId = before.sessionId as string;
    before.status = "GAME_RESULTS";
    before.players[player.player.playerId].participationStatus = "WAITING_NEXT_ROUND";
    before.game.cumulativeVotes[player.player.playerId] = { totalLikes: 4, totalDislikes: 1 };
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(before));

    const restarted = await RoomService.restartGame(host.roomCode, host.player.playerId);
    const after = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    expect(restarted).toMatchObject({ roomCode: host.roomCode, status: "LOBBY", game: null, settings: { totalRounds: 3, choosingDurationSeconds: 540 } });
    expect(after.sessionId).not.toBe(previousSessionId);
    expect(after.players[player.player.playerId]).toMatchObject({ playerId: player.player.playerId, playerToken: player.playerToken, participationStatus: "ACTIVE" });
    expect(mongoUpdates.some((item) => item.sessionId === previousSessionId)).toBe(true);
    expect(mongoCreates.at(-1)).toMatchObject({ roomCode: host.roomCode, status: "LOBBY", settings: { totalRounds: 3, choosingDurationSeconds: 540 }, rounds: [] });
    const edited = await RoomService.updateSettings(host.roomCode, host.player.playerId, { totalRounds: 10, choosingDurationSeconds: 180, selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] });
    expect(edited.settings).toEqual({ totalRounds: 10, choosingDurationSeconds: 180, selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] });
    await expect(RoomService.restartGame(host.roomCode, host.player.playerId)).rejects.toMatchObject({ code: "INVALID_PHASE" });
  });

  it("ends the game at the configured final round", async () => {
    const host = await RoomService.createRoom("Host", true);
    await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.joinRoom(host.roomCode, "Carol");
    await RoomService.updateSettings(host.roomCode, host.player.playerId, { totalRounds: 3, choosingDurationSeconds: 180, selectedCategories: ["INSTRUMENTS", "ALBUM", "HOT_TAKE", "COVERS"] });
    await RoomService.startGame(host.roomCode, host.player.playerId);
    const stored = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    stored.status = "ROUND_RESULTS";
    stored.game.round = 3;
    stored.game.totalRounds = 3;
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(stored));
    const finished = await RoomService.prepareNextRound(host.roomCode, host.player.playerId);
    expect(finished.status).toBe("GAME_RESULTS");
    expect(mongoFinalizations).toHaveLength(1);
  });

  it("consolidates a final snapshot once, keeps retry possible on Mongo failure, and applies the finished TTL", async () => {
    const host = await RoomService.createRoom("Host", true);
    await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.joinRoom(host.roomCode, "Carol");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    const stored = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    stored.status = "ROUND_RESULTS";
    stored.game.round = stored.game.totalRounds;
    stored.game.historicalRounds = [];
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(stored));

    finalizationFailure.enabled = true;
    await expect(RoomService.prepareNextRound(host.roomCode, host.player.playerId)).rejects.toThrow("mongo unavailable");
    expect(JSON.parse(redisStore.get(`room:${host.roomCode}`)!).status).toBe("ROUND_RESULTS");
    expect(mongoFinalizations).toHaveLength(0);

    finalizationFailure.enabled = false;
    const finished = await RoomService.prepareNextRound(host.roomCode, host.player.playerId);
    expect(finished.status).toBe("GAME_RESULTS");
    expect(mongoFinalizations).toHaveLength(1);
    expect(mongoFinalizations[0].snapshot).toMatchObject({ analysis: { analysisVersion: 1 }, rounds: [], finalRanking: [] });
    expect(redisSets.at(-1)).toEqual([`room:${host.roomCode}`, "EX", 14_400]);

    await RoomService.prepareNextRound(host.roomCode, host.player.playerId);
    expect(mongoFinalizations).toHaveLength(1);
  });

  it("does not start the game with fewer than three playing participants", async () => {
    const host = await RoomService.createRoom("Host", true);
    await RoomService.joinRoom(host.roomCode, "Bruno");

    await expect(
      RoomService.startGame(host.roomCode, host.player.playerId),
    ).rejects.toMatchObject({ code: "NOT_ENOUGH_PLAYERS" });
  });

  it("records typed reactions and clears them when the host swaps the theme", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.joinRoom(host.roomCode, "Carol");
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
    await RoomService.joinRoom(host.roomCode, "Carol");
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
    await RoomService.setListeningReady(host.roomCode, pedro.player.playerId, true);
    const votingEndsAt = await RoomService.startVoting(host.roomCode, host.player.playerId);
    expect(votingEndsAt - Date.now()).toBe(60_000);

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
    vi.advanceTimersByTime(60_000);
    const result = await RoomService.closeVoting(host.roomCode);
    expect(result).toMatchObject({ revealStage: "AUTHORS", round: 1 });
    expect(result?.ranking).toHaveLength(2);
    expect(await RoomService.closeVoting(host.roomCode)).toEqual(result);
    expect(await RoomService.getRoundResult(host.roomCode)).toEqual(result);
  });

  it("keeps a unique own submission out of that player's voting options", async () => {
    const host = await RoomService.createRoom("TV", false);
    const luiz = await RoomService.joinRoom(host.roomCode, "Luiz");
    const ana = await RoomService.joinRoom(host.roomCode, "Ana");
    const rafa = await RoomService.joinRoom(host.roomCode, "Rafa");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    await RoomService.submitChoice(host.roomCode, luiz.player.playerId, { source: "SPOTIFY", title: "Midnight City", spotifyTrackId: "midnight" });
    await RoomService.submitChoice(host.roomCode, ana.player.playerId, { source: "SPOTIFY", title: "Nightcall", spotifyTrackId: "nightcall" });
    await RoomService.submitChoice(host.roomCode, rafa.player.playerId, { source: "SPOTIFY", title: "Nightcall", spotifyTrackId: "nightcall" });
    await RoomService.startListening(host.roomCode, host.player.playerId);
    await RoomService.setListeningReady(host.roomCode, luiz.player.playerId, true);
    await RoomService.startVoting(host.roomCode, host.player.playerId);

    const luizView = await RoomService.getVotingView(host.roomCode, luiz.player.playerId);
    expect(luizView?.groups.map((group) => group.media.title)).toEqual(["Nightcall"]);
    const hostView = await RoomService.getVotingView(host.roomCode, host.player.playerId);
    expect(hostView).toMatchObject({ canVote: true, ownSubmission: null, eligiblePlayersCount: 4 });
  });

  it("preserves listening and voting state for reconnects", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Player");
    const carol = await RoomService.joinRoom(host.roomCode, "Carol");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    const roomWithMoment = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    roomWithMoment.game.currentTheme.type = "MOMENT";
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(roomWithMoment));
    await RoomService.startRound(host.roomCode, host.player.playerId);
    await RoomService.submitChoice(host.roomCode, host.player.playerId, { source: "YOUTUBE", title: "Moment", youtubeVideoId: "abc123", startTime: 184 });
    await RoomService.submitChoice(host.roomCode, player.player.playerId, { source: "YOUTUBE", title: "Outro", youtubeVideoId: "def456", startTime: 0 });
    await RoomService.submitChoice(host.roomCode, carol.player.playerId, { source: "YOUTUBE", title: "Outro", youtubeVideoId: "def456", startTime: 0 });
    const before = await RoomService.startListening(host.roomCode, host.player.playerId);
    const restored = await RoomService.getListeningState(host.roomCode);
    expect(restored).toEqual(before);
  });

  it("keeps listening authoritative and gates voting with non-host readiness", async () => {
    const host = await RoomService.createRoom("Host", true);
    const carol = await RoomService.joinRoom(host.roomCode, "Carol");
    const bruno = await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    await RoomService.submitChoice(host.roomCode, host.player.playerId, { source: "SPOTIFY", title: "Host song", artist: "Host artist", spotifyTrackId: "host-track" });
    await RoomService.submitChoice(host.roomCode, carol.player.playerId, { source: "SPOTIFY", title: "Carol song", artist: "Carol artist", spotifyTrackId: "carol-track" });
    await RoomService.submitChoice(host.roomCode, bruno.player.playerId, { source: "SPOTIFY", title: "Bruno song", artist: "Bruno artist", spotifyTrackId: "bruno-track" });
    expect(await RoomService.getPublicRoomState(host.roomCode)).toMatchObject({ status: "LISTENING", game: { phase: "LISTENING", submittedCount: 3 } });

    const initial = await RoomService.startListening(host.roomCode, host.player.playerId);
    expect(initial).toMatchObject({ index: 0, total: 3, finished: false, readyCount: 0, eligibleReadyCount: 2, canStartVoting: false });
    expect(initial.items).toHaveLength(3);
    expect(initial.current).toMatchObject({ title: expect.any(String), artist: expect.any(String) });
    await expect(RoomService.moveListening(host.roomCode, carol.player.playerId, "next")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(RoomService.moveListening(host.roomCode, host.player.playerId, "next")).rejects.toMatchObject({ code: "LOCAL_LISTENING_NAVIGATION" });
    await expect(RoomService.startVoting(host.roomCode, host.player.playerId)).rejects.toMatchObject({ code: "LISTENING_READY_REQUIRED" });
    await expect(RoomService.setListeningReady(host.roomCode, host.player.playerId, true)).rejects.toMatchObject({ code: "PLAYER_NOT_ACTIVE_THIS_ROUND" });

    const ready = await RoomService.setListeningReady(host.roomCode, carol.player.playerId, true);
    expect(ready).toMatchObject({ readyCount: 1, eligibleReadyCount: 2, canStartVoting: true });
    expect(ready.readyPlayers).toEqual(expect.arrayContaining([{ playerId: carol.player.playerId, username: "Carol", ready: true }]));
    expect((JSON.parse(redisStore.get(`room:${host.roomCode}`)!).game.listeningReadyPlayerIds)).toContain(carol.player.playerId);
    expect(await RoomService.getListeningState(host.roomCode)).toEqual(ready);

    const unready = await RoomService.setListeningReady(host.roomCode, carol.player.playerId, false);
    expect(unready).toMatchObject({ readyCount: 0, canStartVoting: false });
    await RoomService.setListeningReady(host.roomCode, bruno.player.playerId, true);
    await RoomService.setListeningReady(host.roomCode, carol.player.playerId, true);
    const automaticallyStarted = await RoomService.getPublicRoomState(host.roomCode);
    expect(automaticallyStarted).toMatchObject({ status: "VOTING", game: { phase: "VOTING" } });
    const votingView = await RoomService.getVotingView(host.roomCode, carol.player.playerId);
    expect((votingView?.votingEndsAt || 0) - Date.now()).toBe(60_000);
  });

  it("allows the host to start voting when there are zero eligible non-host players", async () => {
    const host = await RoomService.createRoom("Host", true);
    const carol = await RoomService.joinRoom(host.roomCode, "Carol");
    const bruno = await RoomService.joinRoom(host.roomCode, "Bruno");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    await RoomService.submitChoice(host.roomCode, host.player.playerId, { source: "SPOTIFY", title: "Only song", spotifyTrackId: "only-track" });
    const persisted = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    persisted.game.roundParticipantIds = [host.player.playerId];
    persisted.players[carol.player.playerId].participationStatus = "WAITING_NEXT_ROUND";
    persisted.players[bruno.player.playerId].participationStatus = "WAITING_NEXT_ROUND";
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(persisted));
    const listening = await RoomService.startListening(host.roomCode, host.player.playerId);
    expect(listening).toMatchObject({ finished: false, eligibleReadyCount: 0, canStartVoting: true });
    await expect(RoomService.setListeningReady(host.roomCode, carol.player.playerId, true)).rejects.toMatchObject({ code: "PLAYER_NOT_ACTIVE_THIS_ROUND" });
    await expect(RoomService.startVoting(host.roomCode, carol.player.playerId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(RoomService.startVoting(host.roomCode, host.player.playerId)).resolves.toBe(Date.now() + 60_000);
  });

  it("keeps an active player reconnectable beyond 90 seconds during choosing", async () => {
    const host = await RoomService.createRoom("Host", true);
    const player = await RoomService.joinRoom(host.roomCode, "Player");
    await RoomService.joinRoom(host.roomCode, "Carol");
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
    await RoomService.joinRoom(host.roomCode, "Carol");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    const late = await RoomService.joinRoom(host.roomCode, "Late");
    expect(late.player.participationStatus).toBe("WAITING_NEXT_ROUND");
    await expect(RoomService.submitChoice(host.roomCode, late.player.playerId, { source: "SPOTIFY", title: "Late song", spotifyTrackId: "late" })).rejects.toMatchObject({ code: "PLAYER_NOT_ACTIVE_THIS_ROUND" });
  });

  it("activates waiting players before the next round", async () => {
    const host = await RoomService.createRoom("Host", true);
    await RoomService.joinRoom(host.roomCode, "Active");
    await RoomService.joinRoom(host.roomCode, "Carol");
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
    await RoomService.joinRoom(host.roomCode, "Carol");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    const persisted = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    persisted.game.currentTheme.type = "ALBUM";
    persisted.game.currentTheme.sourceReference = { provider: "SPOTIFY", resourceType: "ALBUM", id: "album-1" };
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(persisted));
    await RoomService.startRound(host.roomCode, host.player.playerId);
    await expect(RoomService.submitChoice(host.roomCode, player.player.playerId, { source: "SPOTIFY", title: "Allowed", spotifyTrackId: "allowed-track" })).resolves.toMatchObject({ spotifyTrackId: "allowed-track" });
    await expect(RoomService.submitChoice(host.roomCode, player.player.playerId, { source: "SPOTIFY", title: "Blocked", spotifyTrackId: "other-track" })).rejects.toMatchObject({ code: "TRACK_NOT_IN_ALBUM" });
  });

  it("publishes the cumulative vote balance with ties and excludes a host-only", async () => {
    const host = await RoomService.createRoom("TV", false);
    const luiz = await RoomService.joinRoom(host.roomCode, "Luiz");
    const carol = await RoomService.joinRoom(host.roomCode, "Carol");
    await RoomService.joinRoom(host.roomCode, "Rafa");
    await RoomService.startGame(host.roomCode, host.player.playerId);
    await RoomService.startRound(host.roomCode, host.player.playerId);
    const persisted = JSON.parse(redisStore.get(`room:${host.roomCode}`)!);
    persisted.game.cumulativeVotes = {
      [host.player.playerId]: { totalLikes: 100, totalDislikes: 0 },
      [luiz.player.playerId]: { totalLikes: 12, totalDislikes: 2 },
      [carol.player.playerId]: { totalLikes: 11, totalDislikes: 1 },
    };
    redisStore.set(`room:${host.roomCode}`, JSON.stringify(persisted));

    const state = await RoomService.getPublicRoomState(host.roomCode);
    expect(state.game?.leaderboard).toEqual([
      { playerId: luiz.player.playerId, username: "Luiz", totalLikes: 12, totalDislikes: 2, voteBalance: 10, position: 1 },
      { playerId: carol.player.playerId, username: "Carol", totalLikes: 11, totalDislikes: 1, voteBalance: 10, position: 2 },
    ]);
  });
});
