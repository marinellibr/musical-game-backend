export interface PlayerInfo {
  playerId: string;
  username: string;
  isHost?: boolean;
  connected?: boolean;
}

export interface RoomPublicState {
  roomCode: string;
  players: Array<{ playerId: string; username: string; submitted?: boolean }>;
  status: string;
}
