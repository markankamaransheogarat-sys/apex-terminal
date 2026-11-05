/**
 * Apex Terminal - Canvas Charting Engine
 * Type Definitions & Data Contracts
 */

export type ChartTimeframe = "1m" | "5m" | "15m" | "1h" | "1d" | "1w";

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
}
