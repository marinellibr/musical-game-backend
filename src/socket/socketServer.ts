import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { env } from "../config/env";
import logger from "pino";
import RoomHandlers from "./roomHandlers";

const log = logger();

export function initSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, { cors: { origin: env.FRONTEND_ORIGIN } });
  io.on("connection", (socket: Socket) => {
    log.info({ id: socket.id }, "socket connected");

    socket.on("room:join", async (payload) => {
      try {
        await RoomHandlers.handleJoin(socket, payload);
      } catch (err: any) {
        socket.emit("room:error", {
          code: err.code || "JOIN_FAILED",
          message: err.message,
        });
      }
    });

    socket.on("disconnect", () => {
      log.info({ id: socket.id }, "socket disconnected");
    });
  });
  return io;
}
