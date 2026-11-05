/**
 * Apex Terminal - Institutional Basis & Arbitrage Subsystem
 * Type Definitions
 */

export type ArbitrageSignal =
  | "HIGH_YIELD_CASH_CARRY" // Funding APR > 15%, buy spot / short perp
  | "MODERATE_CASH_CARRY" // Funding APR 5-15%
  | "NEUTRAL"
  | "INVERTED_REVERSE_ARB"; // Negative funding, short spot / long perp

export interface BasisArbitrageItem {
  symbol: string;
  asset: string;
  spotPrice: number;
  perpPrice: number;
  basisSpreadUsd: number;
  basisSpreadPercent: number;
  fundingRate8h: number;
  annualizedFundingApr: number;
  compoundedApy: number;
  totalDeltaNeutralApr: number;
  signal: ArbitrageSignal;
  estimated30DayYieldUsd: number; // On $100,000 nominal
}

export interface ArbitrageMatrixSummary {
  bestOpportunity: BasisArbitrageItem | null;
  averageBasisApr: number;
  totalOpportunitiesCount: number;
  timestamp: number;
}
