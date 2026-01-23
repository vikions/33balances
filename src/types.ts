export type PolymarketMarket = {
  id: string;
  question: string;
  endTime: string;
  marketUpPct: number;
  marketDownPct: number;
  url: string;
  source: string;
  slug?: string;
};

export type StakeSide = "UP" | "DOWN";

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
