import { Server, Socket } from "socket.io";
import RoomService from "../rooms/RoomService";
import { PlayerCredentials } from "../rooms/roomTypes";

export async function authenticateAndJoin(
  io: Server,
  socket: Socket,
  payload: Partial<PlayerCredentials>,
) {
  const { roomCode, playerId, playerToken } = payload;
  if (!roomCode || !playerId || !playerToken) {
    throw Object.assign(new Error("Missing player session"), {
      code: "MISSING_CREDENTIALS",
    });
  }
  const authenticated = await RoomService.authenticatePlayer(
    roomCode,
    playerId,
    playerToken,
  );
  socket.data.roomCode = authenticated.roomCode;
  socket.data.playerId = playerId;
  socket.join(authenticated.roomCode);
  const state = await RoomService.setPlayerConnected(
    authenticated.roomCode,
    playerId,
    true,
  );
  io.to(authenticated.roomCode).emit("room:state", state);
  return authenticated;
}
