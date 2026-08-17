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
  socket.emit("theme:reaction", {
    themeId: state.game?.currentTheme.id,
    reaction: await RoomService.getPlayerThemeReaction(authenticated.roomCode, playerId),
  });
  const listening = await RoomService.getListeningState(authenticated.roomCode);
  if (listening) socket.emit("listening:state", listening);
  const voting = await RoomService.getVotingView(authenticated.roomCode, playerId);
  if (voting) socket.emit("voting:state", voting);
  const result = await RoomService.getRoundResult(authenticated.roomCode);
  if (result) {
    socket.emit("round:result", result);
    io.to(authenticated.roomCode).emit(
      "room:state",
      await RoomService.getPublicRoomState(authenticated.roomCode),
    );
  }
  if (await RoomService.hasPlayerSubmitted(authenticated.roomCode, playerId)) {
    socket.emit("submission:status", { submitted: true });
  }
  return authenticated;
}
