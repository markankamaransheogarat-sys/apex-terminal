import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChartService } from "../../src/chart/chart-service.js";
import { Candle } from "../../src/chart/types.js";

describe("ChartService & Technical Calculation Engine", () => {
  it("initializes with default symbol and timeframe", () => {
    const service = new ChartService("BTCUSDT", "1h");
    assert.equal(service.getSymbol(), "BTCUSDT");
    assert.equal(service.getTimeframe(), "1h");
  });

  it("calculates accurate VWAP and Volume Profile POC on synthetic candles", async () => {
    const service = new ChartService("BTCUSDT", "1h");
    const data = await service.loadCandles("BTCUSDT", "1h", 30);

    assert.equal(data.candles.length > 0, true);
    assert.equal(data.vwap.length, data.candles.length);
    assert.equal(data.volumeProfile.length, 24);

    // Minimum price must be strictly less than maximum price
    assert.ok(data.minPrice < data.maxPrice);

    // Exactly one node in Volume Profile must be POC
    const pocNodes = data.volumeProfile.filter((n) => n.isPOC);
    assert.equal(pocNodes.length, 1);
    assert.ok(
      data.pointOfControlPrice >= data.minPrice &&
        data.pointOfControlPrice <= data.maxPrice,
    );
  });

  it("updates latest candle in real-time on live tick arrival", async () => {
    const service = new ChartService("BTCUSDT", "1m");
    await service.loadCandles("BTCUSDT", "1m", 10);

    const initialData = service.buildChartData();
    const lastCandleBefore =
      initialData.candles[initialData.candles.length - 1]!;
    const testPrice = lastCandleBefore.close + 250;

    const updatedData = service.updateWithLiveTick(
      testPrice,
      5.0,
      lastCandleBefore.timestamp + 5000,
    );
    assert.ok(updatedData !== null);

    const lastCandleAfter =
      updatedData.candles[updatedData.candles.length - 1]!;
    assert.equal(lastCandleAfter.close, testPrice);
    assert.ok(lastCandleAfter.high >= testPrice);
  });

  it("detects Smart Money Concepts (FVG, BOS/CHoCH, Order Blocks), MACD & Bollinger Bands", () => {
    const now = Date.now();
    const candles: Candle[] = [
      {
        timestamp: now - 90000,
        open: 80000,
        high: 80100,
        low: 79900,
        close: 80050,
        volume: 100,
      },
      {
        timestamp: now - 80000,
        open: 80050,
        high: 80200,
        low: 80000,
        close: 80150,
        volume: 110,
      },
      // Swing high at index 2 (high = 80500)
      {
        timestamp: now - 70000,
        open: 80150,
        high: 80500,
        low: 80100,
        close: 80200,
        volume: 120,
      },
      // Bearish pullback candles (index 3 & 4)
      {
        timestamp: now - 60000,
        open: 80200,
        high: 80250,
        low: 79950,
        close: 80000,
        volume: 90,
      },
      {
        timestamp: now - 50000,
        open: 80000,
        high: 80050,
        low: 79800,
        close: 79850,
        volume: 150,
      },
      // Impulsive bullish displacement candle creating Bullish FVG and breaking 80500
      {
        timestamp: now - 40000,
        open: 79850,
        high: 80900,
        low: 79850,
        close: 80850,
        volume: 400,
      },
      // Candle 6: low (80600) > candle 4 high (80050) -> Bullish FVG!
      {
        timestamp: now - 30000,
        open: 80850,
        high: 81100,
        low: 80600,
        close: 81000,
        volume: 220,
      },
      {
        timestamp: now - 20000,
        open: 81000,
        high: 81200,
        low: 80900,
        close: 81150,
        volume: 180,
      },
    ];

    const smc = ChartService.detectSmartMoneyConcepts(candles);
    assert.ok(smc.fairValueGaps.length >= 1, "Should detect FVGs");
    assert.ok(
      smc.fairValueGaps.some((f) => f.type === "BULLISH"),
      "Should detect Bullish FVG",
    );
    assert.ok(smc.structureBreaks.length >= 1, "Should detect Bullish BOS");
    assert.ok(smc.orderBlocks.length >= 1, "Should detect Bullish Order Block");

    const macd = ChartService.calculateMACD(candles);
    assert.equal(macd.length, candles.length);
    assert.ok(macd[macd.length - 1]!.macd > 0);

    const bb = ChartService.calculateBollingerBands(candles, 5, 2);
    assert.equal(bb.length, candles.length);
    const lastBb = bb[bb.length - 1]!;
    assert.ok(lastBb.upper > lastBb.middle && lastBb.middle > lastBb.lower);
  });
});
