import {
  AnalysisPairHighlight,
  AnalysisPlayer,
  FinalAnalysis,
  FinalAnalysisPlayer,
  HistoricalRound,
} from "./gameTypes";

interface RelationshipStats { likes: number; dislikes: number }
interface PairStats {
  playerAId: string;
  playerBId: string;
  likesAToB: number;
  likesBToA: number;
  dislikesAToB: number;
  dislikesBToA: number;
  sameChoices: number;
  roundsTogether: number;
}

const pairKey = (a: string, b: string) => [a, b].sort().join("::");

export default class FinalAnalysisService {
  static calculate(rounds: HistoricalRound[], generatedAt = new Date()): FinalAnalysis {
    const names = new Map<string, string>();
    const relationships = new Map<string, Map<string, RelationshipStats>>();
    const pairs = new Map<string, PairStats>();
    const individual = new Map<string, Omit<FinalAnalysisPlayer, keyof AnalysisPlayer | "likedByMost" | "dislikedByMost"> & { sameWith: Set<string> }>();

    const ensurePlayer = (player: AnalysisPlayer) => {
      names.set(player.playerId, player.username);
      if (!individual.has(player.playerId)) individual.set(player.playerId, {
        totalLikesReceived: 0, totalDislikesReceived: 0, totalLikesGiven: 0,
        totalDislikesGiven: 0, roundsPlayed: 0, uniqueSameChoicesWithOthers: 0,
        sameWith: new Set(),
      });
    };
    const relationship = (from: string, to: string) => {
      let targets = relationships.get(from);
      if (!targets) { targets = new Map(); relationships.set(from, targets); }
      let stats = targets.get(to);
      if (!stats) { stats = { likes: 0, dislikes: 0 }; targets.set(to, stats); }
      return stats;
    };
    const ensurePair = (a: string, b: string) => {
      const [playerAId, playerBId] = [a, b].sort();
      const key = pairKey(a, b);
      let stats = pairs.get(key);
      if (!stats) {
        stats = { playerAId, playerBId, likesAToB: 0, likesBToA: 0, dislikesAToB: 0, dislikesBToA: 0, sameChoices: 0, roundsTogether: 0 };
        pairs.set(key, stats);
      }
      return stats;
    };

    for (const round of [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)) {
      const participants = [...new Map(round.participants.map((player) => [player.playerId, player])).values()];
      participants.forEach((player) => { ensurePlayer(player); individual.get(player.playerId)!.roundsPlayed += 1; });
      for (let a = 0; a < participants.length; a += 1) for (let b = a + 1; b < participants.length; b += 1) ensurePair(participants[a].playerId, participants[b].playerId).roundsTogether += 1;

      const submissions = new Map(round.submissions.map((submission) => [submission.submissionId, submission]));
      const groups = new Map(round.groups.map((group) => [group.groupId, group]));
      for (const group of round.groups) {
        const authors = [...new Set(group.submissionIds.map((id) => submissions.get(id)?.playerId).filter((id): id is string => Boolean(id)))];
        for (let a = 0; a < authors.length; a += 1) for (let b = a + 1; b < authors.length; b += 1) {
          ensurePair(authors[a], authors[b]).sameChoices += 1;
          individual.get(authors[a])?.sameWith.add(authors[b]);
          individual.get(authors[b])?.sameWith.add(authors[a]);
        }
      }

      const apply = (voterId: string, groupId: string, reaction: "likes" | "dislikes") => {
        const group = groups.get(groupId);
        if (!group || !individual.has(voterId)) return;
        const authors = [...new Set(group.submissionIds.map((id) => submissions.get(id)?.playerId).filter((id): id is string => Boolean(id) && id !== voterId))];
        for (const authorId of authors) {
          if (!individual.has(authorId)) continue;
          relationship(voterId, authorId)[reaction] += 1;
          const voter = individual.get(voterId)!;
          const author = individual.get(authorId)!;
          if (reaction === "likes") { voter.totalLikesGiven += 1; author.totalLikesReceived += 1; }
          else { voter.totalDislikesGiven += 1; author.totalDislikesReceived += 1; }
        }
      };
      for (const vote of round.votes) {
        apply(vote.voterPlayerId, vote.likedGroupId, "likes");
        apply(vote.voterPlayerId, vote.dislikedGroupId, "dislikes");
      }
    }

    for (const pair of pairs.values()) {
      const aToB = relationships.get(pair.playerAId)?.get(pair.playerBId);
      const bToA = relationships.get(pair.playerBId)?.get(pair.playerAId);
      pair.likesAToB = aToB?.likes || 0; pair.dislikesAToB = aToB?.dislikes || 0;
      pair.likesBToA = bToA?.likes || 0; pair.dislikesBToA = bToA?.dislikes || 0;
    }

    const playerRef = (id: string): AnalysisPlayer => ({ playerId: id, username: names.get(id) || "Jogador" });
    const topSources = (targetId: string, reaction: keyof RelationshipStats) => {
      const candidates = [...relationships.entries()].map(([sourceId, targets]) => ({ sourceId, value: targets.get(targetId)?.[reaction] || 0 }));
      const maximum = Math.max(0, ...candidates.map((item) => item.value));
      return maximum === 0 ? [] : candidates.filter((item) => item.value === maximum).map((item) => playerRef(item.sourceId)).sort((a, b) => a.playerId.localeCompare(b.playerId));
    };
    const players = [...individual.entries()].map(([playerId, stats]): FinalAnalysisPlayer => ({
      playerId, username: names.get(playerId) || "Jogador",
      totalLikesReceived: stats.totalLikesReceived, totalDislikesReceived: stats.totalDislikesReceived,
      totalLikesGiven: stats.totalLikesGiven, totalDislikesGiven: stats.totalDislikesGiven,
      roundsPlayed: stats.roundsPlayed, uniqueSameChoicesWithOthers: stats.sameWith.size,
      likedByMost: topSources(playerId, "likes"), dislikedByMost: topSources(playerId, "dislikes"),
    })).sort((a, b) => a.playerId.localeCompare(b.playerId));

    const tiedPlayers = (score: (player: FinalAnalysisPlayer) => number, meaningful = (value: number) => value > 0) => {
      const maximum = Math.max(0, ...players.map(score));
      return meaningful(maximum) ? players.filter((player) => score(player) === maximum) : [];
    };
    const toHighlight = (pair: PairStats, score: number): AnalysisPairHighlight => ({
      players: [playerRef(pair.playerAId), playerRef(pair.playerBId)], roundsTogether: pair.roundsTogether,
      likesBetween: pair.likesAToB + pair.likesBToA, dislikesBetween: pair.dislikesAToB + pair.dislikesBToA,
      sameChoices: pair.sameChoices, score: Number(score.toFixed(4)),
    });
    // Relational highlights require at least two shared rounds and two observed signals.
    // This avoids strong labels based on a single short encounter while still supporting 3-round games.
    const eligiblePairs = [...pairs.values()].filter((pair) => pair.roundsTogether >= 2 && pair.likesAToB + pair.likesBToA + pair.dislikesAToB + pair.dislikesBToA + pair.sameChoices >= 2);
    const tiedPairs = (score: (pair: PairStats) => number, eligible: (pair: PairStats) => boolean) => {
      const candidates = eligiblePairs.filter(eligible).map((pair) => ({ pair, score: score(pair) }));
      const maximum = Math.max(-Infinity, ...candidates.map((item) => item.score));
      return Number.isFinite(maximum) ? candidates.filter((item) => Math.abs(item.score - maximum) < 1e-9).map((item) => toHighlight(item.pair, item.score)) : [];
    };
    // Scores are comparable rates per shared round, not percentages. A same choice is weighted like two
    // directional likes; rivalry requires at least two dislikes and is reduced by agreement signals.
    const affinity = (pair: PairStats) => ((pair.likesAToB + pair.likesBToA) + 2 * pair.sameChoices - (pair.dislikesAToB + pair.dislikesBToA)) / pair.roundsTogether;
    const rivalry = (pair: PairStats) => ((pair.dislikesAToB + pair.dislikesBToA) - .5 * (pair.likesAToB + pair.likesBToA) - .5 * pair.sameChoices) / pair.roundsTogether;
    const controversyPeak = Math.max(0, ...players.map((player) => Math.min(player.totalLikesReceived, player.totalDislikesReceived)));
    const controversialCandidates = controversyPeak > 0 ? players.filter((player) => Math.min(player.totalLikesReceived, player.totalDislikesReceived) === controversyPeak) : [];
    const controversyReactionPeak = Math.max(0, ...controversialCandidates.map((player) => player.totalLikesReceived + player.totalDislikesReceived));

    return {
      analysisVersion: 1,
      generatedAt: generatedAt.toISOString(),
      highlights: {
        mostLiked: tiedPlayers((player) => player.totalLikesReceived),
        mostDisliked: tiedPlayers((player) => player.totalDislikesReceived),
        mostControversial: controversialCandidates.filter((player) => player.totalLikesReceived + player.totalDislikesReceived === controversyReactionPeak),
        strongestAffinity: tiedPairs(affinity, (pair) => affinity(pair) > 0),
        strongestRivalry: tiedPairs(rivalry, (pair) => pair.dislikesAToB + pair.dislikesBToA >= 2 && rivalry(pair) > 0),
        mostSameChoices: tiedPairs((pair) => pair.sameChoices, (pair) => pair.sameChoices > 0),
      },
      players,
    };
  }
}
