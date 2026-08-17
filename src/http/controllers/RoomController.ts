import { Request, Response } from "express";
import { z } from "zod";
import RoomService from "../../rooms/RoomService";

const createSchema = z.object({ username: z.string().min(1).max(32) });

const RoomController = {
  async createRoom(req: Request, res: Response) {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error: { code: "INVALID_PAYLOAD", message: parsed.error.message },
        });
    const { username } = parsed.data;
    const result = await RoomService.createRoom(username);
    res.json(result);
  },

  async joinRoom(req: Request, res: Response) {
    const schema = z.object({ username: z.string().min(1).max(32) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error: { code: "INVALID_PAYLOAD", message: parsed.error.message },
        });
    const { username } = parsed.data;
    const { roomCode } = req.params;
    try {
      const result = await RoomService.joinRoom(
        roomCode.toUpperCase(),
        username,
      );
      res.json(result);
    } catch (err: any) {
      res
        .status(400)
        .json({
          error: { code: err.code || "JOIN_FAILED", message: err.message },
        });
    }
  },

  async getRoom(req: Request, res: Response) {
    const { roomCode } = req.params;
    try {
      const state = await RoomService.getPublicRoomState(
        roomCode.toUpperCase(),
      );
      res.json(state);
    } catch (err: any) {
      res
        .status(404)
        .json({ error: { code: "ROOM_NOT_FOUND", message: "Room not found" } });
    }
  },
};

export default RoomController;
