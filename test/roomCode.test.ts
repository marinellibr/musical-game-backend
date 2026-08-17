import { describe, it, expect } from "vitest";
import { generateRoomCode } from "../src/utils/roomCode";

describe("roomCode", () => {
  it("generates a 4-char code", () => {
    const code = generateRoomCode(4);
    expect(code).toHaveLength(4);
  });
});
