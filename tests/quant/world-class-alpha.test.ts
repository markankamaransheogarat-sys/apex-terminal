import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WorldClassQuantService } from "../../src/quant/world-class-alpha.js";
import { OrderbookService } from "../../src/orderbook/orderbook-service.js";
import { DerivativesIntelligenceService } from "../../src/derivatives/derivatives-intelligence.js";
import type { MarketTicker, FundingRateData } from "../../src/types/index.js";

describe("WorldClassQuantService - Spot vs Perp CVD, Coinbase Premium, StatArb & 6-Factor Confluence", () => {
  it("computes Net Taker Buy/Sell CVD from Binance klines and detects BULLISH_SPOT_ABSORPTION", () => {
    const spotKlines = [
      // [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote]
      [
        0,
        "100",
        "105",
        "99",
        "104",
        "1000",
        0,
        "100000000",
        100,
        "700",
        "72000000",
      ], // +$44M net spot buy
      [
        1,
        "104",
        "106",
        "103",
        "105",
        "800",
        0,
        "80000000",
        100,
        "550",
        "56000000",
      ], // +$32M net spot buy
    ];
    const perpKlines = [
      [
        0,
        "100",
        "105",
        "99",
        "104",
        "2000",
        0,
        "200000000",
        100,
        "800",
        "80000000",
      ], // -$40M net perp sell
    ];

    const spotCvdUsd =
      WorldClassQuantService.computeCvdFromBinanceKlines(spotKlines);
    const perpCvdUsd =
      WorldClassQuantService.computeCvdFromBinanceKlines(perpKlines);

    assert.equal(spotCvdUsd, 76000000);
    assert.equal(perpCvdUsd, -40000000);

    const flow = WorldClassQuantService.evaluateSpotPerpMetrics(
      "BTCUSDT",
      75000,
      75090, // +12 bps Coinbase premium
      spotCvdUsd,
      perpCvdUsd,
    );

    assert.equal(flow.regime, "BULLISH_SPOT_ABSORPTION");
    assert.ok(flow.coinbasePremiumBps > 11.5);
    assert.ok(flow.spotVsPerpDeltaUsd > 100000000);
  });

  it("computes Statistical Arbitrage (StatArb) OLS Hedge Beta, Z-Score, and Ornstein-Uhlenbeck Half-Life", () => {
    const returnsMap: Record<string, number[]> = {
      ETH: [],
      BTC: [],
      SOL: [],
      SUI: [],
      BNB: [],
      XRP: [],
      DOGE: [],
    };

    // Create 60 days of cointegrated returns where ETH lags BTC on the final 3 days
    for (let i = 0; i < 60; i++) {
      const btcRet = Math.sin(i * 0.3) * 0.02;
      const ethRet =
        i >= 57
          ? btcRet - 0.035 // Sharp downward divergence in ETH on final days -> negative Z-score
          : btcRet * 1.15 + Math.cos(i * 0.5) * 0.002;
      returnsMap.BTC!.push(btcRet);
      returnsMap.ETH!.push(ethRet);
      returnsMap.SOL!.push(btcRet * 1.3);
      returnsMap.SUI!.push(btcRet * 1.4);
      returnsMap.BNB!.push(btcRet * 0.85);
      returnsMap.XRP!.push(btcRet * 0.9);
      returnsMap.DOGE!.push(btcRet * 1.25);
    }

    const tickers = new Map<string, MarketTicker>();
    tickers.set("ETHUSDT", {
      symbol: "ETHUSDT",
      price: 2400,
      priceChangePercent24h: -3.5,
      volume24h: 800_000_000,
      high24h: 2500,
      low24h: 2380,
      timestamp: Date.now(),
    });
    tickers.set("BTCUSDT", {
      symbol: "BTCUSDT",
      price: 75000,
      priceChangePercent24h: 0.5,
      volume24h: 1_500_000_000,
      high24h: 76000,
      low24h: 74000,
      timestamp: Date.now(),
    });

    const statArb = WorldClassQuantService.computeStatArbMatrix(
      returnsMap,
      tickers,
    );
    assert.ok(statArb.length >= 4);

    const ethBtc = statArb.find((p) => p.pairLabel === "ETH / BTC");
    assert.ok(ethBtc);
    assert.ok(ethBtc.correlation60d > 0.5);
    assert.ok(ethBtc.hedgeBeta > 0.5);
    assert.ok(ethBtc.spreadZScore <= -1.6);
    assert.equal(ethBtc.signal, "STATARB_LONG_A_SHORT_B");
    assert.ok(ethBtc.halfLifeDays >= 1 && ethBtc.halfLifeDays <= 45);
  });

  it("computes the 6-Factor Master Institutional Confluence Matrix (-100 to +100)", () => {
    const quant = new WorldClassQuantService();
    const deriv = new DerivativesIntelligenceService();
    const tickers = new Map<string, MarketTicker>();
    tickers.set("BTCUSDT", {
      symbol: "BTCUSDT",
      price: 75000,
      priceChangePercent24h: 4.2,
      volume24h: 1_800_000_000,
      high24h: 75800,
      low24h: 72000,
      timestamp: Date.now(),
    });

    const funding: FundingRateData[] = [
      {
        symbol: "BTCUSDT",
        markPrice: 75010,
        indexPrice: 75000,
        lastFundingRate: -0.0001, // Negative funding -> short squeeze fuel
        nextFundingTime: Date.now() + 3600000,
        annualizedAPR: -10.95,
      },
    ];
    const snap = OrderbookService.computeL2Analytics(
      "BTCUSDT",
      [
        ["74990", "25.0"],
        ["74980", "5.0"],
      ],
      [
        ["75010", "2.0"],
        ["75020", "2.0"],
      ],
    );

    const rows = quant.computeMasterConfluenceMatrix({
      tickers,
      fundingRates: funding,
      whaleTrades: [
        {
          id: "w1",
          symbol: "BTCUSDT",
          asset: "BTC",
          side: "BUY",
          price: 75000,
          quantity: 12,
          valueUsd: 900_000,
          tier: "MEGA_WHALE",
          timestamp: Date.now(),
        },
      ],
      orderbookSnapshots: (sym) => (sym === "BTCUSDT" ? snap : null),
      btcOptions: deriv.getOptionsSnapshot("BTC"),
      ethOptions: deriv.getOptionsSnapshot("ETH"),
    });

    assert.equal(rows.length, 7);
    const btc = rows.find((r) => r.asset === "BTC")!;
    assert.ok(btc);
    assert.ok(btc.masterScore > 30);
    assert.equal(btc.recommendedDirection, "LONG");
    assert.ok(
      btc.grade === "B+ ACCUMULATE LONG" ||
        btc.grade === "A+ INSTITUTIONAL LONG",
    );
  });
});
