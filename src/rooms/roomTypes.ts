export interface Player {
  playerId: string;
  playerToken: string;
  username: string;
  isHost: boolean;
  isPlaying: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  lastSeenAt: number;
  participationStatus: "ACTIVE" | "WAITING_NEXT_ROUND";
}

export interface Room {
  roomCode: string;
  players: Record<string, Player>;
  host: string;
  status: "LOBBY" | string;
  sessionId: string | null;
  settings: GameSettings;
  createdAt: number;
  game: InternalGameState | null;
}

export interface PublicPlayer {
  playerId: string;
  username: string;
  isHost: boolean;
  isPlaying: boolean;
  connected: boolean;
  participationStatus: "ACTIVE" | "WAITING_NEXT_ROUND";
}

export interface RoomPublicState {
  roomCode: string;
  sessionId: string | null;
  status: string;
  host: PublicPlayer;
  players: PublicPlayer[];
  settings: GameSettings;
  game: PublicGameState | null;
}

export interface PlayerCredentials {
  roomCode: string;
  playerId: string;
  playerToken: string;
}
import { GameSettings, InternalGameState, PublicGameState } from "../game/gameTypes";
