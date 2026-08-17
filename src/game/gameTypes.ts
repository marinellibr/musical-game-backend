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

export const TOTAL_ROUNDS = 10;
export const THEME_POOL_SIZE = 20;
export const CHOOSING_DURATION_MS = 3 * 60 * 1000;
export const CHOOSING_RECONNECT_GRACE_MS = 30 * 1000;

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
  phase: "THEME_SELECTION" | "CHOOSING" | "LISTENING" | "VOTING";
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
}

export interface GroupVote {
  likedGroupId: string;
  dislikedGroupId: string;
}
