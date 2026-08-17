import { z } from "zod";

export const createRoomSchema = z.object({
  username: z.string().trim().min(1).max(32),
  isPlaying: z.boolean().default(true),
});
export const joinRoomSchema = z.object({
  username: z.string().trim().min(1).max(32),
});
