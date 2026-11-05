/**
 * Binance Futures Funding Rate Heatmap Calculator
 * Analyzes perpetual futures funding rates across the digital asset universe,
 * computing annualized APR/APY and classifying sentiment regimes.
 */

import { FundingRateData, FundingRegime } from "../types/index.js";

export interface RawBinanceFundingItem {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice?: string;
  lastFundingRate: string;
  interestRate?: string;
  nextFundingTime: number;
  time?: number;
}

export class FundingRateCalculator {
  /**
   * Determine funding regime based on annualized APR
   */
  public static classifyRegime(annualizedAPR: number): FundingRegime {
    if (annualizedAPR > 50) {
      return "EXTREME_BULL";
    } else if (annualizedAPR > 10) {
      return "MODERATE_BULL";
    } else if (annualizedAPR >= -10) {
      return "NEUTRAL";
    } else if (annualizedAPR >= -50) {
      return "MODERATE_BEAR";
    } else {
      return "SHORT_SQUEEZE_RISK";
    }
  }

  /**
   * Parse a single Binance Futures premiumIndex JSON entry
   */
  public static parseFundingItem(item: RawBinanceFundingItem): FundingRateData {
    const rate = parseFloat(item.lastFundingRate);
    const validRate = Number.isFinite(rate) ? rate : 0;

    // 8-hour funding intervals: 3 intervals per day, 365 days per year = 1095 intervals/year
    const intervalsPerYear = 3 * 365;
    const annualizedAPR = validRate * intervalsPerYear * 100;

    // APY compounded: (1 + rate)^1095 - 1
    // Guard against negative bases or extreme exponential explosion
    let annualizedAPY = annualizedAPR;
    if (validRate > -1 && validRate < 0.2) {
      annualizedAPY = (Math.pow(1 + validRate, intervalsPerYear) - 1) * 100;
    }

    const regime = this.classifyRegime(annualizedAPR);

    return {
      symbol: item.symbol,
      markPrice: parseFloat(item.markPrice) || 0,
      indexPrice: parseFloat(item.indexPrice) || 0,
      fundingRate: validRate,
      nextFundingTime: item.nextFundingTime,
      annualizedAPR: Math.round(annualizedAPR * 100) / 100,
      annualizedAPY: Math.round(annualizedAPY * 100) / 100,
      regime,
      timestamp: item.time ?? Date.now(),
    };
  }

  /**
   * Parse multiple items and filter to major USDT perpetual contracts
   */
  public static parseFundingRates(
    rawItems: RawBinanceFundingItem[],
    whitelistSymbols?: string[],
  ): FundingRateData[] {
    const parsed = rawItems
      .filter((item) => {
        if (!item.symbol.endsWith("USDT")) return false;
        if (whitelistSymbols && whitelistSymbols.length > 0) {
          const base = item.symbol.replace("USDT", "");
          return (
            whitelistSymbols.includes(base) ||
            whitelistSymbols.includes(item.symbol)
          );
        }
        return true;
      })
      .map((item) => this.parseFundingItem(item));

    // Sort by absolute APR descending to surface highest carry or squeeze risk first
    return parsed.sort(
      (a, b) => Math.abs(b.annualizedAPR) - Math.abs(a.annualizedAPR),
    );
  }

  /**
   * Fetch live funding rate data directly from Binance Futures public endpoint
   */
  public static async fetchLiveFundingRates(
    fetchImpl: typeof fetch = globalThis.fetch,
    whitelist?: string[],
  ): Promise<FundingRateData[]> {
    const url = "https://fapi.binance.com/fapi/v1/premiumIndex";
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ApexTerminal/1.0.0 (Institutional Risk Platform)",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Binance Futures funding rates: HTTP ${response.status} ${response.statusText}`,
      );
    }

    const rawData = (await response.json()) as RawBinanceFundingItem[];
    if (!Array.isArray(rawData)) {
      throw new Error("Unexpected Binance Futures payload structure");
    }

    return this.parseFundingRates(rawData, whitelist);
  }
}
