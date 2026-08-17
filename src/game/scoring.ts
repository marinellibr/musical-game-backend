export interface RoundScore {
  submissionId: string;
  likes: number;
  dislikes: number;
  balance: number;
  position: number;
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

  let previous: Pick<RoundScore, "balance" | "likes" | "dislikes"> | null = null;
  let position = 0;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!previous || result.balance !== previous.balance || result.likes !== previous.likes || result.dislikes !== previous.dislikes) position = index + 1;
    result.position = position;
    previous = result;
  }

  return results;
}
