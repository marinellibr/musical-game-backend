import { NextFunction, Request, Response } from "express";
import RoomService from "../../rooms/RoomService";
import { createRoomSchema, joinRoomSchema } from "../../schemas/roomSchemas";

function invalidPayload(res: Response) {
  return res.status(400).json({
    error: { code: "INVALID_PAYLOAD", message: "Invalid room details" },
  });
}

const RoomController = {
  async createRoom(req: Request, res: Response, next: NextFunction) {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) return invalidPayload(res);
    try {
      return res.json(
        await RoomService.createRoom(parsed.data.username, parsed.data.isPlaying),
      );
    } catch (error) {
      return next(error);
    }
  },

  async joinRoom(req: Request, res: Response, next: NextFunction) {
    const parsed = joinRoomSchema.safeParse(req.body);
    if (!parsed.success) return invalidPayload(res);
    try {
      return res.json(
        await RoomService.joinRoom(req.params.roomCode, parsed.data.username),
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ROOM_NOT_FOUND") {
        return res.status(404).json({ error: { code, message: "Room not found" } });
      }
      if (code === "ROOM_FULL") {
        return res.status(409).json({ error: { code, message: "Room full" } });
      }
      return next(error);
    }
  },

  async getRoom(req: Request, res: Response) {
    try {
      return res.json(await RoomService.getPublicRoomState(req.params.roomCode));
    } catch {
      return res.status(404).json({
        error: { code: "ROOM_NOT_FOUND", message: "Room not found" },
      });
    }
  },

  async getSessionResult(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await RoomService.getFinishedResult(req.params.sessionId);
      if (!result) return res.status(404).json({ error: { code: "RESULT_NOT_FOUND", message: "Finished session not found" } });
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  },
};

export default RoomController;
