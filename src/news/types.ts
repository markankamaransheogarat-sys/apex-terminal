/**
 * Apex Terminal - Institutional Market News Wire
 * Type Definitions & Contracts
 */

export type SentimentClassification = "BULLISH" | "BEARISH" | "NEUTRAL";
export type NewsImpact = "CRITICAL" | "HIGH" | "MEDIUM" | "ROUTINE";
export type NewsCategory =
  "MACRO" | "ETF_FLOWS" | "REGULATION" | "ON_CHAIN" | "DEFI" | "SECURITY";

export interface NewsArticle {
  id: string;
  headline: string;
  source: string;
  url?: string;
  category: NewsCategory;
  sentiment: SentimentClassification;
  sentimentScore: number; // -1.0 (ultra bearish) to +1.0 (ultra bullish)
  impact: NewsImpact;
  timestamp: number;
}

export interface NewsWireSnapshot {
  articles: NewsArticle[];
  marketSentimentIndex: number; // 0 to 100
  marketSentimentLabel: string;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  lastUpdated: number;
}
