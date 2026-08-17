import { describe, expect, it } from "vitest";
import { createRoomSchema, joinRoomSchema } from "../src/schemas/roomSchemas";

describe("room HTTP payloads", () => {
  it("defaults a new host to playing", () => {
    expect(createRoomSchema.parse({ username: " Luiz " })).toEqual({
      username: "Luiz",
      isPlaying: true,
    });
  });

  it("accepts host-only mode", () => {
    expect(
      createRoomSchema.parse({ username: "TV", isPlaying: false }).isPlaying,
    ).toBe(false);
  });

  it("normalizes whitespace and rejects empty player names", () => {
    expect(joinRoomSchema.parse({ username: " Bruno " }).username).toBe("Bruno");
    expect(joinRoomSchema.safeParse({ username: "   " }).success).toBe(false);
  });
});
