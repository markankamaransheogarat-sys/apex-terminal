/**
 * Apex Terminal - Institutional Digital Asset Analytics & Risk Platform
 * Type Definitions and Data Contracts
 */

export type FeedSource =
  "BINANCE_WS" | "BYBIT_WS" | "REST_FALLBACK" | "SYNTHETIC";

export interface MarketTicker {
  symbol: string;
  price: number;
  bidPrice?: number;
  askPrice?: number;
  bidQty?: number;
  askQty?: number;
  orderflowBuyRatio?: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  timestamp: number;
  source: FeedSource;
}

export type FundingRegime =
  | "EXTREME_BULL" // APR > +50%
  | "MODERATE_BULL" // +10% < APR <= +50%
  | "NEUTRAL" // -10% <= APR <= +10%
  | "MODERATE_BEAR" // -50% <= APR < -10%
  | "SHORT_SQUEEZE_RISK"; // APR < -50%

export interface FundingRateData {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  fundingRate: number; // e.g. 0.0001 = 0.01%
  nextFundingTime: number;
  annualizedAPR: number; // in percent, e.g. 10.95%
  annualizedAPY: number; // compounded percent
  regime: FundingRegime;
  timestamp: number;
}

export interface FearAndGreedData {
  value: number;
  valueClassification: string; // "Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"
  timestamp: number;
}

export interface GlobalMarketMetrics {
  fearAndGreed: FearAndGreedData;
  btcDominance?: number;
  totalMarketCapUsd?: number;
  volume24hUsd?: number;
  lastUpdated: number;
  source: string;
}

export interface AssetPosition {
  symbol: string;
  amount: number;
  currentPrice: number;
  valueUsd: number;
  entryPrice?: number;
  leverage?: number;
  isLong?: boolean;
  maintenanceMarginRatio?: number; // e.g. 0.05 for 5% MMR (20x max leverage)
}

export interface InstitutionalPortfolio {
  name: string;
  positions: AssetPosition[];
  cashUsd: number;
  totalCollateralUsd: number;
  totalValueUsd: number;
  totalMarginUsedUsd: number;
  freeMarginUsd: number;
  healthFactor: number;
}

export interface VaRResult {
  portfolioValueUsd: number;
  confidenceLevel: 0.95 | 0.99;
  horizonDays: number;
  zScore: number;
  dailyVolatility: number;
  annualizedVolatility: number;
  parametricVaRUsd: number;
  parametricVaRPercent: number;
  componentVaRUsd: Record<string, number>;
  componentVaRPercent: Record<string, number>;
  marginalVaR: Record<string, number>;
}

export interface BetaResult {
  benchmarkSymbol: string;
  portfolioBeta: number;
  assetBetas: Record<string, number>;
  covarianceWithBenchmark: number;
  benchmarkVariance: number;
  systemicRiskClassification:
    "DEFENSIVE" | "MARKET_TRACKING" | "AGGRESSIVE" | "NEGATIVE_CORRELATED";
}

export interface StressScenario {
  id: string;
  name: string;
  description: string;
  shocks: Record<string, number>; // symbol -> percentage price shift, e.g. BTC: -0.20
  defaultAltShock?: number; // default shock for assets not explicitly listed
  fundingRateSurge?: number; // e.g. +0.0008 (+0.08% funding surge per 8h)
  volatilityExpansion?: number; // e.g. +0.50 (+50% volatility spike)
}

export interface PositionStressImpact {
  symbol: string;
  initialValueUsd: number;
  stressedValueUsd: number;
  pnlDrawdownUsd: number;
  pnlDrawdownPercent: number;
  initialMarginRatio: number;
  stressedMarginRatio: number;
  liquidationPrice?: number;
  isLiquidated: boolean;
  distanceToLiquidationPercent: number;
}

export interface StressTestResult {
  scenarioId: string;
  scenarioName: string;
  baselinePortfolioValueUsd: number;
  stressedPortfolioValueUsd: number;
  totalDrawdownUsd: number;
  totalDrawdownPercent: number;
  fundingCostSurgeUsd: number;
  baselineHealthFactor: number;
  stressedHealthFactor: number;
  liquidatedPositions: string[];
  minimumLiquidationDistancePercent: number;
  isPortfolioSolvent: boolean;
  positionImpacts: Record<string, PositionStressImpact>;
}

export interface DiversificationResult {
  score: number; // 0 to 100
  diversificationRatio: number; // DR = sum(w_i * sigma_i) / sigma_p
  averageCorrelation: number; // off-diagonal mean rho
  effectiveAssetsN: number; // inverse Herfindahl index: 1 / sum(w_i^2)
  regime: "CONCENTRATED" | "MODERATE" | "WELL_DIVERSIFIED" | "OPTIMAL_HEDGE";
  correlationMatrix: Record<string, Record<string, number>>;
  assetWeights: Record<string, number>;
}

export type TerminalCommandType =
  | "TICKER_VIEW"
  | "RISK_MATRIX"
  | "FUNDING_HEATMAP"
  | "NEWS_SENTIMENT"
  | "PORTFOLIO_VIEW"
  | "HELP_VIEW"
  | "STRESS_VIEW"
  | "CLEAR_SCREEN"
  | "QUIT"
  | "UNKNOWN";

export interface ParsedTerminalCommand {
  raw: string;
  commandType: TerminalCommandType;
  ticker?: string;
  subCommand?: string;
  args: string[];
  hasGoToken: boolean;
  isValid: boolean;
  errorMessage?: string;
}

export interface AutocompleteItem {
  token: string;
  description: string;
  category: "TICKER" | "COMMAND" | "HOTKEY" | "FUNCTION";
  previewTemplate: string;
}
