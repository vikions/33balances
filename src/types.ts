export type PolymarketMarket = {
  id: string;
  question: string;
  endTime: string;
  marketYesPct: number;
  marketNoPct: number;
  url: string;
  source: string;
};

export type StakeSide = "YES" | "NO";

export type ArenaStake = {
  id: string;
  claimId: string;
  side: StakeSide;
  stake: number;
  timestamp: number;
  endTime: string;
  question: string;
  status: "pending" | "resolved";
  resolvedSide?: StakeSide;
  resolvedAt?: number;
};
