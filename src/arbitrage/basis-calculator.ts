/**
 * Institutional Basis & Cash & Carry Arbitrage Calculator
 * Computes live Spot vs Perpetual Basis spread, delta-neutral APR/APY,
 * and institutional carry signals across crypto assets.
 */

import {
  BasisArbitrageItem,
  ArbitrageSignal,
  ArbitrageMatrixSummary,
} from "./types.js";
import { MarketTicker, FundingRateData } from "../types/index.js";

export class BasisArbitrageCalculator {
  /**
   * Calculate Basis & Arbitrage Matrix from live spot tickers and funding rates
   */
  public static calculateMatrix(
    spotTickers: Map<string, MarketTicker>,
    fundingRates: FundingRateData[],
  ): BasisArbitrageItem[] {
    const items: BasisArbitrageItem[] = [];

    fundingRates.forEach((funding) => {
      const perpSymbol = funding.symbol;
      const baseAsset = perpSymbol.replace("USDT", "");
      const spotSymbol = `${baseAsset}USDT`;

      const spotTicker = spotTickers.get(spotSymbol);
      if (!spotTicker || spotTicker.price <= 0) return;

      const spotPrice = spotTicker.price;
      const perpPrice = funding.markPrice > 0 ? funding.markPrice : spotPrice;

      const basisSpreadUsd = perpPrice - spotPrice;
      const basisSpreadPercent = (basisSpreadUsd / spotPrice) * 100;

      const annualizedFundingApr = funding.annualizedAPR;
      const compoundedApy = funding.annualizedAPY;

      // Basis convergence yield (assuming 30-day roll) + funding APR
      const basisAnnualizedYield = (basisSpreadPercent / 30) * 365;
      const totalDeltaNeutralApr =
        annualizedFundingApr + Math.max(0, basisAnnualizedYield);

      let signal: ArbitrageSignal = "NEUTRAL";
      if (totalDeltaNeutralApr >= 15) {
        signal = "HIGH_YIELD_CASH_CARRY";
      } else if (totalDeltaNeutralApr >= 5) {
        signal = "MODERATE_CASH_CARRY";
      } else if (annualizedFundingApr < -5) {
        signal = "INVERTED_REVERSE_ARB";
      }

      // Projected dollar yield on standard $100k institutional position for 30 days
      const estimated30DayYieldUsd =
        (100_000 * (totalDeltaNeutralApr / 100) * 30) / 365;

      items.push({
        symbol: perpSymbol,
        asset: baseAsset,
        spotPrice,
        perpPrice,
        basisSpreadUsd,
        basisSpreadPercent,
        fundingRate8h: funding.fundingRate,
        annualizedFundingApr,
        compoundedApy,
        totalDeltaNeutralApr,
        signal,
        estimated30DayYieldUsd,
      });
    });

    // Sort by highest delta-neutral APR descending
    return items.sort(
      (a, b) => b.totalDeltaNeutralApr - a.totalDeltaNeutralApr,
    );
  }

  public static getSummary(
    items: BasisArbitrageItem[],
  ): ArbitrageMatrixSummary {
    if (items.length === 0) {
      return {
        bestOpportunity: null,
        averageBasisApr: 0,
        totalOpportunitiesCount: 0,
        timestamp: Date.now(),
      };
    }

    const totalApr = items.reduce(
      (sum, item) => sum + item.totalDeltaNeutralApr,
      0,
    );
    const avgApr = totalApr / items.length;
    const oppCount = items.filter(
      (i) =>
        i.signal === "HIGH_YIELD_CASH_CARRY" ||
        i.signal === "MODERATE_CASH_CARRY",
    ).length;

    return {
      bestOpportunity: items[0] || null,
      averageBasisApr: avgApr,
      totalOpportunitiesCount: oppCount,
      timestamp: Date.now(),
    };
  }
}
