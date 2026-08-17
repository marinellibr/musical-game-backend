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

export type ThemeReaction = "like" | "dislike";

export interface GameTheme {
  id: string;
  title: string;
  type: string;
  category?: string;
}

export interface InternalGameState {
  round: number;
  totalRounds: number;
  phase: "THEME_SELECTION" | "PLAYING";
  themePool: GameTheme[];
  themePoolIndex: number;
  playedThemeIds: string[];
  rejectedThemeIds: string[];
  currentTheme: GameTheme;
  reactions: Record<string, ThemeReaction>;
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
}
