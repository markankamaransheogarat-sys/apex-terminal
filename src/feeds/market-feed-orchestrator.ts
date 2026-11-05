/**
 * Apex Unified Market Feed Orchestrator
 * Coordinates Binance & Bybit WebSockets with transparent REST fallback,
 * maintaining an in-memory L1 orderbook/ticker state.
 */

import {
  MarketTicker,
  FundingRateData,
  GlobalMarketMetrics,
} from "../types/index.js";
import { BinanceWsFeedManager } from "./binance-ws.js";
import { BybitWsFeedManager } from "./bybit-ws.js";
import { RestFallbackService } from "./fallback-rest.js";
import { FundingRateCalculator } from "./funding-calculator.js";

export interface FeedOrchestratorOptions {
  symbols?: string[];
  enableBybitSecondary?: boolean;
  restPollingIntervalMs?: number;
  binanceWs?: BinanceWsFeedManager;
  bybitWs?: BybitWsFeedManager;
  restService?: RestFallbackService;
}

export class MarketFeedOrchestrator {
  private readonly symbols: string[];
  private readonly enableBybitSecondary: boolean;
  private readonly restPollingIntervalMs: number;

  private readonly binanceWs: BinanceWsFeedManager;
  private readonly bybitWs: BybitWsFeedManager | null = null;
  private readonly restService: RestFallbackService;

  private tickerBook: Map<string, MarketTicker> = new Map();
  private fundingRates: FundingRateData[] = [];
  private globalMetrics: GlobalMarketMetrics | null = null;

  private restPollTimer: NodeJS.Timeout | null = null;
  private fundingPollTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  private tickerListeners: Array<(ticker: MarketTicker) => void> = [];

  constructor(options: FeedOrchestratorOptions = {}) {
    this.symbols = options.symbols
      ? options.symbols.map((s) => s.toUpperCase())
      : [...BinanceWsFeedManager.DEFAULT_SYMBOLS];

    this.enableBybitSecondary = options.enableBybitSecondary ?? true;
    this.restPollingIntervalMs = options.restPollingIntervalMs ?? 10000;

    this.binanceWs =
      options.binanceWs ?? new BinanceWsFeedManager({ symbols: this.symbols });
    this.bybitWs =
      options.bybitWs ??
      (this.enableBybitSecondary
        ? new BybitWsFeedManager({ symbols: this.symbols })
        : null);
    this.restService = options.restService ?? new RestFallbackService();

    this.setupListeners();
  }

  private setupListeners(): void {
    // Primary: Binance WS
    this.binanceWs.onTicker((ticker) => {
      this.updateTicker(ticker);
    });

    // Secondary: Bybit WS (updates if Binance hasn't ticked recently)
    if (this.bybitWs) {
      this.bybitWs.onTicker((ticker) => {
        const existing = this.tickerBook.get(ticker.symbol);
        // Only override if no existing ticker or existing ticker is older than 2 seconds
        if (!existing || Date.now() - existing.timestamp > 2000) {
          this.updateTicker(ticker);
        }
      });
    }

    // Monitor WS states for fallback
    this.binanceWs.onStateChange((state) => {
      if (state === "STALE" || state === "DISCONNECTED") {
        this.triggerImmediateRestFallback();
      }
    });
  }

  public updateTicker(ticker: MarketTicker): void {
    this.tickerBook.set(ticker.symbol, ticker);
    // Also store clean base key e.g. BTC for BTCUSDT
    const base = ticker.symbol.replace("USDT", "");
    if (base !== ticker.symbol) {
      this.tickerBook.set(base, ticker);
    }

    for (const listener of this.tickerListeners) {
      try {
        listener(ticker);
      } catch (err) {
        console.error("[FeedOrchestrator] Listener error:", err);
      }
    }
  }

  public onTicker(listener: (ticker: MarketTicker) => void): () => void {
    this.tickerListeners.push(listener);
    return () => {
      this.tickerListeners = this.tickerListeners.filter((l) => l !== listener);
    };
  }

  public getTicker(symbol: string): MarketTicker | undefined {
    const upper = symbol.toUpperCase();
    return this.tickerBook.get(upper) ?? this.tickerBook.get(`${upper}USDT`);
  }

  public getAllTickers(): MarketTicker[] {
    // Return only unique symbol entries that end with USDT or are non-duplicates
    const set = new Set<string>();
    const result: MarketTicker[] = [];
    for (const [key, ticker] of this.tickerBook.entries()) {
      if (key.endsWith("USDT") && !set.has(ticker.symbol)) {
        set.add(ticker.symbol);
        result.push(ticker);
      }
    }
    return result;
  }

  public getFundingRates(): FundingRateData[] {
    return this.fundingRates;
  }

  public getGlobalMetrics(): GlobalMarketMetrics | null {
    return this.globalMetrics;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Initial REST snapshot for instant readiness
    await this.triggerImmediateRestFallback();
    await this.refreshFundingRates();
    await this.refreshGlobalMetrics();

    // 2. Connect WebSockets
    this.binanceWs.connect();
    if (this.bybitWs) {
      this.bybitWs.connect();
    }

    // 3. Setup recurring background refresh for funding rates (every 60s)
    this.fundingPollTimer = setInterval(() => {
      this.refreshFundingRates().catch((e) =>
        console.error("[FeedOrchestrator] Funding refresh error:", e),
      );
    }, 60000);

    // 4. Setup watchdog REST polling when WS is offline
    this.restPollTimer = setInterval(() => {
      const binanceState = this.binanceWs.getState();
      const bybitState = this.bybitWs?.getState() ?? "DISCONNECTED";

      if (binanceState !== "CONNECTED" && bybitState !== "CONNECTED") {
        this.triggerImmediateRestFallback().catch((e) =>
          console.error("[FeedOrchestrator] Fallback poll error:", e),
        );
      }
    }, this.restPollingIntervalMs);
  }

  public async triggerImmediateRestFallback(): Promise<void> {
    try {
      const tickers = await this.restService.fetchBinance24hrTickers(
        this.symbols,
      );
      for (const t of tickers) {
        this.updateTicker(t);
      }
    } catch (err) {
      console.error("[FeedOrchestrator] Failed REST fallback poll:", err);
    }
  }

  public async refreshFundingRates(): Promise<FundingRateData[]> {
    try {
      const data = await FundingRateCalculator.fetchLiveFundingRates(
        globalThis.fetch,
        this.symbols,
      );
      this.fundingRates = data;
      return data;
    } catch (err) {
      console.error("[FeedOrchestrator] Failed to fetch funding rates:", err);
      return this.fundingRates;
    }
  }

  public async refreshGlobalMetrics(): Promise<GlobalMarketMetrics | null> {
    try {
      const metrics = await this.restService.fetchGlobalMetrics();
      this.globalMetrics = metrics;
      return metrics;
    } catch (err) {
      console.error(
        "[FeedOrchestrator] Failed to refresh global metrics:",
        err,
      );
      return this.globalMetrics;
    }
  }

  public stop(): void {
    this.isRunning = false;
    this.binanceWs.disconnect();
    if (this.bybitWs) {
      this.bybitWs.disconnect();
    }
    if (this.restPollTimer) {
      clearInterval(this.restPollTimer);
      this.restPollTimer = null;
    }
    if (this.fundingPollTimer) {
      clearInterval(this.fundingPollTimer);
      this.fundingPollTimer = null;
    }
  }
}
