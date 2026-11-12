import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuantActionRadarService } from "../../src/quant/action-radar-service.js";
import { WorldClassQuantService } from "../../src/quant/world-class-alpha.js";
import { OrderbookService } from "../../src/orderbook/orderbook-service.js";
import { DerivativesIntelligenceService } from "../../src/derivatives/derivatives-intelligence.js";
import type { MarketTicker, FundingRateData } from "../../src/types/index.js";

describe("QuantActionRadarService - Senior Executive Signals & Sizing Radar", () => {
  it("synthesizes strong buy and strong sell signals with exact SL, TP, R:R and Russian rationales", () => {
    const quant = new WorldClassQuantService();
    const deriv = new DerivativesIntelligenceService();

    const tickers = new Map<string, MarketTicker>();
    tickers.set("BTCUSDT", {
      symbol: "BTCUSDT",
      price: 88500,
      priceChangePercent24h: 3.5,
      volume24h: 2_500_000_000,
      high24h: 89000,
      low24h: 86000,
      timestamp: Date.now(),
    });
    tickers.set("ETHUSDT", {
      symbol: "ETHUSDT",
      price: 2400,
      priceChangePercent24h: -4.2,
      volume24h: 900_000_000,
      high24h: 2520,
      low24h: 2380,
      timestamp: Date.now(),
    });

    const funding: FundingRateData[] = [
      {
        symbol: "BTCUSDT",
        markPrice: 88510,
        indexPrice: 88500,
        lastFundingRate: -0.00015, // Short squeeze watch
        nextFundingTime: Date.now() + 3600000,
        annualizedAPR: -16.4,
      },
    ];

    const snapBtc = OrderbookService.computeL2Analytics(
      "BTCUSDT",
      [
        ["88000", "50.0"], // Strong bid wall
        ["88100", "15.0"],
      ],
      [
        ["88900", "4.0"],
        ["89000", "5.0"],
      ],
    );

    const confluenceRows = quant.computeMasterConfluenceMatrix({
      tickers,
      fundingRates: funding,
      whaleTrades: [
        {
          id: "w1",
          symbol: "BTCUSDT",
          asset: "BTC",
          side: "BUY",
          price: 88500,
          quantity: 25,
          valueUsd: 2_212_500,
          tier: "MEGA_WHALE",
          timestamp: Date.now(),
        },
      ],
      orderbookSnapshots: (sym) => (sym === "BTCUSDT" ? snapBtc : null),
      btcOptions: deriv.getOptionsSnapshot("BTC"),
      ethOptions: deriv.getOptionsSnapshot("ETH"),
    });

    const radar = QuantActionRadarService.synthesizeRadar({
      confluenceRows,
      tickers,
      fundingRates: funding,
      whaleTrades: [],
      orderbookSnapshots: (sym) => (sym === "BTCUSDT" ? snapBtc : null),
      accountBalanceUsd: 10000,
      riskPercent: 1.0,
    });

    assert.ok(radar.signals.length >= 7);
    assert.ok(radar.totalTracked >= 7);
    assert.ok(radar.overallMarketRegimeRu.length > 5);

    const btcSig = radar.signals.find((s) => s.asset === "BTC");
    assert.ok(btcSig);
    assert.ok(
      btcSig.verdict === "STRONG_BUY" || btcSig.verdict === "ACCUMULATE_DIP",
    );
    assert.equal(btcSig.direction, "LONG");
    assert.ok(btcSig.entryPrice > 0);
    assert.ok(btcSig.stopLossPrice < btcSig.entryPrice);
    assert.ok(btcSig.takeProfit1 > btcSig.entryPrice);
    assert.ok(btcSig.takeProfit2 > btcSig.takeProfit1);
    assert.ok(btcSig.rewardToRisk >= 1.5);
    assert.equal(btcSig.primaryReasonsRu.length, 3);
    assert.ok(btcSig.primaryReasonsRu[0].length > 10);
    assert.ok(
      btcSig.telegramTicketText.includes("APEX // QUANT ACTION SIGNAL"),
    );
    assert.ok(btcSig.telegramTicketText.includes("BTC"));

    // Check filter counts
    assert.equal(radar.totalTracked, radar.signals.length);
    assert.equal(
      radar.buyCount + radar.sellCount + radar.waitCount,
      radar.totalTracked,
    );
    assert.ok(radar.topLongPick !== null);
  });

  it("handles empty or extreme market states gracefully", () => {
    const quant = new WorldClassQuantService();
    const deriv = new DerivativesIntelligenceService();
    const tickers = new Map<string, MarketTicker>();

    const confluenceRows = quant.computeMasterConfluenceMatrix({
      tickers,
      fundingRates: [],
      whaleTrades: [],
      orderbookSnapshots: () => null,
      btcOptions: deriv.getOptionsSnapshot("BTC"),
      ethOptions: deriv.getOptionsSnapshot("ETH"),
    });

    const radar = QuantActionRadarService.synthesizeRadar({
      confluenceRows,
      tickers,
      fundingRates: [],
      whaleTrades: [],
      orderbookSnapshots: () => null,
      accountBalanceUsd: 5000,
      riskPercent: 2.0,
    });

    assert.ok(radar.signals.length >= 7);
    for (const sig of radar.signals) {
      assert.ok(sig.entryPrice > 0);
      assert.ok(sig.stopLossPrice > 0);
      assert.ok(sig.takeProfit1 > 0);
      assert.ok(sig.rewardToRisk > 0);
      assert.ok(sig.verdictLabelRu.length > 0);
    }
  });
});
