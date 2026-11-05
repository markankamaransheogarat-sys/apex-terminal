import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FundingRateCalculator,
  RawBinanceFundingItem,
} from "../../src/feeds/funding-calculator.js";

describe("FundingRateCalculator", () => {
  it("classifies funding regimes correctly", () => {
    assert.equal(FundingRateCalculator.classifyRegime(65.0), "EXTREME_BULL");
    assert.equal(FundingRateCalculator.classifyRegime(25.0), "MODERATE_BULL");
    assert.equal(FundingRateCalculator.classifyRegime(5.0), "NEUTRAL");
    assert.equal(FundingRateCalculator.classifyRegime(-5.0), "NEUTRAL");
    assert.equal(FundingRateCalculator.classifyRegime(-25.0), "MODERATE_BEAR");
    assert.equal(
      FundingRateCalculator.classifyRegime(-65.0),
      "SHORT_SQUEEZE_RISK",
    );
  });

  it("parses single Binance premiumIndex item with accurate APR and APY", () => {
    const raw: RawBinanceFundingItem = {
      symbol: "BTCUSDT",
      markPrice: "94500.50",
      indexPrice: "94480.00",
      lastFundingRate: "0.000100", // 0.01% per 8h
      nextFundingTime: 1731000000000,
      time: 1730990000000,
    };

    const parsed = FundingRateCalculator.parseFundingItem(raw);

    assert.equal(parsed.symbol, "BTCUSDT");
    assert.equal(parsed.markPrice, 94500.5);
    assert.equal(parsed.indexPrice, 94480.0);
    assert.equal(parsed.fundingRate, 0.0001);

    // Annualized APR: 0.0001 * 3 * 365 * 100 = 10.95%
    assert.equal(parsed.annualizedAPR, 10.95);
    // Compounded APY: ((1 + 0.0001)^1095 - 1) * 100 ~ 11.57%
    assert.ok(parsed.annualizedAPY > 11.0 && parsed.annualizedAPY < 12.0);
    assert.equal(parsed.regime, "MODERATE_BULL");
  });

  it("filters and sorts multiple funding rate items by absolute rate descending", () => {
    const rawList: RawBinanceFundingItem[] = [
      {
        symbol: "BTCUSDT",
        markPrice: "94000",
        indexPrice: "94000",
        lastFundingRate: "0.0001", // APR 10.95%
        nextFundingTime: 1731000000000,
      },
      {
        symbol: "PEPEUSDT",
        markPrice: "0.00002",
        indexPrice: "0.00002",
        lastFundingRate: "0.0008", // APR 87.6% (Extreme bull)
        nextFundingTime: 1731000000000,
      },
      {
        symbol: "DOGEUSDT",
        markPrice: "0.40",
        indexPrice: "0.40",
        lastFundingRate: "-0.0006", // APR -65.7% (Short squeeze risk)
        nextFundingTime: 1731000000000,
      },
      {
        symbol: "BTCBUSD", // Not USDT, should be filtered out
        markPrice: "94000",
        indexPrice: "94000",
        lastFundingRate: "0.0001",
        nextFundingTime: 1731000000000,
      },
    ];

    const results = FundingRateCalculator.parseFundingRates(rawList);

    assert.equal(results.length, 3);
    // First should be PEPE (highest absolute APR: 87.6%)
    assert.equal(results[0]!.symbol, "PEPEUSDT");
    assert.equal(results[0]!.regime, "EXTREME_BULL");

    // Second should be DOGE (absolute APR: 65.7%)
    assert.equal(results[1]!.symbol, "DOGEUSDT");
    assert.equal(results[1]!.regime, "SHORT_SQUEEZE_RISK");

    // Third should be BTC
    assert.equal(results[2]!.symbol, "BTCUSDT");
  });

  it("fetches and parses live funding rates with mock fetch", async () => {
    const mockFetch = async () => {
      return {
        ok: true,
        json: async () => [
          {
            symbol: "SOLUSDT",
            markPrice: "200.00",
            indexPrice: "200.00",
            lastFundingRate: "0.00025",
            nextFundingTime: 1731000000000,
          },
        ],
      } as unknown as Response;
    };

    const data = await FundingRateCalculator.fetchLiveFundingRates(
      mockFetch as unknown as typeof fetch,
    );
    assert.equal(data.length, 1);
    assert.equal(data[0]!.symbol, "SOLUSDT");
    assert.equal(data[0]!.annualizedAPR, 27.38); // 0.00025 * 1095 * 100
  });
});
