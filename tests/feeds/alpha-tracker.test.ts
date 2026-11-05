import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AlphaPerformanceTracker } from "../../src/feeds/alpha-tracker.js";
import { InstitutionalAlphaSignal } from "../../src/feeds/whale-cluster-engine.js";

describe("AlphaPerformanceTracker - Signal Attribution & MTM PnL", () => {
  it("tracks LONG and SHORT alpha signals and calculates bps edge & Win Rate", () => {
    const tracker = new AlphaPerformanceTracker();
    const now = Date.now();

    const signals: InstitutionalAlphaSignal[] = [
      {
        id: "sig-test-long-btc",
        timestamp: now - 60000,
        asset: "BTC",
        signalType: "BULLISH_BID_ABSORPTION",
        direction: "LONG",
        conviction: 94,
        headline: "Bullish Bid Absorption",
        rationale: "Market sells absorbed",
        triggerPrice: 76000,
        notionalUsd: 1200000,
        linkedCampaignId: "TR-BTC-0001",
      },
      {
        id: "sig-test-short-eth",
        timestamp: now - 30000,
        asset: "ETH",
        signalType: "ONCHAIN_DUMP_WATCH",
        direction: "SHORT",
        conviction: 91,
        headline: "Confirmed On-Chain Dump",
        rationale: "Mempool inflow + sell clips",
        triggerPrice: 2300,
        notionalUsd: 850000,
        linkedCampaignId: "TR-ETH-0002",
      },
    ];

    const livePrices = new Map<string, number>([
      ["BTCUSDT", 76380], // +50 bps for LONG
      ["ETHUSDT", 2277], // +100 bps for SHORT
    ]);

    const summary = tracker.syncSignalsAndPrices(signals, livePrices);

    assert.ok(summary.totalSignalsTracked >= 2);
    assert.equal(summary.winRatePercent, 100);
    assert.ok(summary.avgEdgeBps >= 50);

    const btcPos = summary.positions.get("sig-test-long-btc");
    assert.ok(btcPos);
    assert.equal(btcPos.returnBps, 50);
    assert.equal(btcPos.status, "WINNING");

    const ethPos = summary.positions.get("sig-test-short-eth");
    assert.ok(ethPos);
    assert.equal(ethPos.returnBps, 100);
  });
});
