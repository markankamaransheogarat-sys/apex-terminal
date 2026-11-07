/**
 * Apex Terminal - Canvas Charting Engine
 * Type Definitions, Smart Money Concepts (SMC), Oscillators & Drawing Contracts
 */

export type ChartTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
}

export interface VolumeProfileNode {
  priceLevel: number;
  volume: number;
  percentage: number;
  isPOC: boolean; // Point of Control (highest volume node)
}

export interface FairValueGap {
  startIndex: number;
  topPrice: number;
  bottomPrice: number;
  type: "BULLISH" | "BEARISH";
  mitigated: boolean;
}

export interface StructureBreak {
  startIndex: number;
  breakIndex: number;
  price: number;
  type: "BOS_BULL" | "BOS_BEAR" | "CHOCH_BULL" | "CHOCH_BEAR";
}

export interface OrderBlockZone {
  candleIndex: number;
  high: number;
  low: number;
  type: "BULL_OB" | "BEAR_OB";
  volumeUsd: number;
}

export interface SmartMoneyAnalysis {
  fairValueGaps: FairValueGap[];
  structureBreaks: StructureBreak[];
  orderBlocks: OrderBlockZone[];
}

export interface MacdPoint {
  macd: number;
  signal: number;
  histogram: number;
}

export interface BollingerBandPoint {
  upper: number;
  middle: number;
  lower: number;
}

export type ChartDrawingTool =
  "CURSOR" | "RULER" | "TRENDLINE" | "HLINE" | "FIB";

export type ChartSubPaneMode = "MACD" | "RSI" | "CVD" | "NONE";

export interface ChartUserDrawing {
  id: string;
  type: "RULER" | "TRENDLINE" | "HLINE" | "FIB";
  startCandleIndex: number;
  startPrice: number;
  endCandleIndex: number;
  endPrice: number;
}

export interface ChartData {
  symbol: string;
  timeframe: ChartTimeframe;
  candles: Candle[];
  vwap: number[];
  volumeProfile: VolumeProfileNode[];
  minPrice: number;
  maxPrice: number;
  maxVolume: number;
  pointOfControlPrice: number;
  smc?: SmartMoneyAnalysis;
  macd?: MacdPoint[];
  bollinger?: BollingerBandPoint[];
}
