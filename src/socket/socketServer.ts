import { Server as HttpServer } from "http";
import logger from "pino";
import { Server, Socket } from "socket.io";
import { corsOrigins } from "../config/env";
import RoomService from "../rooms/RoomService";
import { authenticateAndJoin } from "./roomHandlers";

const log = logger();

function socketError(socket: Socket, error: unknown) {
  const typed = error as { code?: string; message?: string };
  socket.emit("room:error", {
    code: typed.code || "ROOM_CONNECTION_FAILED",
    message: typed.message || "Unable to connect to room",
  });
}

export function initSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, { cors: { origin: corsOrigins } });
  const connections = new Map<string, number>();

  const connectPlayer = async (socket: Socket, payload: Record<string, unknown>) => {
    if (socket.data.presenceKey) return;
    const authenticated = await authenticateAndJoin(io, socket, payload);
    const key = `${authenticated.roomCode}:${authenticated.player.playerId}`;
    socket.data.presenceKey = key;
    connections.set(key, (connections.get(key) || 0) + 1);
    log.info(
      { roomCode: authenticated.roomCode, playerId: authenticated.player.playerId },
      "player reconnected",
    );
  };

  io.on("connection", (socket: Socket) => {
    log.info({ id: socket.id }, "socket connected");
    const auth = socket.handshake.auth as Record<string, unknown>;
    if (auth.roomCode || auth.playerId || auth.playerToken) {
      connectPlayer(socket, auth).catch((error) => socketError(socket, error));
    }
    socket.on("room:join", (payload: Record<string, unknown>) => {
      connectPlayer(socket, payload || {}).catch((error) => socketError(socket, error));
    });
    socket.on("disconnect", async () => {
      log.info({ id: socket.id }, "socket disconnected");
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      const key = socket.data.presenceKey as string | undefined;
      if (!roomCode || !playerId || !key) return;
      const remaining = Math.max((connections.get(key) || 1) - 1, 0);
      if (remaining > 0) {
        connections.set(key, remaining);
        return;
      }
      connections.delete(key);
      try {
        const state = await RoomService.setPlayerConnected(roomCode, playerId, false);
        io.to(roomCode).emit("room:state", state);
      } catch (error) {
        if ((error as { code?: string }).code !== "ROOM_NOT_FOUND") {
          log.error({ roomCode, playerId }, "failed to update player presence");
        }
      }
    });
  });
  return io;
}
