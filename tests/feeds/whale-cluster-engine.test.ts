import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WhaleClusterEngine,
  WhalePersistenceStore,
} from "../../src/feeds/whale-cluster-engine.js";
import { WhaleTrade } from "../../src/feeds/whale-stream.js";

describe("WhaleClusterEngine - 4-Factor Microstructure Tranche Linking", () => {
  it("should link uniform whale orders into an ICEBERG_CLIP campaign", () => {
    const baseTime = 1793895000000;
    const trades: WhaleTrade[] = [
      {
        id: "t1",
        symbol: "BTCUSDT",
        asset: "BTC",
        side: "BUY",
        price: 76900,
        quantity: 8.0,
        valueUsd: 615200,
        timestamp: baseTime,
        venue: "BINANCE_SPOT",
        ordersSwept: 12,
      },
      {
        id: "t2",
        symbol: "BTCUSDT",
        asset: "BTC",
        side: "BUY",
        price: 76920,
        quantity: 8.05,
        valueUsd: 619206,
        timestamp: baseTime + 30000,
        venue: "BINANCE_SPOT",
        ordersSwept: 15,
      },
      {
        id: "t3",
        symbol: "BTCUSDT",
        asset: "BTC",
        side: "BUY",
        price: 76950,
        quantity: 7.98,
        valueUsd: 614061,
        timestamp: baseTime + 60000,
        venue: "BINANCE_SPOT",
        ordersSwept: 14,
      },
    ];

    const campaigns = WhaleClusterEngine.clusterTrades(trades);
    assert.equal(campaigns.length, 1);

    const c = campaigns[0]!;
    assert.equal(c.trancheCount, 3);
    assert.equal(c.algoType, "ICEBERG_CLIP");
    assert.equal(c.side, "BUY");
    assert.equal(c.asset, "BTC");
    assert.ok(c.lotUniformityScore >= 85);
    assert.equal(c.totalOrdersSwept, 41);
    assert.ok(c.priceImpactBps > 0);
    assert.ok(c.confidenceScore >= 75);
  });

  it("should detect CROSS_VENUE_SWEEP when a whale sweeps Binance Spot and Bybit Perp", () => {
    const baseTime = 1793895500000;
    const trades: WhaleTrade[] = [
      {
        id: "cv1",
        symbol: "ETHUSDT",
        asset: "ETH",
        side: "SELL",
        price: 2265.0,
        quantity: 120,
        valueUsd: 271800,
        timestamp: baseTime,
        venue: "BINANCE_SPOT",
        ordersSwept: 18,
      },
      {
        id: "cv2",
        symbol: "ETHUSDT",
        asset: "ETH",
        side: "SELL",
        price: 2263.5,
        quantity: 250,
        valueUsd: 565875,
        timestamp: baseTime + 2000,
        venue: "BYBIT_PERP",
        ordersSwept: 9,
      },
    ];

    const campaigns = WhaleClusterEngine.clusterTrades(trades);
    assert.equal(campaigns.length, 1);

    const c = campaigns[0]!;
    assert.equal(c.trancheCount, 2);
    assert.equal(c.algoType, "CROSS_VENUE_SWEEP");
    assert.ok(c.venues.includes("BINANCE_SPOT"));
    assert.ok(c.venues.includes("BYBIT_PERP"));
    assert.equal(c.totalQuantity, 370);
  });

  it("should separate unrelated trades across different sides or outside the 15-minute window", () => {
    const baseTime = 1793896000000;
    const trades: WhaleTrade[] = [
      {
        id: "s1",
        symbol: "SOLUSDT",
        asset: "SOL",
        side: "BUY",
        price: 138.0,
        quantity: 1000,
        valueUsd: 138000,
        timestamp: baseTime,
        venue: "BINANCE_SPOT",
      },
      {
        id: "s2",
        symbol: "SOLUSDT",
        asset: "SOL",
        side: "SELL",
        price: 137.5,
        quantity: 1000,
        valueUsd: 137500,
        timestamp: baseTime + 5000,
        venue: "BINANCE_SPOT",
      },
      {
        id: "s3",
        symbol: "SOLUSDT",
        asset: "SOL",
        side: "BUY",
        price: 139.0,
        quantity: 1000,
        valueUsd: 139000,
        timestamp: baseTime + 25 * 60 * 1000,
        venue: "BINANCE_SPOT",
      },
    ];

    const campaigns = WhaleClusterEngine.clusterTrades(trades);
    assert.equal(campaigns.length, 3);
  });

  it("should support 24h persistence fallback gracefully in Node test environment", async () => {
    const store = new WhalePersistenceStore();
    const loaded = await store.loadAll24hTrades();
    assert.ok(Array.isArray(loaded));
  });
});
