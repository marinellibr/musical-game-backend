import { z } from "zod";

export const createRoomSchema = z.object({
  username: z.string().min(1).max(32),
});
export const joinRoomSchema = z.object({ username: z.string().min(1).max(32) });
