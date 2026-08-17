export interface RoundScore {
  submissionId: string;
  likes: number;
  dislikes: number;
  balance: number;
  points: number;
}

export function scoreRound(results: RoundScore[]): RoundScore[] {
  // compute balance
  results.forEach((r) => (r.balance = r.likes - r.dislikes));

  // sort by balance desc, likes desc, dislikes asc
  results.sort((a, b) => {
    if (b.balance !== a.balance) return b.balance - a.balance;
    if (b.likes !== a.likes) return b.likes - a.likes;
    return a.dislikes - b.dislikes;
  });

  // assign points
  const pointsByPosition = [10, 5, 2];
  for (let i = 0; i < results.length; i++) {
    const points = pointsByPosition[i] ?? 0;
    results[i].points = points;
  }

  return results;
}
