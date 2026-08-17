import { describe, it, expect } from "vitest";
import { scoreRound } from "../src/game/scoring";

describe("scoring", () => {
  it("sorts and assigns points correctly", () => {
    const input = [
      { submissionId: "a", likes: 3, dislikes: 1, balance: 0, points: 0 },
      { submissionId: "b", likes: 2, dislikes: 0, balance: 0, points: 0 },
      { submissionId: "c", likes: 1, dislikes: 0, balance: 0, points: 0 },
    ];
    const res = scoreRound(input);
    expect(res[0].submissionId).toBe("a");
    expect(res[0].points).toBe(10);
    expect(res[1].points).toBe(5);
    expect(res[2].points).toBe(2);
  });
});
