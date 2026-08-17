import { describe, expect, it } from "vitest";
import FinalAnalysisService from "../src/game/FinalAnalysisService";
import { HistoricalRound } from "../src/game/gameTypes";

const at = new Date("2026-08-17T12:00:00.000Z");
const player = (playerId: string) => ({ playerId, username: playerId.toUpperCase() });

function round(number: number, participantIds: string[], choices: Record<string, string>, votes: Array<[string, string, string]>): HistoricalRound {
  const submissions = Object.entries(choices).map(([playerId, mediaKey]) => ({
    submissionId: `${number}-${playerId}`, playerId, mediaKey, source: "SPOTIFY" as const,
    title: mediaKey, spotifyTrackId: mediaKey, startTime: 0, likes: 0, dislikes: 0,
  }));
  const mediaKeys = [...new Set(Object.values(choices))];
  const groups = mediaKeys.map((mediaKey) => ({
    groupId: `${number}-${mediaKey}`, mediaKey,
    submissionIds: submissions.filter((submission) => submission.mediaKey === mediaKey).map((submission) => submission.submissionId),
  }));
  return {
    roundNumber: number,
    theme: { id: `theme-${number}`, title: `Tema ${number}`, type: "MUSIC" },
    participants: participantIds.map(player), submissions, groups,
    votes: votes.map(([voterPlayerId, liked, disliked]) => ({ voterPlayerId, likedGroupId: `${number}-${liked}`, dislikedGroupId: `${number}-${disliked}` })),
  };
}

describe("FinalAnalysisService", () => {
  it("preserves directional likes/dislikes and attributes grouped choices to each eligible author", () => {
    const analysis = FinalAnalysisService.calculate([
      round(1, ["a", "b", "c"], { a: "same", b: "same", c: "other" }, [
        ["a", "same", "other"], ["b", "other", "same"], ["c", "same", "other"],
      ]),
      round(2, ["a", "b", "c"], { a: "a2", b: "b2", c: "c2" }, [
        ["a", "b2", "c2"], ["b", "a2", "c2"], ["c", "a2", "b2"],
      ]),
    ], at);
    const a = analysis.players.find((item) => item.playerId === "a")!;
    const b = analysis.players.find((item) => item.playerId === "b")!;
    expect(a).toMatchObject({ totalLikesGiven: 2, totalDislikesGiven: 2, roundsPlayed: 2, uniqueSameChoicesWithOthers: 1 });
    expect(b.totalLikesReceived).toBeGreaterThan(0);
    expect(analysis.highlights.mostSameChoices[0]).toMatchObject({ sameChoices: 1, roundsTogether: 2 });
    expect(analysis.highlights.strongestAffinity.length).toBeGreaterThan(0);
  });

  it("normalizes late joiners with roundsTogether and excludes absent host-only participants", () => {
    const analysis = FinalAnalysisService.calculate([
      round(1, ["a", "b"], { a: "a1", b: "b1" }, [["a", "b1", "a1"], ["b", "a1", "b1"]]),
      round(2, ["a", "b", "late"], { a: "a2", b: "b2", late: "l2" }, [["a", "b2", "l2"], ["b", "a2", "l2"], ["late", "a2", "b2"]]),
    ], at);
    expect(analysis.players.map((item) => item.playerId)).toEqual(["a", "b", "late"]);
    expect(analysis.players.find((item) => item.playerId === "late")?.roundsPlayed).toBe(1);
    expect(analysis.highlights.strongestAffinity.every((item) => item.roundsTogether >= 2)).toBe(true);
  });

  it("returns explicit ties, controversy only with reactions on both sides, and no meaningless rivalry", () => {
    const analysis = FinalAnalysisService.calculate([
      round(1, ["a", "b"], { a: "a1", b: "b1" }, [["a", "b1", "a1"], ["b", "a1", "b1"]]),
      round(2, ["a", "b"], { a: "a2", b: "b2" }, [["a", "b2", "a2"], ["b", "a2", "b2"]]),
      round(3, ["a", "b"], { a: "a3", b: "b3" }, [["a", "b3", "a3"], ["b", "a3", "b3"]]),
    ], at);
    expect(analysis.highlights.mostLiked.map((item) => item.playerId)).toEqual(["a", "b"]);
    expect(analysis.highlights.mostControversial).toEqual([]);
    expect(analysis.highlights.strongestRivalry).toEqual([]);
  });

  it("is deterministic and reconstructs the same analysis from persisted historical facts", () => {
    const facts = [round(1, ["a", "b"], { a: "same", b: "same" }, [])];
    const persisted = JSON.parse(JSON.stringify(facts)) as HistoricalRound[];
    expect(FinalAnalysisService.calculate(persisted, at)).toEqual(FinalAnalysisService.calculate(facts, at));
  });

  it.each([10, 20])("keeps a 10-round analysis trivial for %i players", (count) => {
    const ids = Array.from({ length: count }, (_, index) => `p${index}`);
    const facts = Array.from({ length: 10 }, (_, index) => round(index + 1, ids, Object.fromEntries(ids.map((id, playerIndex) => [id, `track-${playerIndex % 5}`])), ids.map((id, playerIndex) => [id, `track-${(playerIndex + 1) % 5}`, `track-${(playerIndex + 2) % 5}`])));
    const startedAt = performance.now();
    const analysis = FinalAnalysisService.calculate(facts, at);
    expect(analysis.players).toHaveLength(count);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
