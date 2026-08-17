import logger from "pino";
import RedisRoomRepository from "../repositories/RedisRoomRepository";
import { generateId } from "../utils/ids";
import { getSpotifyAlbumTracks } from "../integrations/spotify/spotifyClient";
import { Player, Room, RoomPublicState } from "./roomTypes";
import { PLAYER_RECONNECT_TTL_MS } from "../config/env";
import MongoThemeRepository from "../repositories/MongoThemeRepository";
import {
  THEME_POOL_SIZE,
  ThemeReaction,
  TOTAL_ROUNDS,
  GroupVote,
  PublicListeningState,
  Submission,
  SubmissionGroup,
  SubmissionInput,
  VotingView,
  CHOOSING_DURATION_MS,
  CHOOSING_RECONNECT_GRACE_MS,
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
    participationStatus: player.participationStatus || "ACTIVE",
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
      participationStatus: "ACTIVE",
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
      participationStatus: room.status === "LOBBY" ? "ACTIVE" : "WAITING_NEXT_ROUND",
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
      this.isReconnectExpired(room, player.disconnectedAt)
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
      submissions: {},
      submissionGroups: [],
      listeningIndex: 0,
      votingEnabled: true,
      votes: {},
      roundStartedAt: null,
      roundEndsAt: null,
      roundParticipantIds: [],
      consolidatedScores: {},
      lastScoredRound: 0,
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
    room.game.phase = "CHOOSING";
    room.game.roundStartedAt = Date.now();
    room.game.roundEndsAt = room.game.roundStartedAt + CHOOSING_DURATION_MS;
    room.game.roundParticipantIds = Object.values(room.players)
      .filter((player) => player.isPlaying && (player.participationStatus || "ACTIVE") === "ACTIVE")
      .map((player) => player.playerId);
    room.status = "CHOOSING";
    await repo.saveRoom(normalizedCode, room);
    return this.toPublicState(room);
  }

  static async submitChoice(roomCode: string, playerId: string, input: SubmissionInput) {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    const player = room.players[playerId];
    if (!player?.isPlaying || (player.participationStatus || "ACTIVE") !== "ACTIVE" || !room.game?.roundParticipantIds.includes(playerId)) throw Object.assign(new Error("Player is not active this round"), { code: "PLAYER_NOT_ACTIVE_THIS_ROUND" });
    if (!room.game || room.status !== "CHOOSING") throw Object.assign(new Error("Submissions are closed"), { code: "INVALID_PHASE" });
    if (!room.game.roundEndsAt || Date.now() >= room.game.roundEndsAt) throw Object.assign(new Error("Submission time has ended"), { code: "SUBMISSIONS_CLOSED" });
    this.validateSubmission(input, room.game.currentTheme.type);
    if (room.game.currentTheme.type === "ALBUM") {
      const albumId = room.game.currentTheme.sourceReference?.id;
      if (!albumId) throw Object.assign(new Error("Theme album is not configured"), { code: "INVALID_THEME" });
      const albumTracks = await getSpotifyAlbumTracks(albumId);
      if (!albumTracks.items?.some((track) => track.id === input.spotifyTrackId)) {
        throw Object.assign(new Error("Track does not belong to the theme album"), { code: "TRACK_NOT_IN_ALBUM" });
      }
    }
    const submission: Submission = {
      ...input,
      startTime: input.startTime ?? 0,
      submissionId: generateId("submission"),
      playerId,
      likes: 0,
      dislikes: 0,
    };
    room.game.submissions[playerId] = submission;
    await repo.saveRoom(normalizedCode, room);
    return submission;
  }

  static async startListening(roomCode: string, requesterId: string): Promise<PublicListeningState> {
    const room = await this.requireHostPhase(roomCode, requesterId, "CHOOSING");
    if (!room.game) throw new Error("Game state missing");
    const playingIds = room.game.roundParticipantIds;
    if (Date.now() < (room.game.roundEndsAt || 0) && playingIds.some((id) => !room.game?.submissions[id])) {
      throw Object.assign(new Error("Waiting for player submissions"), { code: "SUBMISSIONS_PENDING" });
    }
    room.game.submissionGroups = this.shuffleGroups(this.groupSubmissions(Object.values(room.game.submissions)));
    room.game.listeningIndex = 0;
    room.game.phase = "LISTENING";
    room.status = "LISTENING";
    await repo.saveRoom(room.roomCode, room);
    return this.toListeningState(room);
  }

  static async moveListening(roomCode: string, requesterId: string, direction: "next" | "previous") {
    const room = await this.requireHostPhase(roomCode, requesterId, "LISTENING");
    if (!room.game) throw new Error("Game state missing");
    const maxIndex = room.game.submissionGroups.length;
    room.game.listeningIndex = direction === "next"
      ? Math.min(room.game.listeningIndex + 1, maxIndex)
      : Math.max(room.game.listeningIndex - 1, 0);
    await repo.saveRoom(room.roomCode, room);
    return this.toListeningState(room);
  }

  static async getListeningState(roomCode: string): Promise<PublicListeningState | null> {
    const room = await this.getRoomWithCleanup(this.normalizeRoomCode(roomCode));
    return room?.game && room.status === "LISTENING" ? this.toListeningState(room) : null;
  }

  static async hasPlayerSubmitted(roomCode: string, playerId: string): Promise<boolean> {
    const room = await this.getRoomWithCleanup(this.normalizeRoomCode(roomCode));
    return Boolean(room?.game?.submissions[playerId]);
  }

  static async startVoting(roomCode: string, requesterId: string): Promise<void> {
    const room = await this.requireHostPhase(roomCode, requesterId, "LISTENING");
    if (!room.game) throw new Error("Game state missing");
    if (room.game.listeningIndex < room.game.submissionGroups.length) {
      throw Object.assign(new Error("Listening is not finished"), { code: "LISTENING_NOT_FINISHED" });
    }
    room.game.phase = "VOTING";
    room.status = "VOTING";
    await repo.saveRoom(room.roomCode, room);
  }

  static async getVotingView(roomCode: string, playerId: string): Promise<VotingView | null> {
    const room = await this.getRoomWithCleanup(this.normalizeRoomCode(roomCode));
    if (!room?.game || room.status !== "VOTING") return null;
    const player = room.players[playerId];
    if (!player) throw roomNotFound();
    const own = room.game.submissions[playerId];
    return {
      ownSubmission: own ? this.toPublicMedia(own) : null,
      groups: room.game.submissionGroups
        .filter((group) => group.submissions.some((submission) => submission.playerId !== playerId))
        .map((group) => ({ groupId: group.groupId, media: group.publicMedia, canVote: player.isPlaying })),
      hasVoted: Boolean(room.game.votes[playerId]),
      canVote: player.isPlaying && room.game.roundParticipantIds.includes(playerId),
      votedPlayers: player.isHost ? Object.keys(room.game.votes) : [],
      eligiblePlayersCount: room.game.roundParticipantIds.length,
    };
  }

  static async submitVote(roomCode: string, playerId: string, vote: GroupVote): Promise<void> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room?.game || room.status !== "VOTING") throw Object.assign(new Error("Voting is closed"), { code: "INVALID_PHASE" });
    if (!room.players[playerId]?.isPlaying || !room.game.roundParticipantIds.includes(playerId)) throw Object.assign(new Error("Player is not active this round"), { code: "PLAYER_NOT_ACTIVE_THIS_ROUND" });
    if (room.game.votes[playerId]) throw Object.assign(new Error("Player already voted"), { code: "ALREADY_VOTED" });
    if (vote.likedGroupId === vote.dislikedGroupId) throw Object.assign(new Error("Votes must target different groups"), { code: "INVALID_VOTE" });
    const liked = room.game.submissionGroups.find((group) => group.groupId === vote.likedGroupId);
    const disliked = room.game.submissionGroups.find((group) => group.groupId === vote.dislikedGroupId);
    const eligible = (group?: SubmissionGroup) => group?.submissions.filter((submission) => submission.playerId !== playerId) ?? [];
    const likedSubmissions = eligible(liked);
    const dislikedSubmissions = eligible(disliked);
    if (!liked || !disliked || likedSubmissions.length === 0 || dislikedSubmissions.length === 0) {
      throw Object.assign(new Error("Vote group is not eligible"), { code: "INVALID_VOTE" });
    }
    const canonicalSubmissions = Object.values(room.game.submissions);
    const applyVote = (submissions: Submission[], reaction: "likes" | "dislikes") => {
      for (const groupedSubmission of submissions) {
        const canonical = canonicalSubmissions.find(
          (submission) => submission.submissionId === groupedSubmission.submissionId,
        );
        if (canonical) canonical[reaction] += 1;
      }
    };
    applyVote(likedSubmissions, "likes");
    applyVote(dislikedSubmissions, "dislikes");
    room.game.votes[playerId] = vote;
    await repo.saveRoom(normalizedCode, room);
  }

  private static validateSubmission(input: SubmissionInput, themeType: string): void {
    const spotify = input.source === "SPOTIFY" && Boolean(input.spotifyTrackId);
    const youtube = input.source === "YOUTUBE" && Boolean(input.youtubeVideoId);
    const sourceMatchesTheme =
      ((themeType === "MUSIC" || themeType === "ALBUM") && spotify) ||
      ((themeType === "MOMENT" || themeType === "YT_NOTIME") && youtube);
    if (!input.title.trim() || !sourceMatchesTheme || (themeType === "MOMENT" && input.startTime === undefined)) {
      throw Object.assign(new Error("Invalid submission"), { code: "INVALID_PAYLOAD" });
    }
  }

  private static mediaKey(submission: Submission): string {
    return submission.source === "SPOTIFY"
      ? `spotify:track:${submission.spotifyTrackId}`
      : `youtube:${submission.youtubeVideoId}:${submission.startTime ?? 0}`;
  }

  private static toPublicMedia(submission: Submission) {
    const startTime = submission.startTime ?? 0;
    return {
      source: submission.source,
      title: submission.title,
      ...(submission.artist ? { artist: submission.artist } : {}),
      ...(submission.spotifyTrackId ? { spotifyTrackId: submission.spotifyTrackId } : {}),
      ...(submission.youtubeVideoId ? { youtubeVideoId: submission.youtubeVideoId } : {}),
      startTime,
      ...(submission.thumbnail ? { thumbnail: submission.thumbnail } : {}),
      externalUrl: submission.source === "SPOTIFY"
        ? `https://open.spotify.com/track/${submission.spotifyTrackId}`
        : `https://www.youtube.com/watch?v=${submission.youtubeVideoId}&t=${startTime}s`,
    };
  }

  private static groupSubmissions(submissions: Submission[]): SubmissionGroup[] {
    const groups = new Map<string, SubmissionGroup>();
    for (const submission of submissions) {
      const mediaKey = this.mediaKey(submission);
      const group = groups.get(mediaKey);
      if (group) group.submissions.push(submission);
      else groups.set(mediaKey, { groupId: generateId("group"), mediaKey, submissions: [submission], publicMedia: this.toPublicMedia(submission) });
    }
    return [...groups.values()];
  }

  private static shuffleGroups(groups: SubmissionGroup[]): SubmissionGroup[] {
    for (let index = groups.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [groups[index], groups[target]] = [groups[target], groups[index]];
    }
    return groups;
  }

  private static toListeningState(room: Room): PublicListeningState {
    if (!room.game) throw new Error("Game state missing");
    const group = room.game.submissionGroups[room.game.listeningIndex];
    return { theme: room.game.currentTheme, index: room.game.listeningIndex, total: room.game.submissionGroups.length, current: group?.publicMedia ?? null, finished: room.game.listeningIndex >= room.game.submissionGroups.length, votingEnabled: room.game.votingEnabled };
  }

  private static async requireHostPhase(roomCode: string, requesterId: string, status: string): Promise<Room> {
    const room = await this.getRoomWithCleanup(this.normalizeRoomCode(roomCode));
    if (!room) throw roomNotFound();
    if (!room.players[requesterId]?.isHost) throw Object.assign(new Error("Host only action"), { code: "FORBIDDEN" });
    if (room.status !== status) throw Object.assign(new Error("Invalid game phase"), { code: "INVALID_PHASE" });
    return room;
  }

  static async getPlayerThemeReaction(roomCode: string, playerId: string) {
    const room = await this.getRoomWithCleanup(this.normalizeRoomCode(roomCode));
    return room?.game?.reactions[playerId] ?? null;
  }

  static async prepareNextRound(roomCode: string, requesterId: string): Promise<RoomPublicState> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    if (!room.players[requesterId]?.isHost) throw Object.assign(new Error("Host only action"), { code: "FORBIDDEN" });
    if (!room.game || room.status !== "ROUND_RESULTS") throw Object.assign(new Error("Invalid game phase"), { code: "INVALID_PHASE" });
    const nextTheme = room.game.themePool[room.game.themePoolIndex + 1];
    if (!nextTheme) throw Object.assign(new Error("Theme pool exhausted"), { code: "THEME_POOL_EXHAUSTED" });
    Object.values(room.players).forEach((player) => { if (player.participationStatus === "WAITING_NEXT_ROUND") player.participationStatus = "ACTIVE"; });
    room.game.round += 1; room.game.themePoolIndex += 1; room.game.currentTheme = nextTheme; room.game.phase = "THEME_SELECTION"; room.game.reactions = {}; room.game.submissions = {}; room.game.submissionGroups = []; room.game.votes = {}; room.game.roundStartedAt = null; room.game.roundEndsAt = null; room.game.roundParticipantIds = [];
    room.status = "THEME_REVEAL";
    await repo.saveRoom(normalizedCode, room);
    return this.toPublicState(room);
  }

  static async consolidateRoundScores(
    roomCode: string,
    roundScores: Readonly<Record<string, number>>,
  ): Promise<RoomPublicState> {
    const normalizedCode = this.normalizeRoomCode(roomCode);
    const room = await this.getRoomWithCleanup(normalizedCode);
    if (!room) throw roomNotFound();
    if (!room.game || room.status !== "ROUND_RESULTS") {
      throw Object.assign(new Error("Scores can only be consolidated after round results"), { code: "INVALID_PHASE" });
    }
    room.game.consolidatedScores ||= {};
    room.game.lastScoredRound ||= 0;
    if (room.game.lastScoredRound >= room.game.round) return this.toPublicState(room);
    for (const playerId of room.game.roundParticipantIds) {
      const player = room.players[playerId];
      if (!player?.isPlaying) continue;
      const points = roundScores[playerId] ?? 0;
      if (!Number.isFinite(points) || points < 0) {
        throw Object.assign(new Error("Invalid round score"), { code: "INVALID_SCORE" });
      }
      room.game.consolidatedScores[playerId] =
        (room.game.consolidatedScores[playerId] || 0) + points;
    }
    room.game.lastScoredRound = room.game.round;
    await repo.saveRoom(normalizedCode, room);
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
        this.isReconnectExpired(room, player.disconnectedAt, now),
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
            playersCount: room.game.roundParticipantIds.length || Object.values(room.players).filter((player) => player.isPlaying && (player.participationStatus || "ACTIVE") === "ACTIVE").length,
            roundStartedAt: room.game.roundStartedAt,
            roundEndsAt: room.game.roundEndsAt,
            submittedCount: room.game.roundParticipantIds.filter((id) => Boolean(room.game?.submissions[id])).length,
            waitingNextRoundCount: Object.values(room.players).filter((player) => player.participationStatus === "WAITING_NEXT_ROUND").length,
            leaderboard: this.toLeaderboard(room),
          }
        : null,
    };
  }

  private static isReconnectExpired(room: Room, disconnectedAt: number, now = Date.now()): boolean {
    if (room.status === "CHOOSING" && room.game?.roundEndsAt) {
      return now > room.game.roundEndsAt + CHOOSING_RECONNECT_GRACE_MS;
    }
    return now - disconnectedAt > PLAYER_RECONNECT_TTL_MS;
  }

  private static toLeaderboard(room: Room) {
    if (!room.game) return [];
    const entries = Object.entries(room.game.consolidatedScores || {})
      .map(([playerId, score]) => ({ playerId, score, player: room.players[playerId] }))
      .filter((entry) => entry.player?.isPlaying)
      .sort((a, b) => b.score - a.score || a.player.username.localeCompare(b.player.username, "pt-BR"));
    let previousScore: number | null = null;
    let position = 0;
    return entries.map((entry, index) => {
      if (entry.score !== previousScore) position = index + 1;
      previousScore = entry.score;
      return { playerId: entry.playerId, username: entry.player.username, score: entry.score, position };
    });
  }
}
