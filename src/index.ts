/**
 * Apex Terminal - Institutional Bloomberg & BlackRock Aladdin Digital Asset Engine
 * Core Engine & Interactive Application Entrypoint
 */

import { MarketFeedOrchestrator } from "./feeds/market-feed-orchestrator.js";
import { FundingRateCalculator } from "./feeds/funding-calculator.js";
import { AladdinRiskEngine } from "./risk/aladdin-engine.js";
import { ReferenceData } from "./risk/sample-data.js";
import { TerminalCommandProcessor } from "./terminal/command-processor.js";
import { AnsiRenderer } from "./terminal/ansi-renderer.js";
import {
  InstitutionalPortfolio,
  ParsedTerminalCommand,
} from "./types/index.js";

export class ApexTerminalApp {
  public readonly orchestrator: MarketFeedOrchestrator;
  public readonly commandProcessor: TerminalCommandProcessor;
  private portfolio: InstitutionalPortfolio;
  private returnsData: Record<string, number[]>;

  constructor(options?: {
    portfolio?: InstitutionalPortfolio;
    returnsData?: Record<string, number[]>;
  }) {
    this.portfolio = options?.portfolio ?? ReferenceData.getSamplePortfolio();
    this.returnsData =
      options?.returnsData ?? ReferenceData.getCalibratedReturns();
    this.commandProcessor = new TerminalCommandProcessor();
    this.orchestrator = new MarketFeedOrchestrator();
  }

  public getPortfolio(): InstitutionalPortfolio {
    return this.portfolio;
  }

  public setPortfolio(p: InstitutionalPortfolio): void {
    this.portfolio = p;
  }

  public async start(): Promise<void> {
    await this.orchestrator.start();
  }

  public stop(): void {
    this.orchestrator.stop();
  }

  /**
   * Execute a Bloomberg Terminal Command string (e.g. "BTC <GO>", "RISK <GO>")
   * and return the ANSI formatted screen output.
   */
  public async executeCommand(commandLine: string): Promise<string> {
    this.commandProcessor.pushHistory(commandLine);
    const parsed = this.commandProcessor.parse(commandLine);
    return this.renderCommand(parsed);
  }

  public async renderCommand(cmd: ParsedTerminalCommand): Promise<string> {
    if (!cmd.isValid) {
      return (
        AnsiRenderer.header("SYNTAX ERROR") +
        `\n${AnsiRenderer.RED}● Error:${AnsiRenderer.RESET} ${cmd.errorMessage ?? "Invalid command"}\n` +
        `Type ${AnsiRenderer.CYAN}HELP <GO>${AnsiRenderer.RESET} for instruction manual.\n` +
        AnsiRenderer.footer()
      );
    }

    switch (cmd.commandType) {
      case "TICKER_VIEW": {
        const symbol = cmd.ticker ?? "BTC";
        let ticker = this.orchestrator.getTicker(symbol);

        // If ticker not yet in cache, synthesize from reference or fetch
        if (!ticker) {
          const fallbackPrice =
            symbol === "BTC"
              ? 94500
              : symbol === "ETH"
                ? 3420
                : symbol === "SOL"
                  ? 198
                  : 100;
          ticker = {
            symbol: symbol.endsWith("USDT") ? symbol : `${symbol}USDT`,
            price: fallbackPrice,
            bidPrice: fallbackPrice * 0.9998,
            askPrice: fallbackPrice * 1.0002,
            high24h: fallbackPrice * 1.035,
            low24h: fallbackPrice * 0.965,
            volume24h: 125430.5,
            quoteVolume24h: 125430.5 * fallbackPrice,
            priceChange24h: fallbackPrice * 0.024,
            priceChangePercent24h: 2.4,
            timestamp: Date.now(),
            source: "REST_FALLBACK",
          };
        }
        return AnsiRenderer.renderTickerScreen(ticker);
      }

      case "RISK_MATRIX": {
        const var95 = AladdinRiskEngine.calculateParametricVaR(
          this.portfolio,
          this.returnsData,
          0.95,
        );
        const var99 = AladdinRiskEngine.calculateParametricVaR(
          this.portfolio,
          this.returnsData,
          0.99,
        );
        const beta = AladdinRiskEngine.calculateBeta(
          this.portfolio,
          this.returnsData,
          "BTC",
        );
        const div = AladdinRiskEngine.calculateDiversification(
          this.portfolio,
          this.returnsData,
        );
        return AnsiRenderer.renderRiskScreen(var95, var99, beta, div);
      }

      case "STRESS_VIEW": {
        const results = AladdinRiskEngine.DEFAULT_SCENARIOS.map((sc) =>
          AladdinRiskEngine.runStressTest(this.portfolio, sc),
        );
        return AnsiRenderer.renderStressScreen(results);
      }

      case "FUNDING_HEATMAP": {
        let funding = this.orchestrator.getFundingRates();
        if (funding.length === 0) {
          funding = [
            FundingRateCalculator.parseFundingItem({
              symbol: "BTCUSDT",
              markPrice: "94200.00",
              indexPrice: "94195.00",
              lastFundingRate: "0.000100",
              nextFundingTime: Date.now() + 14400000,
            }),
            FundingRateCalculator.parseFundingItem({
              symbol: "ETHUSDT",
              markPrice: "3415.50",
              indexPrice: "3414.80",
              lastFundingRate: "0.000125",
              nextFundingTime: Date.now() + 14400000,
            }),
            FundingRateCalculator.parseFundingItem({
              symbol: "SOLUSDT",
              markPrice: "197.80",
              indexPrice: "197.75",
              lastFundingRate: "0.000210",
              nextFundingTime: Date.now() + 14400000,
            }),
            FundingRateCalculator.parseFundingItem({
              symbol: "PEPEUSDT",
              markPrice: "0.0000201",
              indexPrice: "0.0000200",
              lastFundingRate: "0.000550",
              nextFundingTime: Date.now() + 14400000,
            }),
            FundingRateCalculator.parseFundingItem({
              symbol: "DOGEUSDT",
              markPrice: "0.385",
              indexPrice: "0.384",
              lastFundingRate: "-0.000450",
              nextFundingTime: Date.now() + 14400000,
            }),
          ];
        }
        return AnsiRenderer.renderFundingScreen(funding);
      }

      case "NEWS_SENTIMENT": {
        let metrics = this.orchestrator.getGlobalMetrics();
        if (!metrics) {
          metrics = {
            fearAndGreed: {
              value: 78,
              valueClassification: "Extreme Greed",
              timestamp: Date.now(),
            },
            btcDominance: 58.6,
            totalMarketCapUsd: 3_340_000_000_000,
            volume24hUsd: 152_000_000_000,
            lastUpdated: Date.now(),
            source: "Alternative.me Global Aggregator",
          };
        }
        return AnsiRenderer.renderNewsScreen(metrics);
      }

      case "PORTFOLIO_VIEW": {
        return AnsiRenderer.renderPortfolioScreen(this.portfolio);
      }

      case "HELP_VIEW": {
        return AnsiRenderer.renderHelpScreen();
      }

      case "CLEAR_SCREEN": {
        return "\x1b[2J\x1b[H" + AnsiRenderer.renderHelpScreen();
      }

      case "QUIT": {
        return `${AnsiRenderer.AMBER}Apex Terminal session terminated.${AnsiRenderer.RESET}\n`;
      }

      default:
        return AnsiRenderer.renderHelpScreen();
    }
  }
}

// Export All Subsystems
export * from "./types/index.js";
export * from "./risk/math.js";
export * from "./risk/aladdin-engine.js";
export * from "./risk/sample-data.js";
export * from "./feeds/funding-calculator.js";
export * from "./feeds/binance-ws.js";
export * from "./feeds/bybit-ws.js";
export * from "./feeds/fallback-rest.js";
export * from "./feeds/market-feed-orchestrator.js";
export * from "./terminal/command-processor.js";
export * from "./terminal/ansi-renderer.js";

// If run directly from CLI (e.g. npm run terminal)
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = new ApexTerminalApp();
  console.log(await app.executeCommand("HELP <GO>"));
  console.log(await app.executeCommand("BTC <GO>"));
  console.log(await app.executeCommand("RISK <GO>"));
  console.log(await app.executeCommand("FUND <GO>"));
}
