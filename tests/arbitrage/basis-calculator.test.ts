import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BasisArbitrageCalculator } from "../../src/arbitrage/basis-calculator.js";
import { MarketTicker, FundingRateData } from "../../src/types/index.js";

describe("BasisArbitrageCalculator - Institutional Cash & Carry", () => {
  it("calculates basis spread, delta-neutral APR and signals accurately", () => {
    const spotTickers = new Map<string, MarketTicker>();
    spotTickers.set("BTCUSDT", {
      symbol: "BTCUSDT",
      price: 77000,
      high24h: 78000,
      low24h: 76000,
      volume24h: 1000,
      quoteVolume24h: 77000000,
      priceChange24h: 500,
      priceChangePercent24h: 0.65,
      timestamp: Date.now(),
      source: "BINANCE_WS",
    });

    const fundingRates: FundingRateData[] = [
      {
        symbol: "BTCUSDT",
        markPrice: 77150, // Basis = +$150 premium
        indexPrice: 77000,
        fundingRate: 0.0002, // 0.02% per 8h = 21.9% APR
        nextFundingTime: Date.now() + 14400000,
        annualizedAPR: 21.9,
        annualizedAPY: 24.4,
        regime: "MODERATE_BULL",
        timestamp: Date.now(),
      },
    ];

    const matrix = BasisArbitrageCalculator.calculateMatrix(
      spotTickers,
      fundingRates,
    );
    assert.equal(matrix.length, 1);

    const btc = matrix[0]!;
    assert.equal(btc.asset, "BTC");
    assert.equal(btc.basisSpreadUsd, 150);
    assert.ok(btc.basisSpreadPercent > 0);
    assert.equal(btc.annualizedFundingApr, 21.9);
    assert.equal(btc.signal, "HIGH_YIELD_CASH_CARRY");
    assert.ok(btc.estimated30DayYieldUsd > 0);

    const summary = BasisArbitrageCalculator.getSummary(matrix);
    assert.equal(summary.totalOpportunitiesCount, 1);
    assert.equal(summary.bestOpportunity?.asset, "BTC");
  });
});
