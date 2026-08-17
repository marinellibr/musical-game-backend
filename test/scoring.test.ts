import { describe, it, expect } from "vitest";
import { scoreRound } from "../src/game/scoring";

describe("scoring", () => {
  it("sorts vote balances and assigns consistent tied positions", () => {
    const input = [
      { submissionId: "a", likes: 3, dislikes: 1, balance: 0, position: 0 },
      { submissionId: "b", likes: 2, dislikes: 0, balance: 0, position: 0 },
      { submissionId: "c", likes: 1, dislikes: 0, balance: 0, position: 0 },
    ];
    const res = scoreRound(input);
    expect(res[0].submissionId).toBe("a");
    expect(res.map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect(res.map((entry) => entry.balance)).toEqual([2, 2, 1]);
  });
});
