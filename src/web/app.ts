/**
 * Apex Terminal - Institutional Web Application
 * Bloomberg Terminal & BlackRock Aladdin Web Experience for Digital Assets.
 * Includes:
 * 1. Live Market Matrix & Real-time Bid/Ask Orderflow
 * 2. Real-time Whale Radar & Block Flow Stream
 * 3. Binance Futures !forceOrder Liquidation Stream
 * 4. Ultra-Fast Canvas Candlestick, VWAP & Volume Profile Chart (CHART <GO>)
 * 5. BlackRock Aladdin Risk Engine & Real 60-Day Return Covariance (RISK <GO>)
 * 6. Institutional Cash & Carry Basis Arbitrage Matrix (ARB <GO>)
 * 7. Perpetual Funding Rate Heatmap & Squeeze Detector (FUND <GO>)
 * 8. Live Crypto News Wire & NLP Sentiment Engine (NEWS <GO>)
 * 9. On-Chain Mempool Sat/vB Vitality & Futures Open Interest (MACRO <GO>)
 * 10. Verified Reserves & Custom Personal Wallet Ledger (PORT <GO>)
 * 11. Browser Audio & Push Alerts Notification System (ALERT <GO>)
 */

import { BinanceWsFeedManager, BinanceWsState } from "../feeds/binance-ws.js";
import { FundingRateCalculator } from "../feeds/funding-calculator.js";
import { RestFallbackService } from "../feeds/fallback-rest.js";
import { AladdinRiskEngine } from "../risk/aladdin-engine.js";
import {
  ReferenceData,
  PortfolioPresetId,
  PortfolioPresetInfo,
} from "../risk/sample-data.js";
import { HistoricalReturnsService } from "../feeds/historical-returns.js";
import {
  WhaleStreamManager,
  WhaleTrade,
  LiquidationEvent,
} from "../feeds/whale-stream.js";
import { OnChainVitalityService } from "../feeds/onchain-vitality.js";
import {
  MarketTicker,
  InstitutionalPortfolio,
  AssetPosition,
  FundingRateData,
  FearAndGreedData,
  PositionStressImpact,
} from "../types/index.js";
import {
  playTerminalKey,
  playTickerTick,
  playCommandGo,
  playWhalePing,
  playLiquidationZap,
  toggleMute,
  isMuted,
} from "../audio.js";

// New Institutional Modules
import { ChartService } from "../chart/chart-service.js";
import { CanvasChartRenderer } from "../chart/canvas-renderer.js";
import { ChartTimeframe } from "../chart/types.js";
import { BasisArbitrageCalculator } from "../arbitrage/basis-calculator.js";
import { NewsService } from "../news/news-service.js";
import { NewsWireSnapshot } from "../news/types.js";
import { AlertManager } from "../alerts/alert-manager.js";

class ApexWebTerminal {
  private binanceWs: BinanceWsFeedManager;
  private restService: RestFallbackService;
  private whaleStream: WhaleStreamManager;
  private onChainService: OnChainVitalityService;
  private returnsService: HistoricalReturnsService;

  // Additional Subsystems
  private chartService: ChartService;
  private chartRenderer: CanvasChartRenderer | null = null;
  private newsService: NewsService;
  private newsSnapshot: NewsWireSnapshot | null = null;
  private newsFilter: string = "ALL";
  private alertManager: AlertManager;

  private tickers: Map<string, MarketTicker> = new Map();
  private prevPrices: Map<string, number> = new Map();
  private fundingRates: FundingRateData[] = [];
  private fearGreed: FearAndGreedData | null = null;

  private selectedPresetId: PortfolioPresetId = "MICROSTRATEGY";
  private portfolio: InstitutionalPortfolio;
  private isEditingCustomPortfolio: boolean = false;

  private activeScreen:
    | "MARKET"
    | "CHART"
    | "RISK"
    | "ARB"
    | "FUNDING"
    | "WHALE"
    | "LIQ"
    | "NEWS"
    | "MACRO"
    | "PORT"
    | "ALERT"
    | "HELP" = "MARKET";
  private selectedStressId: string = "CRYPTO_CRASH_20";
  private whaleFilter: "ALL" | "100K" | "500K" | "1M" = "ALL";

  constructor() {
    const wsConstructor =
      typeof WebSocket !== "undefined" ? WebSocket : undefined;
    this.binanceWs = new BinanceWsFeedManager({
      webSocketConstructor: wsConstructor,
    });
    this.restService = new RestFallbackService();
    this.whaleStream = new WhaleStreamManager(wsConstructor as any);
    this.onChainService = new OnChainVitalityService();
    this.returnsService = HistoricalReturnsService.getInstance();

    this.chartService = new ChartService("BTCUSDT", "1h");
    this.newsService = NewsService.getInstance();
    this.alertManager = AlertManager.getInstance();

    // Load active preset preference
    if (typeof localStorage !== "undefined") {
      const savedPreset = localStorage.getItem(
        "apex_active_preset",
      ) as PortfolioPresetId | null;
      if (savedPreset) {
        this.selectedPresetId = savedPreset;
      }
    }
    this.portfolio = this.getPortfolioForPreset(this.selectedPresetId);

    this.initDOM();
    this.bindEvents();
    this.startFeeds();
    this.startClock();
  }

  private getPortfolioForPreset(id: PortfolioPresetId): InstitutionalPortfolio {
    switch (id) {
      case "MICROSTRATEGY":
        return ReferenceData.getMicroStrategyPortfolio();
      case "BLACKROCK_IBIT":
        return ReferenceData.getBlackRockIBITPortfolio();
      case "VITALIK_ETH":
        return ReferenceData.getVitalikPortfolio();
      case "TETHER":
        return ReferenceData.getTetherPortfolio();
      case "CUSTOM":
        return ReferenceData.getUserPortfolio();
      case "ALPHA_FUND":
      default:
        return ReferenceData.getSamplePortfolio();
    }
  }

  private getActivePresetInfo(): PortfolioPresetInfo {
    const presets = ReferenceData.getAllPresets();
    return presets.find((p) => p.id === this.selectedPresetId) || presets[0]!;
  }

  private initDOM(): void {
    const root = document.getElementById("terminal-root");
    if (!root) return;

    root.innerHTML = `
      <div class="terminal-container">
        <!-- Top Bloomberg Header -->
        <header class="terminal-header">
          <div class="header-left">
            <span class="terminal-brand">APEX // TERMINAL</span>
            <span class="terminal-tag">BLACKROCK ALADDIN × BLOOMBERG CORE</span>
            <span class="system-time" id="system-clock">UTC 00:00:00</span>
          </div>
          <div class="header-right">
            <div class="feed-status" id="ws-status">
              <span class="status-dot"></span>
              <span id="ws-status-text">CONNECTING</span>
            </div>
            <button id="btn-audio-toggle" class="terminal-btn-sm" title="Toggle Sound">
              ${isMuted() ? "🔇 SOUND: OFF" : "🔊 SOUND: ON"}
            </button>
          </div>
        </header>

        <!-- Ticker Tape -->
        <div class="ticker-tape-container">
          <div class="ticker-tape" id="ticker-tape">
            <span class="tape-item">INITIALIZING FEEDS...</span>
          </div>
        </div>

        <!-- Bloomberg Command Bar -->
        <section class="command-bar-section">
          <div class="command-prompt-box">
            <span class="command-prefix">APEX:&gt;</span>
            <input type="text" id="cmd-input" class="command-input" placeholder="Enter command (e.g. BTC <GO>, CHART <GO>, ARB <GO>, NEWS <GO>, RISK <GO>)..." autocomplete="off" spellcheck="false" />
            <button id="btn-go" class="btn-go">&lt;GO&gt;</button>
          </div>
          <div class="quick-commands">
            <button class="cmd-chip active" data-cmd="MARKET">MARKET &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="CHART">📈 CHART &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="WHALE">🐋 WHALE &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="LIQ">⚡ LIQ &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="RISK">RISK &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="ARB">💰 ARB &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="FUND">FUND &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="NEWS">📰 NEWS &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="MACRO">MACRO &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="PORT">PORT &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="ALERT">🔔 ALERT &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="HELP">HELP &lt;GO&gt;</button>
          </div>
        </section>

        <!-- Main Terminal Dashboard Area -->
        <main class="terminal-body" id="terminal-body"></main>

        <!-- Terminal Footer Status Bar -->
        <footer class="terminal-footer">
          <div class="footer-left">
            <span>[F1: HELP]</span>
            <span>[F2: MARKET]</span>
            <span>[F3: RISK]</span>
            <span>[F4: FUND]</span>
            <span>[F5: CHART]</span>
            <span>[F6: WHALE]</span>
            <span>[F7: LIQ]</span>
            <span>[F8: PORT]</span>
            <span>[F9: ARB]</span>
            <span>[F10: NEWS]</span>
          </div>
          <div class="footer-right">
            <span>100% REAL LIVE DATA · SEC 8-K &amp; ON-CHAIN RESERVES · BINANCE DIRECT WS</span>
          </div>
        </footer>
      </div>
    `;
  }

  private bindEvents(): void {
    const cmdInput = document.getElementById("cmd-input") as HTMLInputElement;
    const btnGo = document.getElementById("btn-go");
    const audioToggle = document.getElementById("btn-audio-toggle");

    audioToggle?.addEventListener("click", () => {
      const muted = toggleMute();
      audioToggle.textContent = muted ? "🔇 SOUND: OFF" : "🔊 SOUND: ON";
      if (!muted) playCommandGo();
    });

    cmdInput?.addEventListener("keydown", (e) => {
      playTerminalKey(e.key);
      if (e.key === "Enter") {
        this.executeCommand(cmdInput.value);
        cmdInput.value = "";
      }
    });

    btnGo?.addEventListener("click", () => {
      this.executeCommand(cmdInput.value);
      cmdInput.value = "";
    });

    document.querySelectorAll(".cmd-chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        const cmd = (e.currentTarget as HTMLElement).getAttribute("data-cmd");
        if (cmd) {
          playCommandGo();
          this.executeCommand(`${cmd} <GO>`);
        }
      });
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "F1") {
        e.preventDefault();
        this.executeCommand("HELP <GO>");
      } else if (e.key === "F2") {
        e.preventDefault();
        this.executeCommand("MARKET <GO>");
      } else if (e.key === "F3") {
        e.preventDefault();
        this.executeCommand("RISK <GO>");
      } else if (e.key === "F4") {
        e.preventDefault();
        this.executeCommand("FUND <GO>");
      } else if (e.key === "F5") {
        e.preventDefault();
        this.executeCommand("CHART <GO>");
      } else if (e.key === "F6") {
        e.preventDefault();
        this.executeCommand("WHALE <GO>");
      } else if (e.key === "F7") {
        e.preventDefault();
        this.executeCommand("LIQ <GO>");
      } else if (e.key === "F8") {
        e.preventDefault();
        this.executeCommand("PORT <GO>");
      } else if (e.key === "F9") {
        e.preventDefault();
        this.executeCommand("ARB <GO>");
      } else if (e.key === "F10") {
        e.preventDefault();
        this.executeCommand("NEWS <GO>");
      }
    });
  }

  private executeCommand(raw: string): void {
    const cleaned = raw.toUpperCase().replace(/<GO>/g, "").trim();
    if (!cleaned) return;

    playCommandGo();

    if (cleaned === "MARKET" || cleaned === "MKT") {
      this.activeScreen = "MARKET";
    } else if (
      cleaned === "CHART" ||
      cleaned === "CANDLE" ||
      cleaned === "KLINES" ||
      cleaned === "VWAP"
    ) {
      this.activeScreen = "CHART";
    } else if (
      cleaned === "ARB" ||
      cleaned === "BASIS" ||
      cleaned === "ARBITRAGE" ||
      cleaned === "CARRY"
    ) {
      this.activeScreen = "ARB";
    } else if (
      cleaned === "NEWS" ||
      cleaned === "WIRE" ||
      cleaned === "SENTIMENT"
    ) {
      this.activeScreen = "NEWS";
    } else if (
      cleaned === "ALERT" ||
      cleaned === "ALERTS" ||
      cleaned === "NOTIF"
    ) {
      this.activeScreen = "ALERT";
    } else if (
      cleaned === "WHALE" ||
      cleaned === "WHALES" ||
      cleaned === "FLOW"
    ) {
      this.activeScreen = "WHALE";
    } else if (
      cleaned === "LIQ" ||
      cleaned === "LIQUIDATIONS" ||
      cleaned === "REKT"
    ) {
      this.activeScreen = "LIQ";
    } else if (
      cleaned === "RISK" ||
      cleaned === "ALADDIN" ||
      cleaned === "VAR"
    ) {
      this.activeScreen = "RISK";
    } else if (
      cleaned === "FUND" ||
      cleaned === "FUNDING" ||
      cleaned === "PERP"
    ) {
      this.activeScreen = "FUNDING";
    } else if (
      cleaned === "MACRO" ||
      cleaned === "GAS" ||
      cleaned === "MEMPOOL"
    ) {
      this.activeScreen = "MACRO";
    } else if (
      cleaned === "PORT" ||
      cleaned === "PORTFOLIO" ||
      cleaned === "POS"
    ) {
      this.activeScreen = "PORT";
    } else if (cleaned === "HELP" || cleaned === "INDEX") {
      this.activeScreen = "HELP";
    } else if (cleaned.includes("CHART")) {
      const sym = cleaned.replace("CHART", "").trim();
      const target = sym.endsWith("USDT") ? sym : `${sym}USDT`;
      this.chartService.loadCandles(target);
      this.activeScreen = "CHART";
    } else if (
      [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "XRP",
        "DOGE",
        "TON",
        "AVAX",
        "SUI",
        "PEPE",
      ].includes(cleaned)
    ) {
      // Direct asset lookup -> opens chart for asset
      this.chartService.loadCandles(`${cleaned}USDT`);
      this.activeScreen = "CHART";
    } else {
      this.activeScreen = "HELP";
    }

    document.querySelectorAll(".cmd-chip").forEach((c) => {
      const match = c.getAttribute("data-cmd") === this.activeScreen;
      c.classList.toggle("active", match);
    });

    this.render();
  }

  private startFeeds(): void {
    // 1. WebSocket Binance Tickers
    this.binanceWs.onTicker((ticker) => {
      const prev = this.prevPrices.get(ticker.symbol);
      const isUp = prev !== undefined && ticker.price > prev;
      const isDown = prev !== undefined && ticker.price < prev;

      if (isUp) playTickerTick(true);
      else if (isDown) playTickerTick(false);

      this.prevPrices.set(ticker.symbol, ticker.price);
      this.tickers.set(ticker.symbol, ticker);

      // Feed live tick into chart if active
      if (ticker.symbol === this.chartService.getSymbol()) {
        this.chartService.updateWithLiveTick(ticker.price, ticker.volume24h);
      }

      this.updateTickerTape();
      if (this.activeScreen === "MARKET") {
        this.updateMarketTableLive(ticker, isUp, isDown);
      }
    });

    this.binanceWs.onStateChange((state) => {
      this.updateWsStatus(state);
    });

    this.binanceWs.connect();

    // 2. Whale Stream & Liquidation Listeners
    this.whaleStream.onWhaleTrade((trade) => {
      playWhalePing(trade.valueUsd);
      this.alertManager.checkWhaleTrade(trade);
      this.updateTickerTape();
      if (this.activeScreen === "WHALE") {
        this.renderWhaleLive(trade);
      }
    });

    this.whaleStream.onLiquidation((liq) => {
      playLiquidationZap();
      this.alertManager.checkLiquidation(liq);
      this.updateTickerTape();
      if (this.activeScreen === "LIQ") {
        this.renderLiquidationLive(liq);
      }
    });

    this.whaleStream.connect();

    // 3. Initial Funding Rates
    FundingRateCalculator.fetchLiveFundingRates()
      .then((rates) => {
        this.fundingRates = rates;
        rates.forEach((f) => this.alertManager.checkFundingRate(f));
        if (this.activeScreen === "FUNDING" || this.activeScreen === "ARB")
          this.render();
      })
      .catch(() => {});

    // 4. Initial Fear & Greed Index
    this.restService
      .fetchFearAndGreed()
      .then((data) => {
        this.fearGreed = data;
        if (this.activeScreen === "MARKET" || this.activeScreen === "MACRO")
          this.render();
      })
      .catch(() => {});

    // 5. On-Chain Vitality (Mempool & Open Interest)
    this.onChainService.fetchMempoolFees();
    this.onChainService.fetchOpenInterest(this.prevPrices);

    // 6. Real Historical Daily Returns from Binance REST
    this.returnsService.onReturnsUpdated(() => {
      if (this.activeScreen === "RISK") this.render();
    });
    this.returnsService.fetchRealReturns();

    // 7. Initial News Wire
    this.newsService.fetchLatestNews().then((snap) => {
      this.newsSnapshot = snap;
      if (this.activeScreen === "NEWS") this.render();
    });

    // 8. Initial Chart Load
    this.chartService.loadCandles("BTCUSDT", "1h").then((data) => {
      if (this.activeScreen === "CHART" && this.chartRenderer) {
        this.chartRenderer.setData(data);
      }
    });

    setInterval(() => {
      FundingRateCalculator.fetchLiveFundingRates().then((r) => {
        this.fundingRates = r;
        r.forEach((f) => this.alertManager.checkFundingRate(f));
      });
      this.onChainService.fetchMempoolFees();
      this.onChainService.fetchOpenInterest(this.prevPrices);
      this.newsService.fetchLatestNews().then((s) => (this.newsSnapshot = s));
    }, 45000);
  }

  private updateWsStatus(state: BinanceWsState): void {
    const el = document.getElementById("ws-status");
    const txt = document.getElementById("ws-status-text");
    if (!el || !txt) return;

    el.className = `feed-status status-${state.toLowerCase()}`;
    txt.textContent = `LIVE WS: ${state}`;
  }

  private startClock(): void {
    const clockEl = document.getElementById("system-clock");
    setInterval(() => {
      if (clockEl) {
        const now = new Date();
        clockEl.textContent = `UTC ${now.toISOString().substring(11, 19)} · NY ${now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })}`;
      }
    }, 1000);
  }

  private updateTickerTape(): void {
    const tape = document.getElementById("ticker-tape");
    if (!tape) return;

    const items: string[] = [];

    // Most recent whale print
    const recentWhale = this.whaleStream.getWhaleTrades()[0];
    if (recentWhale) {
      items.push(`
        <span class="tape-tick tape-whale">
          🐋 <strong>WHALE ${recentWhale.side}</strong>: ${recentWhale.asset} $${Math.round(recentWhale.valueUsd).toLocaleString()} @ $${recentWhale.price.toLocaleString()}
        </span>
      `);
    }

    // Most recent liquidation
    const recentLiq = this.whaleStream.getLiquidations()[0];
    if (recentLiq) {
      items.push(`
        <span class="tape-tick tape-liq">
          ⚡ <strong>REKT ${recentLiq.side}</strong>: ${recentLiq.asset} $${Math.round(recentLiq.valueUsd).toLocaleString()}
        </span>
      `);
    }

    const keys = [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
      "BNBUSDT",
      "XRPUSDT",
      "DOGEUSDT",
      "TONUSDT",
      "SUIUSDT",
    ];
    keys.forEach((k) => {
      const t = this.tickers.get(k);
      if (t) {
        const sym = k.replace("USDT", "");
        const changeClass =
          t.priceChangePercent24h >= 0 ? "text-green" : "text-red";
        const sign = t.priceChangePercent24h >= 0 ? "+" : "";
        items.push(`
          <span class="tape-tick">
            <strong>${sym}</strong>: $${t.price.toLocaleString(undefined, { minimumFractionDigits: t.price < 10 ? 4 : 2 })}
            <span class="${changeClass}">(${sign}${t.priceChangePercent24h.toFixed(2)}%)</span>
          </span>
        `);
      }
    });

    if (this.fearGreed) {
      items.push(`
        <span class="tape-tick tape-highlight">
          <strong>FEAR &amp; GREED</strong>: ${this.fearGreed.value} (${this.fearGreed.valueClassification.toUpperCase()})
        </span>
      `);
    }

    if (items.length > 0) {
      tape.innerHTML = items.join('<span class="tape-sep">│</span>');
    }
  }

  private render(): void {
    const body = document.getElementById("terminal-body");
    if (!body) return;

    if (this.activeScreen === "MARKET") {
      this.renderMarketScreen(body);
    } else if (this.activeScreen === "CHART") {
      this.renderChartScreen(body);
    } else if (this.activeScreen === "WHALE") {
      this.renderWhaleScreen(body);
    } else if (this.activeScreen === "LIQ") {
      this.renderLiquidationScreen(body);
    } else if (this.activeScreen === "RISK") {
      this.renderRiskScreen(body);
    } else if (this.activeScreen === "ARB") {
      this.renderArbitrageScreen(body);
    } else if (this.activeScreen === "FUNDING") {
      this.renderFundingScreen(body);
    } else if (this.activeScreen === "NEWS") {
      this.renderNewsScreen(body);
    } else if (this.activeScreen === "MACRO") {
      this.renderMacroScreen(body);
    } else if (this.activeScreen === "PORT") {
      this.renderPortfolioScreen(body);
    } else if (this.activeScreen === "ALERT") {
      this.renderAlertsScreen(body);
    } else if (this.activeScreen === "HELP") {
      this.renderHelpScreen(body);
    }
  }

  // ==========================================
  // SCREEN: MARKET MATRIX
  // ==========================================
  private renderMarketScreen(container: HTMLElement): void {
    container.innerHTML = `
      <div class="terminal-screen screen-market">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">1. MARKET MATRIX &amp; ORDERFLOW DEPTH</h2>
            <span class="screen-subtitle">REAL-TIME MULTI-ASSET STREAMING VIA ZERO-KEY WEBSOCKETS (LIVE 100% REAL)</span>
          </div>
          <div class="header-stat-pills">
            ${
              this.fearGreed
                ? `
              <div class="stat-pill">
                <span class="pill-label">SENTIMENT</span>
                <span class="pill-val ${this.fearGreed.value >= 50 ? "text-green" : "text-red"}">
                  ${this.fearGreed.value}/100 [${this.fearGreed.valueClassification.toUpperCase()}]
                </span>
              </div>
            `
                : ""
            }
          </div>
        </div>

        <div class="market-matrix-table-wrap">
          <table class="terminal-table" id="market-table">
            <thead>
              <tr>
                <th>SYMBOL</th>
                <th>LAST PRICE</th>
                <th>24H CHG</th>
                <th>24H HIGH</th>
                <th>24H LOW</th>
                <th>24H VOLUME</th>
                <th>ORDERFLOW DEPTH (BID/ASK)</th>
              </tr>
            </thead>
            <tbody>
              ${BinanceWsFeedManager.DEFAULT_SYMBOLS.map((sym) => this.renderTableRow(sym)).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private renderTableRow(sym: string): string {
    const t = this.tickers.get(sym);
    const asset = sym.replace("USDT", "");
    const price = t
      ? `$${t.price.toLocaleString(undefined, { minimumFractionDigits: t.price < 5 ? 4 : 2 })}`
      : "FETCHING...";
    const chg = t
      ? `${t.priceChangePercent24h >= 0 ? "+" : ""}${t.priceChangePercent24h.toFixed(2)}%`
      : "--";
    const chgClass = t
      ? t.priceChangePercent24h >= 0
        ? "text-green"
        : "text-red"
      : "";
    const high = t ? `$${t.high24h.toLocaleString()}` : "--";
    const low = t ? `$${t.low24h.toLocaleString()}` : "--";
    const vol = t ? `$${Math.round(t.quoteVolume24h).toLocaleString()}` : "--";

    const buyRatio =
      t?.orderflowBuyRatio !== undefined ? Math.round(t.orderflowBuyRatio) : 50;
    const sellRatio = 100 - buyRatio;

    return `
      <tr id="row-${sym}">
        <td class="td-symbol"><strong>${asset}</strong>/USDT</td>
        <td class="td-price" id="price-${sym}">${price}</td>
        <td class="td-chg ${chgClass}" id="chg-${sym}">${chg}</td>
        <td class="td-high">${high}</td>
        <td class="td-low">${low}</td>
        <td class="td-vol">${vol}</td>
        <td class="td-bias">
          <div class="orderflow-bar" title="Real-time Bid vs Ask Orderbook Depth (${buyRatio}% Bid / ${sellRatio}% Ask)">
            <div class="orderflow-buy" id="bar-buy-${sym}" style="width: ${buyRatio}%;"></div>
            <div class="orderflow-sell" id="bar-sell-${sym}" style="width: ${sellRatio}%;"></div>
          </div>
          <span class="bias-text" id="bias-text-${sym}">${buyRatio}% / ${sellRatio}%</span>
        </td>
      </tr>
    `;
  }

  private updateMarketTableLive(
    ticker: MarketTicker,
    isUp: boolean,
    isDown: boolean,
  ): void {
    const priceCell = document.getElementById(`price-${ticker.symbol}`);
    const chgCell = document.getElementById(`chg-${ticker.symbol}`);
    if (!priceCell) return;

    priceCell.textContent = `$${ticker.price.toLocaleString(undefined, { minimumFractionDigits: ticker.price < 5 ? 4 : 2 })}`;
    priceCell.classList.remove("cell-flash-up", "cell-flash-down");
    void priceCell.offsetWidth;
    priceCell.classList.add(
      isUp ? "cell-flash-up" : isDown ? "cell-flash-down" : "cell-neutral",
    );

    if (chgCell) {
      chgCell.textContent = `${ticker.priceChangePercent24h >= 0 ? "+" : ""}${ticker.priceChangePercent24h.toFixed(2)}%`;
      chgCell.className = `td-chg ${ticker.priceChangePercent24h >= 0 ? "text-green" : "text-red"}`;
    }

    if (ticker.orderflowBuyRatio !== undefined) {
      const buyRatio = Math.round(ticker.orderflowBuyRatio);
      const sellRatio = 100 - buyRatio;
      const buyBar = document.getElementById(`bar-buy-${ticker.symbol}`);
      const sellBar = document.getElementById(`bar-sell-${ticker.symbol}`);
      const biasText = document.getElementById(`bias-text-${ticker.symbol}`);
      if (buyBar && sellBar) {
        buyBar.style.width = `${buyRatio}%`;
        sellBar.style.width = `${sellRatio}%`;
      }
      if (biasText) {
        biasText.textContent = `${buyRatio}% / ${sellRatio}%`;
      }
    }
  }

  // ==========================================
  // SCREEN: HIGH-FREQUENCY CANVAS CHART (CHART <GO>)
  // ==========================================
  private renderChartScreen(container: HTMLElement): void {
    const curSymbol = this.chartService.getSymbol();
    const curTF = this.chartService.getTimeframe();
    const symbols = ["BTC", "ETH", "SOL", "BNB", "SUI", "XRP", "DOGE"];
    const timeframes: ChartTimeframe[] = ["1m", "5m", "15m", "1h", "1d"];

    container.innerHTML = `
      <div class="terminal-screen screen-chart">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">📈 HIGH-FREQUENCY REAL-TIME CANDLESTICK &amp; VWAP ENGINE</h2>
            <span class="screen-subtitle">60 FPS ZERO-DEPENDENCY HTML5 CANVAS WITH INSTITUTIONAL VOLUME PROFILE (POC)</span>
          </div>
          <span class="terminal-badge badge-aladdin">SUB-MILLISECOND RENDER</span>
        </div>

        <div class="chart-container-box">
          <div class="chart-toolbar">
            <div class="chart-group">
              <span class="selector-label">SYMBOL:</span>
              ${symbols
                .map(
                  (s) => `
                <button class="chart-btn ${curSymbol.startsWith(s) ? "active" : ""}" data-chart-sym="${s}USDT">
                  ${s}
                </button>
              `,
                )
                .join("")}
            </div>

            <div class="chart-group">
              <span class="selector-label">TIMEFRAME:</span>
              ${timeframes
                .map(
                  (tf) => `
                <button class="chart-btn ${curTF === tf ? "active" : ""}" data-chart-tf="${tf}">
                  ${tf.toUpperCase()}
                </button>
              `,
                )
                .join("")}
            </div>

            <div class="chart-group">
              <span class="returns-badge badge-live">● VWAP: ON</span>
              <span class="returns-badge badge-live">● POC PROFILE: ON</span>
            </div>
          </div>

          <div class="chart-canvas-wrap">
            <canvas id="apex-chart-canvas" class="chart-canvas"></canvas>
          </div>
        </div>
      </div>
    `;

    this.initChartCanvas();
    this.bindChartEvents();
  }

  private initChartCanvas(): void {
    const canvas = document.getElementById(
      "apex-chart-canvas",
    ) as HTMLCanvasElement;
    if (!canvas) return;

    this.chartRenderer = new CanvasChartRenderer(canvas, {
      showVWAP: true,
      showVolumeProfile: true,
      showGrid: true,
    });

    this.chartRenderer.resize();
    const data = this.chartService.buildChartData();
    this.chartRenderer.setData(data);

    window.addEventListener("resize", () => {
      this.chartRenderer?.resize();
    });
  }

  private bindChartEvents(): void {
    document.querySelectorAll("[data-chart-sym]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const sym = (e.currentTarget as HTMLElement).getAttribute(
          "data-chart-sym",
        );
        if (sym) {
          playCommandGo();
          this.chartService
            .loadCandles(sym, this.chartService.getTimeframe())
            .then(() => {
              this.render();
            });
        }
      });
    });

    document.querySelectorAll("[data-chart-tf]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const tf = (e.currentTarget as HTMLElement).getAttribute(
          "data-chart-tf",
        ) as ChartTimeframe | null;
        if (tf) {
          playCommandGo();
          this.chartService
            .loadCandles(this.chartService.getSymbol(), tf)
            .then(() => {
              this.render();
            });
        }
      });
    });
  }

  // ==========================================
  // SCREEN: BASIS & ARBITRAGE MATRIX (ARB <GO>)
  // ==========================================
  private renderArbitrageScreen(container: HTMLElement): void {
    const items = BasisArbitrageCalculator.calculateMatrix(
      this.tickers,
      this.fundingRates,
    );
    const summary = BasisArbitrageCalculator.getSummary(items);

    container.innerHTML = `
      <div class="terminal-screen screen-arb">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">💰 INSTITUTIONAL CASH &amp; CARRY BASIS ARBITRAGE MATRIX</h2>
            <span class="screen-subtitle">DELTA-NEUTRAL YIELD, SPOT VS PERP SPREADS &amp; ANNUALIZED CARRY RETURNS</span>
          </div>
          <span class="terminal-badge badge-aladdin">DELTA-NEUTRAL ALADDIN</span>
        </div>

        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">AVERAGE MARKET CARRY APR</span>
            <span class="kpi-val text-green">${summary.averageBasisApr.toFixed(2)}%</span>
            <span class="kpi-sub">ACROSS ACTIVE PERPETUALS</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">ACTIVE YIELD OPPORTUNITIES</span>
            <span class="kpi-val text-cyan">${summary.totalOpportunitiesCount}</span>
            <span class="kpi-sub">SPREADS &ge; 5% ANNUALIZED</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">TOP CARRY ASSET</span>
            <span class="kpi-val text-amber">${summary.bestOpportunity ? summary.bestOpportunity.asset : "--"}</span>
            <span class="kpi-sub">${summary.bestOpportunity ? `${summary.bestOpportunity.totalDeltaNeutralApr.toFixed(2)}% APR` : "--"}</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">30-DAY PROJ. YIELD ON $100K</span>
            <span class="kpi-val text-green">$${summary.bestOpportunity ? Math.round(summary.bestOpportunity.estimated30DayYieldUsd).toLocaleString() : "0"}</span>
            <span class="kpi-sub">ZERO-DIRECTIONAL RISK CARRY</span>
          </div>
        </div>

        <div class="market-matrix-table-wrap mt-3">
          <table class="terminal-table">
            <thead>
              <tr>
                <th>ASSET</th>
                <th>SPOT PRICE</th>
                <th>PERP MARK PRICE</th>
                <th>BASIS SPREAD</th>
                <th>8H RATE</th>
                <th>DELTA-NEUTRAL APR</th>
                <th>COMPOUNDED APY</th>
                <th>EST. 30D YIELD ($100K)</th>
                <th>ACTIONABLE SIGNAL</th>
              </tr>
            </thead>
            <tbody>
              ${
                items.length === 0
                  ? `<tr><td colspan="9" class="text-center">Awaiting Spot and Futures WebSocket prices to calculate basis spreads...</td></tr>`
                  : items
                      .map((item) => {
                        const isHot = item.signal === "HIGH_YIELD_CASH_CARRY";
                        const isMod = item.signal === "MODERATE_CASH_CARRY";
                        const aprClass =
                          item.totalDeltaNeutralApr >= 0
                            ? "text-green"
                            : "text-red";

                        return `
                    <tr class="${isHot ? "row-highlight" : ""}">
                      <td><strong>${item.asset}</strong></td>
                      <td>$${item.spotPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td>$${item.perpPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td class="${item.basisSpreadUsd >= 0 ? "text-green" : "text-red"}">
                        ${item.basisSpreadUsd >= 0 ? "+" : ""}$${item.basisSpreadUsd.toFixed(2)} (${item.basisSpreadPercent.toFixed(3)}%)
                      </td>
                      <td>${(item.fundingRate8h * 100).toFixed(4)}%</td>
                      <td class="${aprClass} font-bold">${item.totalDeltaNeutralApr.toFixed(2)}%</td>
                      <td class="${aprClass}">${item.compoundedApy.toFixed(2)}%</td>
                      <td class="text-cyan font-bold">+$${Math.round(item.estimated30DayYieldUsd).toLocaleString()}</td>
                      <td>
                        <span class="${isHot ? "badge-arb-hot" : isMod ? "badge-arb-mod" : "regime-normal"}">
                          ${
                            isHot
                              ? "🔥 BUY SPOT / SHORT PERP"
                              : isMod
                                ? "✓ CASH & CARRY"
                                : "NEUTRAL"
                          }
                        </span>
                      </td>
                    </tr>
                  `;
                      })
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==========================================
  // SCREEN: LIVE CRYPTO NEWS WIRE (NEWS <GO>)
  // ==========================================
  private renderNewsScreen(container: HTMLElement): void {
    const snap = this.newsSnapshot || this.newsService.buildSnapshot();
    const categories = [
      "ALL",
      "ETF_FLOWS",
      "MACRO",
      "REGULATION",
      "DEFI",
      "ON_CHAIN",
      "SECURITY",
    ];

    const filtered = snap.articles.filter((a) => {
      if (this.newsFilter === "ALL") return true;
      return a.category === this.newsFilter;
    });

    container.innerHTML = `
      <div class="terminal-screen screen-news">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">📰 INSTITUTIONAL MARKET WIRE &amp; NLP SENTIMENT RADAR</h2>
            <span class="screen-subtitle">REAL-TIME CRYPTO HEADLINES, REGULATORY FILINGS &amp; ALGORITHMIC SENTIMENT SCORING</span>
          </div>
          <span class="terminal-badge badge-aladdin">LIVE WIRE ACTIVE</span>
        </div>

        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">MARKET SENTIMENT INDEX</span>
            <span class="kpi-val ${snap.marketSentimentIndex >= 50 ? "text-green" : "text-red"}">
              ${snap.marketSentimentIndex}/100
            </span>
            <span class="kpi-sub">${snap.marketSentimentLabel}</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">BULLISH HEADLINES</span>
            <span class="kpi-val text-green">${snap.bullishCount}</span>
            <span class="kpi-sub">ACCUMULATION / INFLOW DRIVERS</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">BEARISH HEADLINES</span>
            <span class="kpi-val text-red">${snap.bearishCount}</span>
            <span class="kpi-sub">REGULATORY / RISK PRESSURES</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">NEUTRAL / MACRO REPORTS</span>
            <span class="kpi-val text-cyan">${snap.neutralCount}</span>
            <span class="kpi-sub">FED &amp; PROTOCOL METRICS</span>
          </div>
        </div>

        <div class="filter-group mt-3">
          ${categories
            .map(
              (cat) => `
            <button class="filter-btn ${this.newsFilter === cat ? "active" : ""}" data-news-cat="${cat}">
              ${cat.replace("_", " ")}
            </button>
          `,
            )
            .join("")}
        </div>

        <div class="news-grid">
          ${filtered
            .map((art) => {
              const timeStr = new Date(art.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });
              const sentClass =
                art.sentiment === "BULLISH"
                  ? "badge-bullish"
                  : art.sentiment === "BEARISH"
                    ? "badge-bearish"
                    : "badge-neutral";
              const impactClass =
                art.impact === "CRITICAL"
                  ? "badge-critical"
                  : art.impact === "HIGH"
                    ? "badge-high"
                    : "badge-neutral";

              return `
              <div class="news-item ${art.sentiment === "BULLISH" ? "news-bullish" : art.sentiment === "BEARISH" ? "news-bearish" : ""}">
                <div class="news-meta-row">
                  <span class="text-dim">${timeStr}</span>
                  <span class="font-bold text-amber">${art.source}</span>
                  <span class="preset-badge">${art.category}</span>
                  <span class="${sentClass}">${art.sentiment} (${(art.sentimentScore * 100).toFixed(0)})</span>
                  <span class="${impactClass}">IMPACT: ${art.impact}</span>
                </div>
                <div class="news-headline">${art.headline}</div>
              </div>
            `;
            })
            .join("")}
        </div>
      </div>
    `;

    this.bindNewsEvents();
  }

  private bindNewsEvents(): void {
    document.querySelectorAll("[data-news-cat]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const cat = (e.currentTarget as HTMLElement).getAttribute(
          "data-news-cat",
        );
        if (cat) {
          playCommandGo();
          this.newsFilter = cat;
          this.render();
        }
      });
    });
  }

  // ==========================================
  // SCREEN: PUSH NOTIFICATIONS & ALERTS (ALERT <GO>)
  // ==========================================
  private renderAlertsScreen(container: HTMLElement): void {
    const alerts = this.alertManager.getAlerts();
    const isEnabled = this.alertManager.isNotificationsEnabled();

    container.innerHTML = `
      <div class="terminal-screen screen-alert">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">🔔 INSTITUTIONAL REAL-TIME ALERTS &amp; PUSH SYSTEM</h2>
            <span class="screen-subtitle">BROWSER DESKTOP/MOBILE NOTIFICATIONS FOR KRAKEN BLOCKS, CASUALTIES &amp; VOLATILITY</span>
          </div>
          <button id="btn-request-push" class="btn-amber">
            ${isEnabled ? "✓ PUSH NOTIFICATIONS: ACTIVE" : "🔔 ENABLE BROWSER PUSH NOTIFICATIONS"}
          </button>
        </div>

        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">WHALE THRESHOLD</span>
            <span class="kpi-val text-green">&ge; $500,000</span>
            <span class="kpi-sub">AUTOMATIC ACOUSTIC PING</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">LIQUIDATION THRESHOLD</span>
            <span class="kpi-val text-red">&ge; $250,000</span>
            <span class="kpi-sub">ELECTRIC ZAP ACOUSTIC TRIGGER</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">FUNDING RATE ANOMALY</span>
            <span class="kpi-val text-amber">&ge; 50.0% APR</span>
            <span class="kpi-sub">SQUEEZE WARNING ALERT</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">TOTAL LOGGED ALERTS</span>
            <span class="kpi-val text-cyan">${alerts.length}</span>
            <span class="kpi-sub">SESSION CASUALTIES</span>
          </div>
        </div>

        <div class="market-matrix-table-wrap mt-3">
          <table class="terminal-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>ALERT TYPE</th>
                <th>SEVERITY</th>
                <th>EVENT DETAILS</th>
              </tr>
            </thead>
            <tbody>
              ${
                alerts.length === 0
                  ? `<tr><td colspan="4" class="text-center">No casualty or whale threshold breaches detected yet in this session. Monitoring Binance streams...</td></tr>`
                  : alerts
                      .map((alt) => {
                        const timeStr = new Date(
                          alt.timestamp,
                        ).toLocaleTimeString();
                        const sevClass =
                          alt.severity === "CRITICAL"
                            ? "text-red font-bold"
                            : alt.severity === "WARNING"
                              ? "text-amber font-bold"
                              : "text-cyan";

                        return `
                    <tr>
                      <td class="text-dim">${timeStr}</td>
                      <td><strong>${alt.type}</strong></td>
                      <td class="${sevClass}">${alt.severity}</td>
                      <td><strong>${alt.title}</strong> — ${alt.message}</td>
                    </tr>
                  `;
                      })
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    document
      .getElementById("btn-request-push")
      ?.addEventListener("click", () => {
        playCommandGo();
        this.alertManager.requestNotificationPermission().then(() => {
          this.render();
        });
      });
  }

  // ==========================================
  // SCREEN: WHALE FLOW RADAR & 24H TRANCHE ENGINE
  // ==========================================
  private renderWhaleScreen(container: HTMLElement): void {
    const metrics = this.whaleStream.getMetrics();
    const allTrades = this.whaleStream.getWhaleTrades();
    const trades = allTrades.filter((t) => {
      if (this.whaleFilter === "100K") return t.valueUsd >= 100000;
      if (this.whaleFilter === "500K") return t.valueUsd >= 500000;
      if (this.whaleFilter === "1M") return t.valueUsd >= 1000000;
      return true;
    });

    const campaigns = this.whaleStream
      .getTrancheCampaigns()
      .filter((c) => c.trancheCount >= 2 || c.totalValueUsd >= 200000)
      .slice(0, 12);

    const multiTrancheCount = this.whaleStream
      .getTrancheCampaigns()
      .filter((c) => c.trancheCount >= 2).length;

    const isNetPositive = metrics.netWhaleDeltaUsd >= 0;

    container.innerHTML = `
      <div class="terminal-screen screen-whale">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">🐋 24H WHALE RADAR, MULTI-VENUE FLOW &amp; LINKED TRANCHE CAMPAIGNS</h2>
            <span class="screen-subtitle">24-HOUR INDEXEDDB PERSISTENCE · BINANCE SPOT + BYBIT PERP + OKX + BTC MEMPOOL · MICROSTRUCTURE TRANCHE CLUSTERING</span>
          </div>
          <div class="filter-group">
            <button class="filter-btn ${this.whaleFilter === "ALL" ? "active" : ""}" data-filter="ALL">&ge; $50K (${allTrades.length})</button>
            <button class="filter-btn ${this.whaleFilter === "100K" ? "active" : ""}" data-filter="100K">&ge; $100K</button>
            <button class="filter-btn ${this.whaleFilter === "500K" ? "active" : ""}" data-filter="500K">&ge; $500K</button>
            <button class="filter-btn ${this.whaleFilter === "1M" ? "active" : ""}" data-filter="1M">&ge; $1M (KRAKEN)</button>
          </div>
        </div>

        <!-- Real-Time Multi-Venue & 24h Persistence Status Banner -->
        <div class="real-source-banner">
          <span class="live-pulse"></span>
          <span><strong>24H PERSISTENT VAULT (IndexedDB + LocalStorage):</strong> ${allTrades.length} whale prints stored over last 24h · Auto-linked into ${multiTrancheCount} multi-tranche institutional campaigns</span>
          <span class="returns-badge badge-live">● 5 LIVE STREAMS: BINANCE SPOT + BYBIT V5 + OKX + MEMPOOL.SPACE</span>
        </div>

        <!-- Whale KPI Strip -->
        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">NET 24H INSTITUTIONAL DELTA (CVD)</span>
            <span class="kpi-val ${isNetPositive ? "text-green" : "text-red"}">
              ${isNetPositive ? "+" : "-"}$${Math.round(Math.abs(metrics.netWhaleDeltaUsd)).toLocaleString()}
            </span>
            <span class="kpi-sub">${isNetPositive ? "ACCUMULATION REGIME" : "DISTRIBUTION PRESSURE"}</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">24H WHALE BUY VOLUME (&ge;$50K)</span>
            <span class="kpi-val text-green">$${Math.round(metrics.totalWhaleBuyVolumeUsd).toLocaleString()}</span>
            <span class="kpi-sub">AGGRESSIVE TAKER BUYS</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">24H WHALE SELL VOLUME (&ge;$50K)</span>
            <span class="kpi-val text-red">$${Math.round(metrics.totalWhaleSellVolumeUsd).toLocaleString()}</span>
            <span class="kpi-sub">AGGRESSIVE TAKER SELLS</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">LINKED TRANCHE CAMPAIGNS</span>
            <span class="kpi-val text-amber">${multiTrancheCount} CAMPAIGNS</span>
            <span class="kpi-sub">${allTrades.filter((t) => t.valueUsd >= 1000000).length} KRAKEN BLOCKS (&gt;$1M)</span>
          </div>
        </div>

        <!-- Linked Whale Tranche Campaigns Table -->
        <section class="terminal-section mt-3">
          <div class="section-header-flex">
            <div>
              <span class="section-title">🔗 LINKED INSTITUTIONAL TRANCHE CAMPAIGNS (TWAP / ICEBERG / CROSS-VENUE CLUSTERING)</span>
              <p class="section-desc">4-Factor Microstructure Fingerprinting links split whale orders across time, lot uniformity (CV), orderbook sweep depth, and venues.</p>
            </div>
          </div>

          <div class="market-matrix-table-wrap mt-2">
            <table class="terminal-table">
              <thead>
                <tr>
                  <th>CAMPAIGN ID</th>
                  <th>ASSET &amp; SIDE</th>
                  <th>EXECUTION ALGO</th>
                  <th>TRANCHES &amp; CADENCE</th>
                  <th>CUMULATIVE VALUE</th>
                  <th>CAMPAIGN VWAP &amp; IMPACT</th>
                  <th>VENUES &amp; CONFIDENCE</th>
                </tr>
              </thead>
              <tbody id="tranche-campaigns-tbody">
                ${
                  campaigns.length === 0
                    ? `<tr><td colspan="7" class="text-center">Clustering 24h whale orderflow into linked tranche campaigns...</td></tr>`
                    : campaigns
                        .map((c) => {
                          const sideClass =
                            c.side === "BUY" ? "text-green" : "text-red";
                          const impactSign = c.priceImpactBps >= 0 ? "+" : "";
                          const cadenceStr =
                            c.trancheCount > 1
                              ? `${c.trancheCount} tranches · avg ${Math.round(c.meanIntervalSec)}s · ${c.lotUniformityScore}% lot match`
                              : `1 block fill · ${c.totalOrdersSwept} orders swept`;
                          const spanMin = Math.max(
                            1,
                            Math.round((c.lastTime - c.startTime) / 60000),
                          );
                          const timeWindow =
                            c.trancheCount > 1
                              ? `${new Date(c.startTime).toLocaleTimeString()} – ${new Date(c.lastTime).toLocaleTimeString()} (${spanMin}m)`
                              : new Date(c.lastTime).toLocaleTimeString();

                          return `
                      <tr class="${c.trancheCount >= 2 ? "row-highlight" : ""}">
                        <td>
                          <strong class="text-amber">${c.campaignId}</strong>
                          <div class="text-dim" style="font-size: 0.7rem;">${timeWindow}</div>
                        </td>
                        <td class="${sideClass}">
                          <strong>${c.asset} ${c.side === "BUY" ? "▲ ACCUMULATE" : "▼ DISTRIBUTE"}</strong>
                        </td>
                        <td>
                          <span class="regime-badge ${c.algoType === "ICEBERG_CLIP" || c.algoType === "CROSS_VENUE_SWEEP" ? "regime-squeeze" : c.algoType === "TWAP_CAMPAIGN" ? "regime-extreme" : "regime-normal"}">
                            ${c.algoType}
                          </span>
                        </td>
                        <td>
                          <strong>${cadenceStr}</strong>
                        </td>
                        <td class="${sideClass} font-bold">
                          $${Math.round(c.totalValueUsd).toLocaleString()}
                          <div class="text-dim" style="font-size: 0.72rem;">${c.totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${c.asset}</div>
                        </td>
                        <td>
                          <strong>$${c.vwapPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</strong>
                          <span class="text-cyan" style="font-size: 0.75rem;">(${impactSign}${c.priceImpactBps.toFixed(1)} bps)</span>
                        </td>
                        <td>
                          <span class="text-cyan font-bold">${c.venues.join(" + ")}</span>
                          <div class="text-dim" style="font-size: 0.72rem;">Link Confidence: <strong>${c.confidenceScore}%</strong></div>
                        </td>
                      </tr>
                    `;
                        })
                        .join("")
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- Live Whale Tape Table -->
        <section class="terminal-section mt-3">
          <span class="section-title">📡 24-HOUR INDIVIDUAL WHALE PRINTS &amp; ON-CHAIN TRANSFERS (${trades.length} SHOWN)</span>
          <div class="market-matrix-table-wrap mt-2">
            <table class="terminal-table">
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>VENUE</th>
                  <th>ASSET &amp; FLOW</th>
                  <th>VALUE (USD)</th>
                  <th>QUANTITY &amp; PRICE</th>
                  <th>MICROSTRUCTURE / DEPTH SWEPT</th>
                  <th>TRANCHE LINK</th>
                </tr>
              </thead>
              <tbody id="whale-tbody">
                ${
                  trades.length === 0
                    ? `<tr><td colspan="7" class="text-center">Awaiting WebSocket whale block executions &ge; $50,000...</td></tr>`
                    : trades
                        .slice(0, 100)
                        .map((t) => this.renderWhaleRow(t))
                        .join("")
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    this.bindWhaleEvents();
  }

  private renderWhaleRow(t: WhaleTrade): string {
    const timeStr = new Date(t.timestamp).toLocaleTimeString();
    const sideClass = t.side === "BUY" ? "text-green" : "text-red";
    const venueLabel = t.venue || "BINANCE_SPOT";
    const microInfo =
      venueLabel === "BTC_MEMPOOL"
        ? `On-Chain TX ${t.txHash ? t.txHash.slice(0, 10) + "…" : ""}`
        : t.isBlockTrade
          ? `OTC Block Trade`
          : `Swept ${t.ordersSwept || 1} limit order${(t.ordersSwept || 1) > 1 ? "s" : ""}`;

    const campaignBadge = t.campaignId
      ? `<span class="text-amber font-bold">${t.campaignId}</span> <span class="text-dim">[#${t.trancheIndex || 1}]</span>`
      : `<span class="text-dim">SINGLE</span>`;

    return `
      <tr class="row-flash-${t.side.toLowerCase()}">
        <td class="text-dim">${timeStr}</td>
        <td><span class="regime-badge regime-normal">${venueLabel}</span></td>
        <td class="${sideClass}"><strong>${t.asset} ${t.side === "BUY" ? "▲ BUY" : "▼ SELL"}</strong></td>
        <td class="${sideClass} font-bold">$${Math.round(t.valueUsd).toLocaleString()}</td>
        <td>
          ${t.quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${t.asset}
          <span class="text-dim">@ $${t.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </td>
        <td class="text-cyan">${microInfo}</td>
        <td>${campaignBadge}</td>
      </tr>
    `;
  }

  private renderWhaleLive(_trade: WhaleTrade): void {
    const container = document.getElementById("terminal-body");
    if (!container || this.activeScreen !== "WHALE") return;
    this.renderWhaleScreen(container);
  }

  private bindWhaleEvents(): void {
    document.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const filter = (e.currentTarget as HTMLElement).getAttribute(
          "data-filter",
        ) as "ALL" | "100K" | "500K" | "1M";
        if (filter) {
          playCommandGo();
          this.whaleFilter = filter;
          this.render();
        }
      });
    });
  }

  // ==========================================
  // SCREEN: LIQUIDATION RADAR
  // ==========================================
  private renderLiquidationScreen(container: HTMLElement): void {
    const metrics = this.whaleStream.getMetrics();
    const liqs = this.whaleStream.getLiquidations();
    const totalLiq =
      metrics.totalLiquidationsLongUsd + metrics.totalLiquidationsShortUsd;
    const longPct =
      totalLiq > 0 ? (metrics.totalLiquidationsLongUsd / totalLiq) * 100 : 50;
    const shortPct =
      totalLiq > 0 ? (metrics.totalLiquidationsShortUsd / totalLiq) * 100 : 50;

    container.innerHTML = `
      <div class="terminal-screen screen-liq">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">⚡ REAL-TIME MULTI-EXCHANGE LIQUIDATIONS FEED &amp; REKT RADAR</h2>
            <span class="screen-subtitle">BYBIT V5 ALL-LIQUIDATION + OKX V5 SWAP LIQUIDATION-ORDERS + BINANCE !FORCEORDER (SUB-30MS)</span>
          </div>
          <span class="terminal-badge badge-red">LIVE MULTI-VENUE CASUALTY TAPE</span>
        </div>

        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">TOTAL REKT VOLUME (SESSION)</span>
            <span class="kpi-val text-red">$${Math.round(totalLiq).toLocaleString()}</span>
            <span class="kpi-sub">FORCED MARKET ORDERS (${liqs.length} EVENTS)</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">LONGS LIQUIDATED (LONG SQUEEZE)</span>
            <span class="kpi-val text-red">$${Math.round(metrics.totalLiquidationsLongUsd).toLocaleString()}</span>
            <span class="kpi-sub">${longPct.toFixed(1)}% OF TOTAL REKT</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">SHORTS LIQUIDATED (SHORT SQUEEZE)</span>
            <span class="kpi-val text-green">$${Math.round(metrics.totalLiquidationsShortUsd).toLocaleString()}</span>
            <span class="kpi-sub">${shortPct.toFixed(1)}% OF TOTAL REKT</span>
          </div>
        </div>

        <!-- Long vs Short Liquidation Ratio Bar -->
        <div class="terminal-section mt-3">
          <span class="section-title">LIQUIDATION RATIO BREAKDOWN</span>
          <div class="liq-bar-wrap mt-2">
            <div class="liq-bar-long" style="width: ${longPct}%;">LONGS ${longPct.toFixed(0)}%</div>
            <div class="liq-bar-short" style="width: ${shortPct}%;">SHORTS ${shortPct.toFixed(0)}%</div>
          </div>
        </div>

        <!-- Live Liquidations Table -->
        <div class="market-matrix-table-wrap mt-3">
          <table class="terminal-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>VENUE</th>
                <th>CONTRACT</th>
                <th>REKT SIDE</th>
                <th>LIQUIDATED VALUE</th>
                <th>SIZE</th>
                <th>BANKRUPTCY PRICE</th>
              </tr>
            </thead>
            <tbody id="liq-tbody">
              ${
                liqs.length === 0
                  ? `<tr><td colspan="7" class="text-center">Connected to Bybit V5, OKX Swap &amp; Binance Futures forced liquidation feeds...</td></tr>`
                  : liqs.map((l) => this.renderLiquidationRow(l)).join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private renderLiquidationRow(l: LiquidationEvent): string {
    const timeStr = new Date(l.timestamp).toLocaleTimeString();
    const sideClass = l.side === "LONG" ? "text-red" : "text-green";
    const venueLabel = l.venue || "BINANCE_FUTURES";

    return `
      <tr class="row-flash-liq">
        <td class="text-dim">${timeStr}</td>
        <td><span class="regime-badge regime-normal">${venueLabel}</span></td>
        <td><strong>${l.asset}</strong>USDT PERP</td>
        <td class="${sideClass}"><strong>⚡ ${l.side} REKT</strong></td>
        <td class="${sideClass} font-bold">$${Math.round(l.valueUsd).toLocaleString()}</td>
        <td>${l.quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${l.asset}</td>
        <td>$${l.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      </tr>
    `;
  }

  private renderLiquidationLive(_liq: LiquidationEvent): void {
    const container = document.getElementById("terminal-body");
    if (!container || this.activeScreen !== "LIQ") return;
    this.renderLiquidationScreen(container);
  }

  // ==========================================
  // SCREEN: MACRO & ON-CHAIN VITALITY
  // ==========================================
  private renderMacroScreen(container: HTMLElement): void {
    const snapshot = this.onChainService.getSnapshot();
    const mempool = snapshot.mempool;

    container.innerHTML = `
      <div class="terminal-screen screen-macro">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">🌐 ON-CHAIN VITALITY &amp; GLOBAL MACRO PULSE</h2>
            <span class="screen-subtitle">LIVE BITCOIN MEMPOOL FEES (MEMPOOL.SPACE) &amp; BINANCE FUTURES OPEN INTEREST</span>
          </div>
        </div>

        <!-- Mempool & Fees -->
        <section class="terminal-section">
          <span class="section-title">BITCOIN MEMPOOL TRANSACTION FEES (SAT/VB)</span>
          <p class="section-desc">Recommended satoshis per virtual byte for next block confirmation.</p>

          <div class="aladdin-kpi-grid mt-2">
            <div class="kpi-card">
              <span class="kpi-label">⚡ HIGH PRIORITY (NEXT BLOCK)</span>
              <span class="kpi-val text-green">${mempool ? mempool.fastestFee : 6} sat/vB</span>
              <span class="kpi-sub">~10 MINUTE INCLUSION</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">🚗 MEDIUM PRIORITY (3 BLOCKS)</span>
              <span class="kpi-val text-cyan">${mempool ? mempool.halfHourFee : 5} sat/vB</span>
              <span class="kpi-sub">~30 MINUTE INCLUSION</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">🐢 ECONOMY / LOW PRIORITY</span>
              <span class="kpi-val text-amber">${mempool ? mempool.minimumFee : 1} sat/vB</span>
              <span class="kpi-sub">OFF-PEAK CLEARANCE</span>
            </div>
          </div>
        </section>

        <!-- Open Interest Matrix -->
        <section class="terminal-section mt-3">
          <span class="section-title">PERPETUAL FUTURES OPEN INTEREST (OI)</span>
          <p class="section-desc">Total outstanding derivative contracts measuring leverage exposure in the system.</p>

          <table class="terminal-table mt-2">
            <thead>
              <tr>
                <th>ASSET</th>
                <th>CONTRACT</th>
                <th>OPEN INTEREST (USD)</th>
                <th>OPEN INTEREST (COINS)</th>
                <th>LEVERAGE REGIME</th>
              </tr>
            </thead>
            <tbody>
              ${Array.from(snapshot.openInterest.values())
                .map(
                  (oi) => `
                <tr>
                  <td><strong>${oi.asset}</strong></td>
                  <td>${oi.symbol}</td>
                  <td class="text-cyan">$${Math.round(oi.openInterestUsd).toLocaleString()}</td>
                  <td>${oi.openInterestCoins.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${oi.asset}</td>
                  <td><span class="regime-badge regime-extreme">HIGH LEVERAGE</span></td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </section>
      </div>
    `;
  }

  // ==========================================
  // SCREEN: BLACKROCK ALADDIN RISK ENGINE
  // ==========================================
  private renderRiskScreen(container: HTMLElement): void {
    const presetInfo = this.getActivePresetInfo();
    const liveReturns = this.returnsService.getReturns();

    // Revalue portfolio against live Binance tick prices
    let totalVal = 0;
    this.portfolio.positions.forEach((p) => {
      const live = this.tickers.get(`${p.symbol}USDT`);
      if (live) {
        p.currentPrice = live.price;
        p.valueUsd = p.amount * p.currentPrice;
      }
      totalVal += p.valueUsd;
    });
    this.portfolio.totalValueUsd = this.portfolio.cashUsd + totalVal;
    this.portfolio.totalCollateralUsd = this.portfolio.totalValueUsd;

    const varResult = AladdinRiskEngine.calculateParametricVaR(
      this.portfolio,
      liveReturns,
      0.95,
      1,
    );
    const betaResult = AladdinRiskEngine.calculateBeta(
      this.portfolio,
      liveReturns,
      "BTC",
    );
    const divResult = AladdinRiskEngine.calculateDiversification(
      this.portfolio,
      liveReturns,
    );

    const scenario =
      AladdinRiskEngine.DEFAULT_SCENARIOS.find(
        (s) => s.id === this.selectedStressId,
      ) || AladdinRiskEngine.DEFAULT_SCENARIOS[0]!;
    const stressResult = AladdinRiskEngine.runStressTest(
      this.portfolio,
      scenario,
    );

    const presets = ReferenceData.getAllPresets();

    container.innerHTML = `
      <div class="terminal-screen screen-risk">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">2. BLACKROCK ALADDIN RISK ENGINE</h2>
            <span class="screen-subtitle">PARAMETRIC VALUE-AT-RISK (VaR 95%), BENCHMARK BETA &amp; STRESS SIMULATION</span>
          </div>
          <span class="terminal-badge badge-aladdin">ALADDIN CORE ACTIVE</span>
        </div>

        <!-- Portfolio Preset Switcher Bar -->
        <div class="portfolio-selector-bar">
          <span class="selector-label">ACTIVE PORTFOLIO DATASET:</span>
          ${presets
            .map(
              (p) => `
            <button class="preset-chip ${p.id === this.selectedPresetId ? "active" : ""}" data-preset="${p.id}">
              <strong>${p.name}</strong>
              <span class="preset-badge">${p.badge}</span>
            </button>
          `,
            )
            .join("")}
        </div>

        <!-- Verified Real Data Banner -->
        <div class="real-source-banner">
          <span class="live-pulse"></span>
          <span><strong>100% REAL DATA:</strong> ${presetInfo.description}</span>
          <span class="returns-badge ${this.returnsService.isLive() ? "badge-live" : "badge-calibrated"}">
            ${this.returnsService.isLive() ? "● LIVE BINANCE 60-DAY DAILY COVARIANCE" : "○ CALIBRATING BINANCE COVARIANCE..."}
          </span>
        </div>

        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">TOTAL PORTFOLIO VALUE</span>
            <span class="kpi-val text-cyan">$${Math.round(varResult.portfolioValueUsd).toLocaleString()}</span>
            <span class="kpi-sub">${this.portfolio.positions.length} ACTIVE POSITIONS · ${this.selectedPresetId}</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">1-DAY VaR (95% CONFIDENCE)</span>
            <span class="kpi-val text-red">-$${Math.round(varResult.parametricVaRUsd).toLocaleString()}</span>
            <span class="kpi-sub">${varResult.parametricVaRPercent.toFixed(2)}% CAPITAL AT RISK</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">PORTFOLIO BETA TO BTC</span>
            <span class="kpi-val text-amber">${betaResult.portfolioBeta.toFixed(2)}</span>
            <span class="kpi-sub">${betaResult.systemicRiskClassification} EXPOSURE</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">DIVERSIFICATION SCORE</span>
            <span class="kpi-val text-green">${divResult.score.toFixed(0)}/100</span>
            <span class="kpi-sub">${divResult.regime} RISK SPREAD</span>
          </div>
        </div>

        <section class="terminal-section mt-4">
          <div class="section-header-flex">
            <div>
              <span class="section-title">MULTI-FACTOR STRESS TEST SCENARIO ENGINE</span>
              <p class="section-desc">Simulate non-linear market contagion, cascading liquidation buffers, and drawdown.</p>
            </div>
            <div class="scenario-buttons">
              ${AladdinRiskEngine.DEFAULT_SCENARIOS.map(
                (s) => `
                <button class="scenario-btn ${s.id === this.selectedStressId ? "active" : ""}" data-id="${s.id}">
                  ${s.name}
                </button>
              `,
              ).join("")}
            </div>
          </div>

          <div class="stress-results-card">
            <div class="stress-summary-row">
              <div>
                <span class="stat-label">Stressed Portfolio Value</span>
                <span class="stat-val text-cyan">$${Math.round(stressResult.stressedPortfolioValueUsd).toLocaleString()}</span>
              </div>
              <div>
                <span class="stat-label">Projected Dollar Drawdown</span>
                <span class="stat-val text-red">-$${Math.round(stressResult.totalDrawdownUsd).toLocaleString()}</span>
              </div>
              <div>
                <span class="stat-label">Percentage Impact</span>
                <span class="stat-val text-red">-${stressResult.totalDrawdownPercent.toFixed(2)}%</span>
              </div>
              <div>
                <span class="stat-label">System Liquidation Alert</span>
                <span class="stat-val ${stressResult.liquidatedPositions.length > 0 ? "text-red" : "text-green"}">
                  ${stressResult.liquidatedPositions.length > 0 ? "⚠️ LIQUIDATION TRIGGERED" : "✓ LIQUIDATION SAFE"}
                </span>
              </div>
            </div>

            <table class="terminal-table mt-3">
              <thead>
                <tr>
                  <th>ASSET</th>
                  <th>STRESSED VALUE</th>
                  <th>DRAWDOWN PnL</th>
                  <th>DRAWDOWN %</th>
                  <th>DIST. TO LIQ</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${Object.values(stressResult.positionImpacts)
                  .map(
                    (p: PositionStressImpact) => `
                  <tr>
                    <td><strong>${p.symbol}</strong></td>
                    <td>$${Math.round(p.stressedValueUsd).toLocaleString()}</td>
                    <td class="text-red">-$${Math.round(p.pnlDrawdownUsd).toLocaleString()}</td>
                    <td class="text-red">${p.pnlDrawdownPercent.toFixed(1)}%</td>
                    <td>${(p.distanceToLiquidationPercent * 100).toFixed(1)}%</td>
                    <td>
                      <span class="health-pill ${p.isLiquidated ? "health-critical" : p.distanceToLiquidationPercent < 0.15 ? "health-warning" : "health-safe"}">
                        ${p.isLiquidated ? "LIQUIDATED" : "SOLVENT"}
                      </span>
                    </td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    this.bindRiskEvents();
  }

  private bindRiskEvents(): void {
    // Scenario clicks
    document.querySelectorAll(".scenario-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute("data-id");
        if (id) {
          playCommandGo();
          this.selectedStressId = id;
          this.render();
        }
      });
    });

    // Preset chips clicks
    document.querySelectorAll(".preset-chip").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const preset = (e.currentTarget as HTMLElement).getAttribute(
          "data-preset",
        ) as PortfolioPresetId | null;
        if (preset) {
          playCommandGo();
          this.switchPreset(preset);
        }
      });
    });
  }

  private switchPreset(preset: PortfolioPresetId): void {
    this.selectedPresetId = preset;
    this.portfolio = this.getPortfolioForPreset(preset);
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem("apex_active_preset", preset);
      } catch {}
    }
    this.render();
  }

  // ==========================================
  // SCREEN: FUNDING HEATMAP
  // ==========================================
  private renderFundingScreen(container: HTMLElement): void {
    container.innerHTML = `
      <div class="terminal-screen screen-funding">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">3. PERPETUAL FUNDING RATE HEATMAP &amp; REGIME MATRIX</h2>
            <span class="screen-subtitle">BINANCE FUTURES PUBLIC 8-HOUR RATE, ANNUALIZED APR &amp; SQUEEZE DETECTOR (100% REAL)</span>
          </div>
        </div>

        <div class="funding-table-wrap">
          <table class="terminal-table">
            <thead>
              <tr>
                <th>PERP SYMBOL</th>
                <th>INDEX PRICE</th>
                <th>MARK PRICE</th>
                <th>8H RATE</th>
                <th>ANNUALIZED APR</th>
                <th>COMPOUNDED APY</th>
                <th>MARKET REGIME</th>
              </tr>
            </thead>
            <tbody>
              ${
                this.fundingRates.length === 0
                  ? `<tr><td colspan="7" class="text-center">Awaiting Binance Futures Funding Rate Feed...</td></tr>`
                  : this.fundingRates
                      .map((f) => {
                        const isExtreme =
                          f.regime === "EXTREME_BULL" ||
                          f.regime === "SHORT_SQUEEZE_RISK";
                        const isSqueeze = f.regime === "SHORT_SQUEEZE_RISK";
                        const rateClass =
                          f.annualizedAPR >= 0 ? "text-green" : "text-red";

                        return `
                    <tr class="${isExtreme ? "row-highlight" : ""}">
                      <td><strong>${f.symbol}</strong></td>
                      <td>$${f.indexPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td>$${f.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td class="${rateClass}">${(f.fundingRate * 100).toFixed(4)}%</td>
                      <td class="${rateClass}">${f.annualizedAPR >= 0 ? "+" : ""}${f.annualizedAPR.toFixed(2)}%</td>
                      <td class="${rateClass}">${f.annualizedAPY.toFixed(2)}%</td>
                      <td>
                        <span class="regime-badge ${isSqueeze ? "regime-squeeze" : isExtreme ? "regime-extreme" : "regime-normal"}">
                          ${f.regime}
                        </span>
                      </td>
                    </tr>
                  `;
                      })
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==========================================
  // SCREEN: PORTFOLIO HOLDINGS
  // ==========================================
  private renderPortfolioScreen(container: HTMLElement): void {
    const presetInfo = this.getActivePresetInfo();
    const presets = ReferenceData.getAllPresets();

    let totalNominal = 0;
    this.portfolio.positions.forEach((p) => {
      const live = this.tickers.get(`${p.symbol}USDT`);
      if (live) {
        p.currentPrice = live.price;
        p.valueUsd = p.amount * p.currentPrice;
      }
      totalNominal += p.valueUsd;
    });

    container.innerHTML = `
      <div class="terminal-screen screen-portfolio">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">4. INSTITUTIONAL PORTFOLIO LEDGER</h2>
            <span class="screen-subtitle">TOTAL NAV: $${Math.round(totalNominal + this.portfolio.cashUsd).toLocaleString()} USD · ${this.portfolio.name}</span>
          </div>
          <div>
            <button id="btn-toggle-editor" class="btn-amber">
              ${this.isEditingCustomPortfolio ? "✕ CLOSE EDITOR" : "✏️ EDIT REAL HOLDINGS"}
            </button>
          </div>
        </div>

        <!-- Portfolio Preset Switcher Bar -->
        <div class="portfolio-selector-bar">
          <span class="selector-label">SELECT HOLDINGS:</span>
          ${presets
            .map(
              (p) => `
            <button class="preset-chip ${p.id === this.selectedPresetId ? "active" : ""}" data-preset="${p.id}">
              <strong>${p.name}</strong>
              <span class="preset-badge">${p.badge}</span>
            </button>
          `,
            )
            .join("")}
        </div>

        <!-- Verified Real Data Banner -->
        <div class="real-source-banner">
          <span class="live-pulse"></span>
          <span><strong>PORTFOLIO SOURCE:</strong> ${presetInfo.description}</span>
          <span class="returns-badge badge-live">100% REAL LIVE MARKET EVALUATION</span>
        </div>

        <!-- Interactive Custom Portfolio Editor Box -->
        ${
          this.isEditingCustomPortfolio
            ? `
          <div class="portfolio-editor-box">
            <span class="section-title">CUSTOM REAL HOLDINGS EDITOR</span>
            <p class="section-desc">Enter your real cryptocurrency balances and entry prices. Saved locally in your browser storage.</p>
            
            <div class="editor-grid" id="editor-positions-list">
              <div class="editor-row font-bold text-dim">
                <span>SYMBOL</span>
                <span>QUANTITY</span>
                <span>ENTRY PRICE ($)</span>
                <span>LEVERAGE</span>
                <span></span>
              </div>
              ${this.portfolio.positions
                .map(
                  (pos, idx) => `
                <div class="editor-row" data-idx="${idx}">
                  <input type="text" class="form-input input-symbol" value="${pos.symbol}" placeholder="e.g. BTC" />
                  <input type="number" step="any" class="form-input input-amount" value="${pos.amount}" placeholder="Amount" />
                  <input type="number" step="any" class="form-input input-entry" value="${pos.entryPrice || pos.currentPrice}" placeholder="Entry Price" />
                  <input type="number" step="0.5" class="form-input input-leverage" value="${pos.leverage || 1}" placeholder="1x" />
                  <button class="btn-danger-sm btn-delete-row" data-idx="${idx}" title="Delete">✕</button>
                </div>
              `,
                )
                .join("")}
            </div>

            <div class="editor-actions">
              <button id="btn-add-position" class="btn-secondary">➕ Add Position</button>
              <button id="btn-save-portfolio" class="btn-amber">💾 Save &amp; Revalue Portfolio</button>
              <button id="btn-cancel-editor" class="btn-secondary">Cancel</button>
            </div>
          </div>
        `
            : ""
        }

        <table class="terminal-table mt-3">
          <thead>
            <tr>
              <th>ASSET</th>
              <th>QUANTITY</th>
              <th>ENTRY PRICE</th>
              <th>LIVE PRICE (BINANCE)</th>
              <th>NOMINAL VALUE</th>
              <th>UNREALIZED PnL</th>
              <th>LEVERAGE</th>
            </tr>
          </thead>
          <tbody>
            ${this.portfolio.positions
              .map((pos) => {
                const entry = pos.entryPrice ?? pos.currentPrice;
                const pnl = (pos.currentPrice - entry) * pos.amount;
                const pnlPercent =
                  entry > 0 ? ((pos.currentPrice - entry) / entry) * 100 : 0;
                const pnlClass = pnl >= 0 ? "text-green" : "text-red";

                return `
                <tr>
                  <td><strong>${pos.symbol}</strong></td>
                  <td>${pos.amount.toLocaleString()}</td>
                  <td>$${entry.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td class="font-bold">$${pos.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td>$${Math.round(pos.valueUsd).toLocaleString()}</td>
                  <td class="${pnlClass}">${pnl >= 0 ? "+" : ""}$${Math.round(pnl).toLocaleString()} (${pnlPercent.toFixed(2)}%)</td>
                  <td>${pos.leverage || 1}x</td>
                </tr>
              `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;

    this.bindPortfolioEvents();
  }

  private bindPortfolioEvents(): void {
    // Preset clicks
    document.querySelectorAll(".preset-chip").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const preset = (e.currentTarget as HTMLElement).getAttribute(
          "data-preset",
        ) as PortfolioPresetId | null;
        if (preset) {
          playCommandGo();
          this.switchPreset(preset);
        }
      });
    });

    // Toggle editor button
    const toggleBtn = document.getElementById("btn-toggle-editor");
    toggleBtn?.addEventListener("click", () => {
      playCommandGo();
      this.isEditingCustomPortfolio = !this.isEditingCustomPortfolio;
      this.render();
    });

    // Add position button
    const addBtn = document.getElementById("btn-add-position");
    addBtn?.addEventListener("click", () => {
      playCommandGo();
      this.portfolio.positions.push({
        symbol: "SOL",
        amount: 10,
        currentPrice: 135,
        valueUsd: 1350,
        entryPrice: 135,
        leverage: 1.0,
        isLong: true,
        maintenanceMarginRatio: 0.07,
      });
      this.render();
    });

    // Delete row buttons
    document.querySelectorAll(".btn-delete-row").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(
          (e.currentTarget as HTMLElement).getAttribute("data-idx") || "-1",
          10,
        );
        if (idx >= 0 && idx < this.portfolio.positions.length) {
          playCommandGo();
          this.portfolio.positions.splice(idx, 1);
          this.render();
        }
      });
    });

    // Cancel editor
    const cancelBtn = document.getElementById("btn-cancel-editor");
    cancelBtn?.addEventListener("click", () => {
      playCommandGo();
      this.isEditingCustomPortfolio = false;
      this.render();
    });

    // Save portfolio
    const saveBtn = document.getElementById("btn-save-portfolio");
    saveBtn?.addEventListener("click", () => {
      playCommandGo();
      const rows = document.querySelectorAll(".editor-row[data-idx]");
      const newPositions: AssetPosition[] = [];

      rows.forEach((r) => {
        const sym =
          (r.querySelector(".input-symbol") as HTMLInputElement)?.value
            .toUpperCase()
            .trim() || "BTC";
        const amt =
          parseFloat(
            (r.querySelector(".input-amount") as HTMLInputElement)?.value,
          ) || 0;
        const entry =
          parseFloat(
            (r.querySelector(".input-entry") as HTMLInputElement)?.value,
          ) || 0;
        const lev =
          parseFloat(
            (r.querySelector(".input-leverage") as HTMLInputElement)?.value,
          ) || 1;

        const live = this.tickers.get(`${sym}USDT`);
        const curPrice = live ? live.price : entry > 0 ? entry : 100;

        newPositions.push({
          symbol: sym,
          amount: amt,
          currentPrice: curPrice,
          valueUsd: amt * curPrice,
          entryPrice: entry > 0 ? entry : curPrice,
          leverage: lev,
          isLong: true,
          maintenanceMarginRatio: 0.05,
        });
      });

      this.portfolio.name = "My Real Crypto Portfolio (Personal)";
      this.portfolio.positions = newPositions;
      this.selectedPresetId = "CUSTOM";
      this.isEditingCustomPortfolio = false;

      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(
            "apex_user_real_portfolio",
            JSON.stringify(this.portfolio),
          );
          localStorage.setItem("apex_active_preset", "CUSTOM");
        } catch {}
      }

      this.render();
    });
  }

  // ==========================================
  // SCREEN: HELP & GRAMMAR
  // ==========================================
  private renderHelpScreen(container: HTMLElement): void {
    container.innerHTML = `
      <div class="terminal-screen screen-help">
        <div class="screen-header">
          <h2 class="screen-title">APEX TERMINAL COMMAND INDEX &amp; GRAMMAR</h2>
        </div>

        <div class="help-grid">
          <div class="help-card">
            <span class="help-cmd">MARKET &lt;GO&gt; [F2]</span>
            <p>Live streaming multi-asset pricing matrix, orderflow depth imbalance, and Fear &amp; Greed gauge (100% Real Live Binance).</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">CHART &lt;GO&gt; [F5]</span>
            <p>60 FPS high-frequency HTML5 Canvas candlestick chart with VWAP and horizontal Volume Profile (POC).</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">WHALE &lt;GO&gt; [F6]</span>
            <p>Real-time Whale radar, block prints &ge; $50K, and Cumulative Volume Delta (CVD) net institutional accumulation.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">LIQ &lt;GO&gt; [F7]</span>
            <p>Direct Binance Futures !forceOrder liquidation stream. Real-time liquidation alerts, long vs short rekt ratios.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">RISK &lt;GO&gt; [F3]</span>
            <p>BlackRock Aladdin Parametric Value-at-Risk (VaR 95%), Portfolio Beta to Bitcoin, and Diversification score on verified reserves.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">ARB &lt;GO&gt; [F9]</span>
            <p>Institutional Cash &amp; Carry Basis Arbitrage Matrix. Spot vs Perpetual spread and delta-neutral annualized yield.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">FUND &lt;GO&gt; [F4]</span>
            <p>Perpetual futures funding rate heatmap, APR/APY compounding, and short-squeeze trigger detector.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">NEWS &lt;GO&gt; [F10]</span>
            <p>Real-time institutional news wire with NLP algorithmic sentiment scoring (Bullish / Bearish / Neutral).</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">MACRO &lt;GO&gt;</span>
            <p>Bitcoin Mempool sat/vB fee dynamics (mempool.space) &amp; Open Interest (OI) metrics.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">PORT &lt;GO&gt; [F8]</span>
            <p>Portfolio holdings ledger, unrealized PnL tracking, and customizable real balances.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">ALERT &lt;GO&gt;</span>
            <p>Browser desktop push notifications and acoustic alerts for kraken trades, casualties, and funding spikes.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">BTC &lt;GO&gt; / ETH &lt;GO&gt;</span>
            <p>Direct symbol lookup and interactive execution chart.</p>
          </div>
        </div>
      </div>
    `;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    new ApexWebTerminal();
  });
}
