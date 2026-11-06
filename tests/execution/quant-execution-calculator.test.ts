import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuantExecutionCalculator } from "../../src/execution/quant-execution-calculator.js";
import { Candle } from "../../src/chart/types.js";
import { OrderbookService } from "../../src/orderbook/orderbook-service.js";

describe("QuantExecutionCalculator", () => {
  it("calculates 14-period Average True Range (ATR) from OHLC candles", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push({
        timestamp: 1700000000000 + i * 3600000,
        open: 85000,
        high: 85600,
        low: 84600,
        close: 85100,
        volume: 1200,
      });
    }

    const atr = QuantExecutionCalculator.calculateATR(candles, 14);
    assert.equal(atr, 1000);
  });

  it("maps 25x, 50x, and 100x Liquidation Magnet pools anchored to Volume Profile HVN nodes", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 15; i++) {
      candles.push({
        timestamp: 1700000000000 + i * 3600000,
        open: 84800,
        high: 85400,
        low: 84400,
        close: 84900,
        volume: i === 7 ? 25000 : 800, // High Volume Node (POC) around ~84,900
      });
    }

    const snap = QuantExecutionCalculator.calculateLiquidationMagnets(
      "BTCUSDT",
      85000,
      6000000000,
      0.0003, // High positive funding -> crowded longs -> long liquidation pools larger
      candles,
    );

    assert.equal(snap.upperShortSqueezePools.length, 3);
    assert.equal(snap.lowerLongFlushPools.length, 3);
    assert.ok(snap.pocPrice > 84400 && snap.pocPrice < 85400);
    const long50x = snap.lowerLongFlushPools.find((z) => z.tier === "50x");
    const short50x = snap.upperShortSqueezePools.find((z) => z.tier === "50x");
    assert.ok(long50x);
    assert.ok(short50x);
    assert.ok(long50x.priceLevel < 85000);
    assert.ok(short50x.priceLevel > 85000);
    assert.ok(long50x.hvnAnchorPrice > 0);
    // Because funding is strongly positive (+0.03%), crowded long pool should exceed short pool
    assert.ok(long50x.estimatedPoolUsd > short50x.estimatedPoolUsd);
  });

  it("calculates Wall-Protected Stop-Loss, exact 1R risk sizing, and Half-Kelly fraction", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push({
        timestamp: 1700000000000 + i * 3600000,
        open: 85000,
        high: 85200,
        low: 84800,
        close: 85000,
        volume: 1000,
      });
    }

    const ob = OrderbookService.computeL2Analytics(
      "BTCUSDT",
      [
        ["84990", "1.2"],
        ["84600", "28.5"], // Huge L2 Bid Wall at $84,600
        ["84500", "1.0"],
        ["84400", "1.1"],
      ],
      [
        ["85010", "1.1"],
        ["85100", "1.3"],
        ["85200", "1.0"],
        ["85500", "22.0"],
      ],
    );

    const setup = QuantExecutionCalculator.calculateTradeSetup({
      symbol: "BTCUSDT",
      direction: "LONG",
      accountBalanceUsd: 20000,
      riskPercent: 1.0, // $200 risk budget
      currentPrice: 85000,
      candles,
      orderbook: ob,
      whaleCampaigns: [],
      winRatePercent: 60,
    });

    assert.equal(setup.maxRiskDollarUsd, 200);
    // Stop loss should be placed behind the $84,600 Bid Wall minus 0.45 * 400 ($180) = $84,420
    assert.ok(setup.protectedStopLoss < 84600);
    assert.ok(setup.setupRationale.includes("L2 Bid Wall"));

    // Verify that position size * |entry - stop| equals exact $200 risk budget
    const actualLossAtStop =
      setup.positionSizeCoins *
      Math.abs(setup.optimalEntryPrice - setup.protectedStopLoss);
    assert.ok(Math.abs(actualLossAtStop - 200) < 0.5);

    // Half-Kelly for p=0.6, b=2.5: full Kelly = 0.6 - 0.4/2.5 = 0.44 -> Half-Kelly = 22%
    assert.equal(setup.kellyFractionPercent, 22);
  });
});
