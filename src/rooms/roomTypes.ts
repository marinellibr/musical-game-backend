export interface Player {
  playerId: string;
  playerToken: string;
  username: string;
  isHost: boolean;
  isPlaying: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  lastSeenAt: number;
}

export interface Room {
  roomCode: string;
  players: Record<string, Player>;
  host: string;
  status: "LOBBY" | string;
  sessionId: string | null;
  createdAt: number;
}

export interface PublicPlayer {
  playerId: string;
  username: string;
  isHost: boolean;
  isPlaying: boolean;
  connected: boolean;
}

export interface RoomPublicState {
  roomCode: string;
  status: string;
  host: PublicPlayer;
  players: PublicPlayer[];
}

export interface PlayerCredentials {
  roomCode: string;
  playerId: string;
  playerToken: string;
}
