import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExecutionBlotterService } from "../../src/execution/execution-blotter.js";
import { QuantExecutionCalculator } from "../../src/execution/quant-execution-calculator.js";

describe("ExecutionBlotterService - 1-Click Live Position Blotter & Auto-Breakeven", () => {
  it("opens a position from QuantTradeSetup and automatically books TP1 + locks Breakeven Stop", () => {
    const blotter = new ExecutionBlotterService();
    const setup = QuantExecutionCalculator.calculateTradeSetup({
      symbol: "BTCUSDT",
      direction: "LONG",
      accountBalanceUsd: 10000,
      riskPercent: 1.0, // $100 risk budget
      currentPrice: 80000,
      candles: [],
      orderbook: null,
      whaleCampaigns: [],
      winRatePercent: 64,
    });

    const pos = blotter.openPositionFromSetup(setup);
    assert.equal(pos.status, "OPEN");
    assert.equal(pos.tp1Hit, false);
    assert.equal(pos.isBreakevenStop, false);

    // Move live price above TP1 (1.5R)
    const prices = new Map<string, number>([
      ["BTCUSDT", setup.takeProfit1_15R + 50],
    ]);
    blotter.updateWithLivePrices(prices);

    const summaryAfterTp1 = blotter.getSummary();
    const updated = summaryAfterTp1.openPositions.find((p) => p.id === pos.id);
    assert.ok(updated);
    assert.equal(updated.tp1Hit, true);
    assert.equal(updated.isBreakevenStop, true);
    assert.equal(updated.stopLossPrice, updated.entryPrice);
    assert.ok(updated.realizedPnlUsd > 0);
    assert.ok(updated.remainingSizeCoins < updated.initialSizeCoins);

    // Now simulate full TP3 magnet hit
    prices.set("BTCUSDT", setup.takeProfit3_Magnet + 100);
    blotter.updateWithLivePrices(prices);

    const summaryAfterTp3 = blotter.getSummary();
    const closed = summaryAfterTp3.closedPositions.find((p) => p.id === pos.id);
    assert.ok(closed);
    assert.equal(closed.status, "CLOSED_TP");
    assert.equal(closed.remainingSizeCoins, 0);
    assert.ok(closed.totalPnlUsd > 150);
  });

  it("supports manual Breakeven SL lock and 1-click Market Close", () => {
    const blotter = new ExecutionBlotterService();
    const setup = QuantExecutionCalculator.calculateTradeSetup({
      symbol: "ETHUSDT",
      direction: "SHORT",
      accountBalanceUsd: 10000,
      riskPercent: 1.0,
      currentPrice: 2500,
      candles: [],
      orderbook: null,
      whaleCampaigns: [],
    });

    const pos = blotter.openPositionFromSetup(setup);
    assert.equal(blotter.moveStopToBreakeven(pos.id), true);
    assert.equal(pos.isBreakevenStop, true);
    assert.equal(pos.stopLossPrice, pos.entryPrice);

    // Close manually at $2,420 (profitable short)
    assert.equal(blotter.closePositionAtMarket(pos.id, 2420), true);
    assert.equal(pos.status, "CLOSED_MANUAL");
    assert.ok(pos.totalPnlUsd > 0);
  });
});
