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
