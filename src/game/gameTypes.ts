export type GameStatus =
  | "LOBBY"
  | "THEME_REVEAL"
  | "CHOOSING"
  | "LISTENING"
  | "VOTING"
  | "ROUND_RESULTS"
  | "GAME_RESULTS"
  | "GAME_SUMMARY";

export type ThemeType = "MUSIC" | "MOMENT" | "ALBUM";

export interface Theme {
  id: string;
  title: string;
  type: ThemeType;
  source: "SPOTIFY" | "YOUTUBE";
  sourceReference?: string;
  timestampRequired?: boolean;
  category?: string;
}

export type TotalRounds = 3 | 5 | 10;
export type ChoosingDurationSeconds = 180 | 360 | 540;
export interface GameSettings {
  totalRounds: TotalRounds;
  choosingDurationSeconds: ChoosingDurationSeconds;
}
export const DEFAULT_GAME_SETTINGS: GameSettings = {
  totalRounds: 10,
  choosingDurationSeconds: 180,
};
export const VALID_TOTAL_ROUNDS: readonly TotalRounds[] = [3, 5, 10];
export const VALID_CHOOSING_DURATIONS: readonly ChoosingDurationSeconds[] = [180, 360, 540];
export function normalizeGameSettings(settings?: Partial<GameSettings> | null): GameSettings {
  const totalRounds = VALID_TOTAL_ROUNDS.includes(settings?.totalRounds as TotalRounds)
    ? settings!.totalRounds as TotalRounds
    : DEFAULT_GAME_SETTINGS.totalRounds;
  const choosingDurationSeconds = VALID_CHOOSING_DURATIONS.includes(
    settings?.choosingDurationSeconds as ChoosingDurationSeconds,
  )
    ? settings!.choosingDurationSeconds as ChoosingDurationSeconds
    : DEFAULT_GAME_SETTINGS.choosingDurationSeconds;
  return { totalRounds, choosingDurationSeconds };
}
export const THEME_POOL_SIZE = 20;
export const CHOOSING_RECONNECT_GRACE_MS = 30 * 1000;
export const VOTING_DURATION_MS = 60 * 1000;

export type ThemeReaction = "like" | "dislike";
export type MediaSource = "SPOTIFY" | "YOUTUBE";
export type VoteReaction = "like" | "dislike";

export interface GameTheme {
  id: string;
  title: string;
  type: string;
  category?: string;
  example?: string;
  sourceReference?: { provider: string; resourceType: string; id: string };
}

export interface InternalGameState {
  round: number;
  totalRounds: number;
  phase: "THEME_SELECTION" | "CHOOSING" | "LISTENING" | "VOTING" | "ROUND_RESULTS";
  themePool: GameTheme[];
  themePoolIndex: number;
  playedThemeIds: string[];
  rejectedThemeIds: string[];
  currentTheme: GameTheme;
  reactions: Record<string, ThemeReaction>;
  submissions: Record<string, Submission>;
  submissionGroups: SubmissionGroup[];
  listeningIndex: number;
  votingEnabled: boolean;
  votes: Record<string, GroupVote>;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  roundParticipantIds: string[];
  cumulativeVotes: Record<string, { totalLikes: number; totalDislikes: number }>;
  lastConsolidatedRound: number;
  votingStartedAt: number | null;
  votingEndsAt: number | null;
  roundResult: RoundResultView | null;
  resultRevealStage: ResultRevealStage;
}

export interface PublicGameState {
  round: number;
  totalRounds: number;
  phase: InternalGameState["phase"];
  currentTheme: GameTheme;
  likes: number;
  dislikes: number;
  reactedPlayers: number;
  playersCount: number;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  submittedCount: number;
  waitingNextRoundCount: number;
  leaderboard: LeaderboardEntry[];
}

export interface LeaderboardEntry {
  playerId: string;
  username: string;
  totalLikes: number;
  totalDislikes: number;
  voteBalance: number;
  position: number;
}

export interface SubmissionInput {
  source: MediaSource;
  title: string;
  artist?: string;
  spotifyTrackId?: string;
  youtubeVideoId?: string;
  startTime?: number;
  thumbnail?: string;
}

export interface Submission extends SubmissionInput {
  submissionId: string;
  playerId: string;
  likes: number;
  dislikes: number;
}

export interface PublicMedia {
  source: MediaSource;
  title: string;
  artist?: string;
  spotifyTrackId?: string;
  youtubeVideoId?: string;
  startTime: number;
  thumbnail?: string;
  externalUrl: string;
}

export interface SubmissionGroup {
  groupId: string;
  mediaKey: string;
  submissions: Submission[];
  publicMedia: PublicMedia;
}

export interface PublicListeningState {
  theme: GameTheme;
  index: number;
  total: number;
  current: PublicMedia | null;
  finished: boolean;
  votingEnabled: boolean;
}

export interface VotingGroup {
  groupId: string;
  media: PublicMedia;
  canVote: boolean;
}

export interface VotingView {
  ownSubmission: PublicMedia | null;
  groups: VotingGroup[];
  hasVoted: boolean;
  canVote: boolean;
  votedPlayers: string[];
  eligiblePlayersCount: number;
  votingStartedAt: number;
  votingEndsAt: number;
}

export interface GroupVote {
  likedGroupId: string;
  dislikedGroupId: string;
}

export type ResultRevealStage = "AUTHORS" | "VOTES" | "RANKING";

export interface RoundRankingEntry {
  groupId: string;
  media: PublicMedia;
  authors: Array<{ playerId: string; username: string }>;
  likes: number;
  dislikes: number;
  voteBalance: number;
  position: number;
}

export interface RoundResultView {
  round: number;
  totalRounds: number;
  theme: GameTheme;
  revealStage: ResultRevealStage;
  ranking: RoundRankingEntry[];
  leaderboard: LeaderboardEntry[];
  isLastRound: boolean;
}
