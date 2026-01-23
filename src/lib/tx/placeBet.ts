export type PlaceBetParams = {
  marketId: string;
  side: "UP" | "DOWN";
  stake: number;
};

export async function placeBet({ marketId, side, stake }: PlaceBetParams): Promise<void> {
  // Phase 1 stub: this remains offchain.
  // Replace with the onchain send path used by `handleVote` in `src/App.jsx`
  // (wagmi `sendCalls` + paymaster) when bet staking moves onchain.
  void marketId;
  void side;
  void stake;
}
