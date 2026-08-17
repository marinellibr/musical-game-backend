import FinalAnalysisService from "../game/FinalAnalysisService";
import { HistoricalRound, LeaderboardEntry } from "../game/gameTypes";

function fixture(playerCount: number, roundCount: number): HistoricalRound[] {
  const players = Array.from({ length: playerCount }, (_, index) => ({ playerId: `p${index}`, username: `Player ${index}` }));
  return Array.from({ length: roundCount }, (_, roundIndex) => {
    const submissions = players.map((player, index) => ({ submissionId: `s-${roundIndex}-${index}`, playerId: player.playerId, mediaKey: `spotify:track:${roundIndex}-${index % 5}`, source: "SPOTIFY" as const, title: `Track ${index}`, spotifyTrackId: `${roundIndex}-${index % 5}`, startTime: 0, likes: 0, dislikes: 0 }));
    const groups = Array.from({ length: 5 }, (_, groupIndex) => ({ groupId: `g-${roundIndex}-${groupIndex}`, mediaKey: `spotify:track:${roundIndex}-${groupIndex}`, submissionIds: submissions.filter((submission) => submission.mediaKey.endsWith(`-${groupIndex}`)).map((submission) => submission.submissionId) }));
    return { roundNumber: roundIndex + 1, theme: { id: `t${roundIndex}`, title: `Theme ${roundIndex}`, type: "MUSIC" }, participants: players, submissions, groups, votes: players.map((player, index) => ({ voterPlayerId: player.playerId, likedGroupId: `g-${roundIndex}-${(index + 1) % 5}`, dislikedGroupId: `g-${roundIndex}-${(index + 2) % 5}` })) };
  });
}

for (const playerCount of [10, 20]) {
  const rounds = fixture(playerCount, 10);
  const startedAt = performance.now();
  const analysis = FinalAnalysisService.calculate(rounds, new Date("2026-08-17T12:00:00Z"));
  const elapsedMs = performance.now() - startedAt;
  const leaderboard: LeaderboardEntry[] = analysis.players.map((player, index) => ({ playerId: player.playerId, username: player.username, totalLikes: player.totalLikesReceived, totalDislikes: player.totalDislikesReceived, voteBalance: player.totalLikesReceived - player.totalDislikesReceived, position: index + 1 }));
  const session = { sessionId: "benchmark", players: analysis.players.map(({ playerId, username }) => ({ playerId, username })), rounds, finalRanking: leaderboard, analysis };
  const refs = (players: typeof analysis.highlights.mostLiked) => players.map(({ playerId, username }) => ({ playerId, username }));
  const dto = { sessionId: "benchmark", leaderboard, analysis: { analysisVersion: analysis.analysisVersion, generatedAt: analysis.generatedAt, highlights: { ...analysis.highlights, mostLiked: refs(analysis.highlights.mostLiked), mostDisliked: refs(analysis.highlights.mostDisliked), mostControversial: refs(analysis.highlights.mostControversial) } } };
  process.stdout.write(JSON.stringify({ playerCount, rounds: 10, elapsedMs: Number(elapsedMs.toFixed(3)), sessionKb: Number((Buffer.byteLength(JSON.stringify(session)) / 1024).toFixed(1)), socketDtoKb: Number((Buffer.byteLength(JSON.stringify(dto)) / 1024).toFixed(1)) }) + "\n");
}
