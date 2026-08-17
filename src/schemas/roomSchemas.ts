import { z } from "zod";

export const createRoomSchema = z.object({
  username: z.string().trim().min(1).max(32),
  isPlaying: z.boolean().default(true),
  gameVersion: z.enum(["v1", "v2"]).default("v1"),
});
export const joinRoomSchema = z.object({
  username: z.string().trim().min(1).max(32),
});
