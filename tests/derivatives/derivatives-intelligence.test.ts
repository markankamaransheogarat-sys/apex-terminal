import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DerivativesIntelligenceService } from "../../src/derivatives/derivatives-intelligence.js";
import { MarketTicker, FundingRateData } from "../../src/types/index.js";
import { WhaleTrade } from "../../src/feeds/whale-stream.js";

describe("DerivativesIntelligenceService", () => {
  it("computes Deribit Options Max Pain, Call Wall, Put Wall, and Put/Call ratio accurately", () => {
    const rawSummaries = [
      {
        instrument_name: "BTC-28MAR26-80000-P",
        open_interest: 1200,
        mark_iv: 52.5,
        underlying_price: 85200,
      },
      {
        instrument_name: "BTC-28MAR26-85000-P",
        open_interest: 400,
        mark_iv: 50.0,
        underlying_price: 85200,
      },
      {
        instrument_name: "BTC-28MAR26-85000-C",
        open_interest: 500,
        mark_iv: 51.0,
        underlying_price: 85200,
      },
      {
        instrument_name: "BTC-28MAR26-90000-C",
        open_interest: 1800,
        mark_iv: 54.0,
        underlying_price: 85200,
      },
    ];

    const metrics = DerivativesIntelligenceService.parseDeribitBookSummary(
      "BTC",
      rawSummaries,
    );

    assert.equal(metrics.currency, "BTC");
    assert.equal(metrics.callWallStrike, 90000);
    assert.equal(metrics.putWallStrike, 80000);
    // Max pain should be 85000 where neither the huge 80000 Put wall nor 90000 Call wall is ITM
    assert.equal(metrics.maxPainStrike, 85000);
    // Total calls = 2300, total puts = 1600 -> PCR = 1600 / 2300 ≈ 0.70
    assert.ok(metrics.putCallRatio > 0.65 && metrics.putCallRatio < 0.75);
    assert.equal(metrics.dealerGammaRegime, "POSITIVE_GAMMA_PIN");
  });

  it("classifies 4-Quadrant OI Regimes and detects Whale CVD Divergences", () => {
    const service = new DerivativesIntelligenceService();
    const tickers = new Map<string, MarketTicker>([
      [
        "BTCUSDT",
        {
          symbol: "BTCUSDT",
          price: 86000,
          priceChange24h: -1200,
          priceChangePercent24h: -1.4,
          high24h: 87500,
          low24h: 84800,
          volume24h: 35000,
          quoteVolume24h: 3010000000,
          orderflowBuyRatio: 58,
          timestamp: Date.now(),
        },
      ],
    ]);

    const fundingRates: FundingRateData[] = [
      {
        symbol: "BTCUSDT",
        markPrice: 86000,
        indexPrice: 86010,
        fundingRate: 0.0001,
        nextFundingTime: Date.now() + 3600000,
        annualizedAPR: 10.95,
        annualizedAPY: 11.5,
        signal: "NEUTRAL",
      },
    ];

    const whaleTrades: WhaleTrade[] = [
      {
        id: "w-1",
        symbol: "BTCUSDT",
        asset: "BTC",
        side: "BUY",
        price: 85900,
        quantity: 55,
        valueUsd: 4_724_500,
        timestamp: Date.now(),
        isMaker: false,
        venue: "BINANCE_SPOT",
      },
    ];

    const oiMap = new Map<
      string,
      { openInterestUsd: number; openInterestCoins: number }
    >([["BTCUSDT", { openInterestUsd: 7200000000, openInterestCoins: 83720 }]]);

    const rows = service.buildPositioningMatrix(
      tickers,
      fundingRates,
      whaleTrades,
      oiMap,
    );

    const btcRow = rows.find((r) => r.symbol === "BTCUSDT");
    assert.ok(btcRow);
    // Price is down (-1.4%), but whales bought +$4.72M net CVD -> BULLISH_CVD_DIV
    assert.equal(btcRow.divergenceSignal, "BULLISH_CVD_DIV");
    assert.ok(btcRow.smartMoneyLongPercent > 50);
  });
});
