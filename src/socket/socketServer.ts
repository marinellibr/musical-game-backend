import { Server as HttpServer } from "http";
import logger from "pino";
import { Server, Socket } from "socket.io";
import { corsOrigins, PLAYER_RECONNECT_TTL_MS } from "../config/env";
import RoomService from "../rooms/RoomService";
import { authenticateAndJoin } from "./roomHandlers";
import { GameSettings, ThemeReaction } from "../game/gameTypes";
import { GroupVote, SubmissionInput } from "../game/gameTypes";

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
  const roomActions = new Map<string, Promise<void>>();

  const runRoomAction = (roomCode: string, action: () => Promise<void>) => {
    const previous = roomActions.get(roomCode) || Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    roomActions.set(roomCode, current);
    void current.then(
      () => { if (roomActions.get(roomCode) === current) roomActions.delete(roomCode); },
      () => { if (roomActions.get(roomCode) === current) roomActions.delete(roomCode); },
    );
    return current;
  };

  const emitVotingViews = async (roomCode: string) => {
    const roomSockets = await io.in(roomCode).fetchSockets();
    await Promise.all(roomSockets.map(async (target) => {
      const playerId = target.data.playerId as string | undefined;
      if (playerId) target.emit("voting:state", await RoomService.getVotingView(roomCode, playerId));
    }));
  };

  const emitRoundResult = async (roomCode: string, force = false) => {
    const result = await RoomService.closeVoting(roomCode, force);
    if (!result) return false;
    io.to(roomCode).emit("round:result", result);
    io.to(roomCode).emit("room:state", await RoomService.getPublicRoomState(roomCode));
    return true;
  };

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
    socket.on("player:remove", async (payload: { playerId?: string }) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId || !payload?.playerId) {
        socketError(
          socket,
          Object.assign(new Error("Missing player information"), {
            code: "MISSING_CREDENTIALS",
          }),
        );
        return;
      }
      try {
        const state = await RoomService.removePlayer(
          roomCode,
          requesterId,
          payload.playerId,
        );
        const roomSockets = await io.in(roomCode).fetchSockets();
        for (const targetSocket of roomSockets) {
          if (targetSocket.data.playerId === payload.playerId) {
            targetSocket.emit("player:removed", {
              code: "PLAYER_REMOVED",
              message: "You were removed from the room by the host",
            });
            targetSocket.disconnect(true);
          }
        }
        io.to(roomCode).emit("room:state", state);
      } catch (error) {
        socketError(socket, error);
      }
    });
    socket.on("game:start", async () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId) {
        socketError(
          socket,
          Object.assign(new Error("Missing player information"), {
            code: "MISSING_CREDENTIALS",
          }),
        );
        return;
      }
      try {
        await runRoomAction(roomCode, async () => {
          const state = await RoomService.startGame(roomCode, requesterId);
          io.to(roomCode).emit("room:state", state);
        });
      } catch (error) {
        socketError(socket, error);
      }
    });
    socket.on("game:settings:update", async (payload: GameSettings) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId || !payload) return socketError(socket, Object.assign(new Error("Invalid settings"), { code: "INVALID_PAYLOAD" }));
      try {
        await runRoomAction(roomCode, async () => {
          io.to(roomCode).emit("room:state", await RoomService.updateSettings(roomCode, requesterId, payload));
        });
      } catch (error) { socketError(socket, error); }
    });
    socket.on("game:restart", async () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId) return socketError(socket, Object.assign(new Error("Missing player information"), { code: "MISSING_CREDENTIALS" }));
      try {
        await runRoomAction(roomCode, async () => {
          io.to(roomCode).emit("room:state", await RoomService.restartGame(roomCode, requesterId));
        });
      } catch (error) { socketError(socket, error); }
    });
    socket.on("theme:react", async (payload: { reaction?: ThemeReaction | null }) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      const reaction = payload?.reaction;
      if (!roomCode || !playerId || (reaction !== "like" && reaction !== "dislike" && reaction !== null)) {
        socketError(socket, Object.assign(new Error("Invalid reaction"), { code: "INVALID_PAYLOAD" }));
        return;
      }
      try {
        await runRoomAction(roomCode, async () => {
          const state = await RoomService.reactToTheme(roomCode, playerId, reaction);
          io.to(roomCode).emit("room:state", state);
          socket.emit("theme:reaction", { themeId: state.game?.currentTheme.id, reaction });
        });
      } catch (error) {
        socketError(socket, error);
      }
    });
    socket.on("theme:swap", async () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId) return socketError(socket, Object.assign(new Error("Missing player information"), { code: "MISSING_CREDENTIALS" }));
      try {
        await runRoomAction(roomCode, async () => {
          const state = await RoomService.swapTheme(roomCode, requesterId);
          io.to(roomCode).emit("room:state", state);
          io.to(roomCode).emit("theme:reaction", { themeId: state.game?.currentTheme.id, reaction: null });
        });
      } catch (error) {
        socketError(socket, error);
      }
    });
    socket.on("round:start", async () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId) return socketError(socket, Object.assign(new Error("Missing player information"), { code: "MISSING_CREDENTIALS" }));
      try {
        await runRoomAction(roomCode, async () => {
          const state = await RoomService.startRound(roomCode, requesterId);
          io.to(roomCode).emit("room:state", state);
          const delay = Math.max(0, (state.game?.roundEndsAt || Date.now()) - Date.now());
          const timer = setTimeout(async () => {
            try {
              const listening = await RoomService.startListening(roomCode, requesterId);
              io.to(roomCode).emit("listening:state", listening);
              io.to(roomCode).emit("room:state", await RoomService.getPublicRoomState(roomCode));
            } catch (error) {
              if ((error as { code?: string }).code !== "INVALID_PHASE") log.error({ roomCode }, "failed to close choosing phase");
            }
          }, delay + 50);
          timer.unref();
        });
      } catch (error) {
        socketError(socket, error);
      }
    });
    socket.on("submission:create", async (payload: SubmissionInput) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return socketError(socket, Object.assign(new Error("Missing player information"), { code: "MISSING_CREDENTIALS" }));
      try {
        await runRoomAction(roomCode, async () => {
          await RoomService.submitChoice(roomCode, playerId, payload);
          socket.emit("submission:status", {
            submitted: true,
            media: await RoomService.getPlayerSubmission(roomCode, playerId),
          });
          const roomState = await RoomService.getPublicRoomState(roomCode);
          io.to(roomCode).emit("room:state", roomState);
          if (
            roomState.game &&
            roomState.game.playersCount > 0 &&
            roomState.game.submittedCount === roomState.game.playersCount
          ) {
            const listening = await RoomService.startListening(
              roomCode,
              roomState.host.playerId,
            );
            io.to(roomCode).emit("listening:state", listening);
            io.to(roomCode).emit(
              "room:state",
              await RoomService.getPublicRoomState(roomCode),
            );
          }
        });
      } catch (error) { socketError(socket, error); }
    });
    socket.on("listening:start", async () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId) return socketError(socket, Object.assign(new Error("Missing player information"), { code: "MISSING_CREDENTIALS" }));
      try {
        await runRoomAction(roomCode, async () => {
          const state = await RoomService.startListening(roomCode, requesterId);
          io.to(roomCode).emit("listening:state", state);
          io.to(roomCode).emit("room:state", await RoomService.getPublicRoomState(roomCode));
        });
      } catch (error) { socketError(socket, error); }
    });
    for (const direction of ["next", "previous"] as const) {
      socket.on(`listening:${direction}`, async () => {
        const roomCode = socket.data.roomCode as string | undefined;
        const requesterId = socket.data.playerId as string | undefined;
        if (!roomCode || !requesterId) return socketError(socket, Object.assign(new Error("Missing player information"), { code: "MISSING_CREDENTIALS" }));
        try {
          await runRoomAction(roomCode, async () => {
            io.to(roomCode).emit("listening:state", await RoomService.moveListening(roomCode, requesterId, direction));
          });
        } catch (error) { socketError(socket, error); }
      });
    }
    socket.on("voting:start", async () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId) return socketError(socket, Object.assign(new Error("Missing player information"), { code: "MISSING_CREDENTIALS" }));
      try {
        await runRoomAction(roomCode, async () => {
          const votingEndsAt = await RoomService.startVoting(roomCode, requesterId);
          io.to(roomCode).emit("room:state", await RoomService.getPublicRoomState(roomCode));
          await emitVotingViews(roomCode);
          const timer = setTimeout(() => {
            void runRoomAction(roomCode, async () => {
              try { await emitRoundResult(roomCode, true); }
              catch (error) { if ((error as { code?: string }).code !== "INVALID_PHASE") log.error({ roomCode }, "failed to close voting phase"); }
            });
          }, Math.max(0, votingEndsAt - Date.now()) + 50);
          timer.unref();
        });
      } catch (error) { socketError(socket, error); }
    });
    socket.on("vote:submit", async (payload: GroupVote) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId || !payload?.likedGroupId || !payload?.dislikedGroupId) return socketError(socket, Object.assign(new Error("Invalid vote"), { code: "INVALID_PAYLOAD" }));
      try {
        await runRoomAction(roomCode, async () => {
          const result = await RoomService.submitVote(roomCode, playerId, payload);
          if (result) {
            io.to(roomCode).emit("round:result", result);
            io.to(roomCode).emit("room:state", await RoomService.getPublicRoomState(roomCode));
          } else await emitVotingViews(roomCode);
        });
      } catch (error) { socketError(socket, error); }
    });
    socket.on("result:next", async () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId) return socketError(socket, Object.assign(new Error("Missing player information"), { code: "MISSING_CREDENTIALS" }));
      try {
        await runRoomAction(roomCode, async () => {
          io.to(roomCode).emit("round:result", await RoomService.advanceResultReveal(roomCode, requesterId));
        });
      } catch (error) { socketError(socket, error); }
    });
    socket.on("round:next", async () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const requesterId = socket.data.playerId as string | undefined;
      if (!roomCode || !requesterId) return socketError(socket, Object.assign(new Error("Missing player information"), { code: "MISSING_CREDENTIALS" }));
      try { await runRoomAction(roomCode, async () => { io.to(roomCode).emit("room:state", await RoomService.prepareNextRound(roomCode, requesterId)); }); }
      catch (error) { socketError(socket, error); }
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
        const cleanupTimer = setTimeout(async () => {
          try {
            const cleanedState = await RoomService.cleanupExpiredPlayers(roomCode);
            io.to(roomCode).emit("room:state", cleanedState);
          } catch (error) {
            if ((error as { code?: string }).code !== "ROOM_NOT_FOUND") {
              log.error({ roomCode }, "failed to clean expired player sessions");
            }
          }
        }, PLAYER_RECONNECT_TTL_MS + 250);
        cleanupTimer.unref();
      } catch (error) {
        if ((error as { code?: string }).code !== "ROOM_NOT_FOUND") {
          log.error({ roomCode, playerId }, "failed to update player presence");
        }
      }
    });
  });
  return io;
}
