import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OrderbookService } from "../../src/orderbook/orderbook-service.js";

describe("OrderbookService - Senior Quant L2 Microstructure & Liquidity Walls", () => {
  it("computes Stoikov Micro-Price, OBI-20, and detects Liquidity Walls (>=2.2x mean)", () => {
    const rawBids: Array<[string, string]> = [
      ["76900.0", "8.0"], // Top bid: heavy 8 BTC ($615.2k)
      ["76890.0", "1.0"],
      ["76880.0", "1.0"],
      ["76850.0", "25.0"], // Massive Bid Wall: 25 BTC ($1.92M)
      ["76840.0", "1.0"],
      ["76830.0", "1.0"],
    ];

    const rawAsks: Array<[string, string]> = [
      ["76910.0", "2.0"], // Top ask: lighter 2 BTC ($153.8k)
      ["76920.0", "1.0"],
      ["76930.0", "1.0"],
      ["76950.0", "18.0"], // Ask Wall: 18 BTC ($1.38M)
      ["76960.0", "1.0"],
      ["76970.0", "1.0"],
    ];

    const snap = OrderbookService.computeL2Analytics(
      "BTCUSDT",
      rawBids,
      rawAsks,
    );

    assert.equal(snap.symbol, "BTCUSDT");
    assert.equal(snap.asset, "BTC");
    assert.equal(snap.bestBid, 76900);
    assert.equal(snap.bestAsk, 76910);
    assert.equal(snap.midPrice, 76905);

    // Since top bid (8 BTC) > top ask (2 BTC), Stoikov micro-price must be skewed above midPrice (> 76905)
    assert.ok(snap.microPrice > snap.midPrice);
    assert.ok(snap.microPriceSkewBps > 0);

    // Total bid depth > total ask depth -> positive OBI-20
    assert.ok(snap.obi20Percent > 15);
    assert.equal(snap.regime, "STRONG_BID_SUPPORT");

    // Wall detection: 76850 bid wall and 76950 ask wall
    assert.ok(snap.biggestBidWall);
    assert.equal(snap.biggestBidWall.price, 76850);
    assert.equal(snap.biggestBidWall.isWall, true);

    assert.ok(snap.biggestAskWall);
    assert.equal(snap.biggestAskWall.price, 76950);
    assert.equal(snap.biggestAskWall.isWall, true);
  });

  it("groups 1000-level orderbooks into price buckets and extracts Top 4 Bid/Ask Capital Concentration Zones", () => {
    const rawBids: Array<[string, string]> = [
      ["76908.0", "2.0"],
      ["76902.0", "3.0"], // Both in 76900 bucket when step = $50 -> 5 BTC
      ["76845.0", "12.0"],
      ["76810.0", "18.0"], // Both in 76800 bucket when step = $50 -> 30 BTC (Whale Capital Pool)
      ["76720.0", "4.0"],
      ["76650.0", "6.0"],
    ];

    const rawAsks: Array<[string, string]> = [
      ["76912.0", "1.5"],
      ["76940.0", "2.5"], // Both in 76950 bucket when step = $50 -> 4 BTC
      ["77010.0", "15.0"],
      ["77040.0", "20.0"], // Both in 77050 bucket when step = $50 -> 35 BTC (Whale Capital Pool)
      ["77120.0", "5.0"],
    ];

    const snap = OrderbookService.computeL2Analytics(
      "BTCUSDT",
      rawBids,
      rawAsks,
    );

    const grouped = OrderbookService.groupOrderbookByBucket(snap, 50);
    assert.equal(grouped.bucketStepUsd, 50);
    assert.ok(grouped.availableBuckets.length >= 5);

    // Top Bid Cluster must be the $76,800 bucket with 30 BTC
    assert.ok(grouped.topBidClusters.length >= 3);
    assert.equal(grouped.topBidClusters[0]?.priceBucket, 76800);
    assert.equal(grouped.topBidClusters[0]?.quantity, 30);
    assert.equal(grouped.topBidClusters[0]?.levelsMerged, 2);
    assert.ok(grouped.topBidClusters[0]!.shareOfSidePercent > 50);

    // Top Ask Cluster must be the $77,050 bucket with 35 BTC
    assert.ok(grouped.topAskClusters.length >= 2);
    assert.equal(grouped.topAskClusters[0]?.priceBucket, 77050);
    assert.equal(grouped.topAskClusters[0]?.quantity, 35);
    assert.equal(grouped.topAskClusters[0]?.levelsMerged, 2);
    assert.ok(grouped.topAskClusters[0]!.shareOfSidePercent > 50);
  });
});
