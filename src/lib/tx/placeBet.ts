export type PlaceBetParams = {
  claimId: string;
  side: "YES" | "NO";
  stake: number;
};

export async function placeBet({ claimId, side, stake }: PlaceBetParams): Promise<void> {
  // Phase 1 stub: this remains offchain.
  // Replace with the onchain send path used by `handleVote` in `src/App.jsx`
  // (wagmi `sendCalls` + paymaster) when bet staking moves onchain.
  void claimId;
  void side;
  void stake;
}
