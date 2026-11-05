import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChartService } from "../../src/chart/chart-service.js";

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
});
