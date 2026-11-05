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
});
