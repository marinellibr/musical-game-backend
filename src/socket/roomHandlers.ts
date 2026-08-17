import { Socket } from "socket.io";
import RoomService from "../rooms/RoomService";

const RoomHandlers = {
  async handleJoin(socket: Socket, payload: any) {
    const { roomCode, playerId, playerToken } = payload || {};
    if (!roomCode || !playerId || !playerToken)
      throw Object.assign(new Error("Missing credentials"), {
        code: "MISSING_CREDENTIALS",
      });
    // For now, just join the socket room and emit state
    socket.join(roomCode);
    const state = await RoomService.getPublicRoomState(roomCode);
    socket.emit("room:state", state);
    socket.to(roomCode).emit("room:state", state);
  },
};

export default RoomHandlers;
