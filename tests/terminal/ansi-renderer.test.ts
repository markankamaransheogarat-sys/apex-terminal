import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnsiRenderer } from "../../src/terminal/ansi-renderer.js";
import { ReferenceData } from "../../src/risk/sample-data.js";
import { AladdinRiskEngine } from "../../src/risk/aladdin-engine.js";
import { MarketTicker, FundingRateData } from "../../src/types/index.js";

describe("AnsiRenderer", () => {
  it("renders progress meters properly", () => {
    const bar = AnsiRenderer.renderProgressBar(50, 100, 10);
    assert.ok(bar.includes("█████░░░░░"));
  });

  it("renders Ticker Screen without exceptions", () => {
    const ticker: MarketTicker = {
      symbol: "BTCUSDT",
      price: 94500,
      bidPrice: 94499,
      askPrice: 94501,
      high24h: 96000,
      low24h: 93000,
      volume24h: 35000,
      quoteVolume24h: 3300000000,
      priceChange24h: 1500,
      priceChangePercent24h: 1.61,
      timestamp: Date.now(),
      source: "BINANCE_WS",
    };

    const out = AnsiRenderer.renderTickerScreen(ticker);
    assert.ok(out.includes("BTCUSDT"));
    assert.ok(out.includes("$94,500.00"));
    assert.ok(out.includes("BINANCE_WS"));
  });

  it("renders Aladdin Risk Screen without exceptions", () => {
    const port = ReferenceData.getSamplePortfolio();
    const ret = ReferenceData.getCalibratedReturns();

    const v95 = AladdinRiskEngine.calculateParametricVaR(port, ret, 0.95);
    const v99 = AladdinRiskEngine.calculateParametricVaR(port, ret, 0.99);
    const beta = AladdinRiskEngine.calculateBeta(port, ret, "BTC");
    const div = AladdinRiskEngine.calculateDiversification(port, ret);

    const out = AnsiRenderer.renderRiskScreen(v95, v99, beta, div);
    assert.ok(out.includes("BLACKROCK ALADDIN RISK ANALYTICS"));
    assert.ok(out.includes("PARAMETRIC VALUE-AT-RISK"));
    assert.ok(out.includes("COMPONENT VaR DECOMPOSITION"));
    assert.ok(out.includes("Diversification Score"));
  });

  it("renders Funding Screen without exceptions", () => {
    const fundings: FundingRateData[] = [
      {
        symbol: "BTCUSDT",
        markPrice: 94000,
        indexPrice: 94000,
        fundingRate: 0.0001,
        nextFundingTime: Date.now() + 10000,
        annualizedAPR: 10.95,
        annualizedAPY: 11.57,
        regime: "MODERATE_BULL",
        timestamp: Date.now(),
      },
    ];

    const out = AnsiRenderer.renderFundingScreen(fundings);
    assert.ok(out.includes("BINANCE FUTURES FUNDING RATE HEATMAP"));
    assert.ok(out.includes("BTCUSDT"));
    assert.ok(out.includes("10.95%"));
  });

  it("renders Help and Portfolio screens", () => {
    const helpOut = AnsiRenderer.renderHelpScreen();
    assert.ok(helpOut.includes("COMMAND GRAMMAR"));
    assert.ok(helpOut.includes("KEYBOARD SHORTCUTS"));

    const portOut = AnsiRenderer.renderPortfolioScreen(
      ReferenceData.getSamplePortfolio(),
    );
    assert.ok(portOut.includes("PORTFOLIO HOLDINGS"));
    assert.ok(portOut.includes("BTC"));
    assert.ok(portOut.includes("ETH"));
  });
});
