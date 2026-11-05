/**
 * Apex Terminal - Institutional Web Application
 * Bloomberg Terminal & BlackRock Aladdin Web Experience for Digital Assets.
 * Includes Live Whale Stream, Real-Time Liquidations Feed, and On-Chain Mempool Vitality.
 */

import { BinanceWsFeedManager, BinanceWsState } from "../feeds/binance-ws.js";
import { FundingRateCalculator } from "../feeds/funding-calculator.js";
import { RestFallbackService } from "../feeds/fallback-rest.js";
import { AladdinRiskEngine } from "../risk/aladdin-engine.js";
import { ReferenceData } from "../risk/sample-data.js";
import {
  WhaleStreamManager,
  WhaleTrade,
  LiquidationEvent,
} from "../feeds/whale-stream.js";
import { OnChainVitalityService } from "../feeds/onchain-vitality.js";
import {
  MarketTicker,
  InstitutionalPortfolio,
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

const DEFAULT_PORTFOLIO: InstitutionalPortfolio =
  ReferenceData.getSamplePortfolio();
const CALIBRATED_RETURNS = ReferenceData.getCalibratedReturns();

class ApexWebTerminal {
  private binanceWs: BinanceWsFeedManager;
  private restService: RestFallbackService;
  private whaleStream: WhaleStreamManager;
  private onChainService: OnChainVitalityService;

  private tickers: Map<string, MarketTicker> = new Map();
  private prevPrices: Map<string, number> = new Map();
  private fundingRates: FundingRateData[] = [];
  private fearGreed: FearAndGreedData | null = null;
  private portfolio: InstitutionalPortfolio = DEFAULT_PORTFOLIO;

  private activeScreen:
    | "MARKET"
    | "RISK"
    | "FUNDING"
    | "WHALE"
    | "LIQ"
    | "MACRO"
    | "PORT"
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

    this.initDOM();
    this.bindEvents();
    this.startFeeds();
    this.startClock();
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
            <input type="text" id="cmd-input" class="command-input" placeholder="Enter command (e.g. WHALE &lt;GO&gt;, LIQ &lt;GO&gt;, RISK &lt;GO&gt;, BTC &lt;GO&gt;)..." autocomplete="off" spellcheck="false" />
            <button id="btn-go" class="btn-go">&lt;GO&gt;</button>
          </div>
          <div class="quick-commands">
            <button class="cmd-chip active" data-cmd="MARKET">MARKET &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="WHALE">🐋 WHALE &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="LIQ">⚡ LIQ &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="RISK">RISK &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="FUND">FUND &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="MACRO">MACRO &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="PORT">PORT &lt;GO&gt;</button>
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
            <span>[F6: WHALE]</span>
            <span>[F7: LIQ]</span>
            <span>[F8: PORT]</span>
          </div>
          <div class="footer-right">
            <span>ZERO-CLOUD · 100% LOCAL ALADDIN RISK ENGINE · PUBLIC WEBSOCKETS</span>
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
      } else if (e.key === "F6") {
        e.preventDefault();
        this.executeCommand("WHALE <GO>");
      } else if (e.key === "F7") {
        e.preventDefault();
        this.executeCommand("LIQ <GO>");
      } else if (e.key === "F8") {
        e.preventDefault();
        this.executeCommand("PORT <GO>");
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
      this.activeScreen = "MARKET";
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
      this.updateTickerTape();
      if (this.activeScreen === "WHALE") {
        this.renderWhaleLive(trade);
      }
    });

    this.whaleStream.onLiquidation((liq) => {
      playLiquidationZap();
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
        if (this.activeScreen === "FUNDING") this.render();
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

    setInterval(() => {
      FundingRateCalculator.fetchLiveFundingRates().then(
        (r) => (this.fundingRates = r),
      );
      this.onChainService.fetchMempoolFees();
      this.onChainService.fetchOpenInterest(this.prevPrices);
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
    } else if (this.activeScreen === "WHALE") {
      this.renderWhaleScreen(body);
    } else if (this.activeScreen === "LIQ") {
      this.renderLiquidationScreen(body);
    } else if (this.activeScreen === "RISK") {
      this.renderRiskScreen(body);
    } else if (this.activeScreen === "FUNDING") {
      this.renderFundingScreen(body);
    } else if (this.activeScreen === "MACRO") {
      this.renderMacroScreen(body);
    } else if (this.activeScreen === "PORT") {
      this.renderPortfolioScreen(body);
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
            <span class="screen-subtitle">REAL-TIME MULTI-ASSET STREAMING VIA ZERO-KEY WEBSOCKETS</span>
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
                <th>ORDERFLOW BIAS</th>
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

    return `
      <tr id="row-${sym}">
        <td class="td-symbol"><strong>${asset}</strong>/USDT</td>
        <td class="td-price" id="price-${sym}">${price}</td>
        <td class="td-chg ${chgClass}" id="chg-${sym}">${chg}</td>
        <td class="td-high">${high}</td>
        <td class="td-low">${low}</td>
        <td class="td-vol">${vol}</td>
        <td class="td-bias">
          <div class="orderflow-bar">
            <div class="orderflow-buy" style="width: 54%;"></div>
            <div class="orderflow-sell" style="width: 46%;"></div>
          </div>
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
  }

  // ==========================================
  // SCREEN: WHALE FLOW RADAR
  // ==========================================
  private renderWhaleScreen(container: HTMLElement): void {
    const metrics = this.whaleStream.getMetrics();
    const trades = this.whaleStream.getWhaleTrades().filter((t) => {
      if (this.whaleFilter === "100K") return t.valueUsd >= 100000;
      if (this.whaleFilter === "500K") return t.valueUsd >= 500000;
      if (this.whaleFilter === "1M") return t.valueUsd >= 1000000;
      return true;
    });

    const isNetPositive = metrics.netWhaleDeltaUsd >= 0;

    container.innerHTML = `
      <div class="terminal-screen screen-whale">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">🐋 REAL-TIME WHALE RADAR &amp; INSTITUTIONAL BLOCK FLOW</h2>
            <span class="screen-subtitle">LIVE WEBSOCKET AGGREGATED PRINTS &ge; $50K WITH CUMULATIVE VOLUME DELTA (CVD)</span>
          </div>
          <div class="filter-group">
            <button class="filter-btn ${this.whaleFilter === "ALL" ? "active" : ""}" data-filter="ALL">&ge; $50K</button>
            <button class="filter-btn ${this.whaleFilter === "100K" ? "active" : ""}" data-filter="100K">&ge; $100K</button>
            <button class="filter-btn ${this.whaleFilter === "500K" ? "active" : ""}" data-filter="500K">&ge; $500K</button>
            <button class="filter-btn ${this.whaleFilter === "1M" ? "active" : ""}" data-filter="1M">&ge; $1M (KRAKEN)</button>
          </div>
        </div>

        <!-- Whale Metrics KPIs -->
        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">WHALE BUY VOLUME</span>
            <span class="kpi-val text-green">$${Math.round(metrics.totalWhaleBuyVolumeUsd).toLocaleString()}</span>
            <span class="kpi-sub">AGGRESSIVE TAKER BUYS</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">WHALE SELL VOLUME</span>
            <span class="kpi-val text-red">$${Math.round(metrics.totalWhaleSellVolumeUsd).toLocaleString()}</span>
            <span class="kpi-sub">AGGRESSIVE TAKER DUMPS</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">CUMULATIVE WHALE DELTA (CVD)</span>
            <span class="kpi-val ${isNetPositive ? "text-green" : "text-red"}">
              ${isNetPositive ? "+" : ""}$${Math.round(metrics.netWhaleDeltaUsd).toLocaleString()}
            </span>
            <span class="kpi-sub">${isNetPositive ? "NET INSTITUTIONAL ACCUMULATION" : "NET INSTITUTIONAL DISTRIBUTION"}</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">WHALE ACTIVITY PULSE</span>
            <span class="kpi-val text-cyan">${trades.length} PRINTS</span>
            <span class="kpi-sub">LIVE TAPE BUFFER</span>
          </div>
        </div>

        <!-- Live Whale Table -->
        <div class="market-matrix-table-wrap mt-3">
          <table class="terminal-table" id="whale-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>ASSET</th>
                <th>ACTION</th>
                <th>NOTIONAL VALUE</th>
                <th>SIZE</th>
                <th>EXECUTION PRICE</th>
                <th>WHALE TIER</th>
              </tr>
            </thead>
            <tbody id="whale-tbody">
              ${
                trades.length === 0
                  ? `<tr><td colspan="7" class="text-center">Listening for block trades &ge; $50,000 on Binance...</td></tr>`
                  : trades.map((t) => this.renderWhaleRow(t)).join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const filter = (e.currentTarget as HTMLElement).getAttribute(
          "data-filter",
        ) as any;
        if (filter) {
          this.whaleFilter = filter;
          this.render();
        }
      });
    });
  }

  private renderWhaleRow(t: WhaleTrade): string {
    const timeStr = new Date(t.timestamp).toLocaleTimeString();
    const sideClass = t.side === "BUY" ? "text-green" : "text-red";
    const tierBadge =
      t.tier === "KRAKEN"
        ? "tier-kraken"
        : t.tier === "MEGALODON"
          ? "tier-megalodon"
          : t.tier === "WHALE"
            ? "tier-whale"
            : "tier-dolphin";

    return `
      <tr>
        <td class="text-dim">${timeStr}</td>
        <td><strong>${t.asset}</strong>/USDT</td>
        <td class="${sideClass}"><strong>${t.side}</strong></td>
        <td class="${sideClass}">$${Math.round(t.valueUsd).toLocaleString()}</td>
        <td>${t.quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${t.asset}</td>
        <td>$${t.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        <td><span class="badge ${tierBadge}">● ${t.tier}</span></td>
      </tr>
    `;
  }

  private renderWhaleLive(trade: WhaleTrade): void {
    const tbody = document.getElementById("whale-tbody");
    if (!tbody) return;

    if (this.whaleFilter === "100K" && trade.valueUsd < 100000) return;
    if (this.whaleFilter === "500K" && trade.valueUsd < 500000) return;
    if (this.whaleFilter === "1M" && trade.valueUsd < 1000000) return;

    const rowHtml = this.renderWhaleRow(trade);
    tbody.insertAdjacentHTML("afterbegin", rowHtml);
    if (tbody.children.length > 50) {
      tbody.removeChild(tbody.lastChild!);
    }
  }

  // ==========================================
  // SCREEN: LIQUIDATION RADAR
  // ==========================================
  private renderLiquidationScreen(container: HTMLElement): void {
    const metrics = this.whaleStream.getMetrics();
    const liqs = this.whaleStream.getLiquidations();
    const totalLiqUsd =
      metrics.totalLiquidationsLongUsd + metrics.totalLiquidationsShortUsd;

    const longPct =
      totalLiqUsd > 0
        ? (metrics.totalLiquidationsLongUsd / totalLiqUsd) * 100
        : 50;
    const shortPct =
      totalLiqUsd > 0
        ? (metrics.totalLiquidationsShortUsd / totalLiqUsd) * 100
        : 50;

    container.innerHTML = `
      <div class="terminal-screen screen-liq">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">⚡ REAL-TIME LIQUIDATION RADAR &amp; REKT TAPE</h2>
            <span class="screen-subtitle">BINANCE FUTURES PUBLIC !forceOrder@arr FORCED DELEVERAGING STREAM</span>
          </div>
          <span class="terminal-badge badge-aladdin">LIVE LIQUIDATIONS ENGINE</span>
        </div>

        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">TOTAL FORCED LIQUIDATIONS</span>
            <span class="kpi-val text-amber">$${Math.round(totalLiqUsd).toLocaleString()}</span>
            <span class="kpi-sub">${metrics.totalLiquidationsCount} REKT ACCOUNTS</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">LONGS LIQUIDATED (BULL BLEED)</span>
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
                  ? `<tr><td colspan="6" class="text-center">Connected to Binance Futures forced liquidation feed. Awaiting liquidation events...</td></tr>`
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

    return `
      <tr class="row-flash-liq">
        <td class="text-dim">${timeStr}</td>
        <td><strong>${l.asset}</strong>USDT PERP</td>
        <td class="${sideClass}"><strong>⚡ ${l.side} REKT</strong></td>
        <td class="${sideClass}">$${Math.round(l.valueUsd).toLocaleString()}</td>
        <td>${l.quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${l.asset}</td>
        <td>$${l.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      </tr>
    `;
  }

  private renderLiquidationLive(liq: LiquidationEvent): void {
    const tbody = document.getElementById("liq-tbody");
    if (!tbody) return;

    const rowHtml = this.renderLiquidationRow(liq);
    tbody.insertAdjacentHTML("afterbegin", rowHtml);
    if (tbody.children.length > 50) {
      tbody.removeChild(tbody.lastChild!);
    }
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
      CALIBRATED_RETURNS,
      0.95,
      1,
    );
    const betaResult = AladdinRiskEngine.calculateBeta(
      this.portfolio,
      CALIBRATED_RETURNS,
      "BTC",
    );
    const divResult = AladdinRiskEngine.calculateDiversification(
      this.portfolio,
      CALIBRATED_RETURNS,
    );

    const scenario =
      AladdinRiskEngine.DEFAULT_SCENARIOS.find(
        (s) => s.id === this.selectedStressId,
      ) || AladdinRiskEngine.DEFAULT_SCENARIOS[0]!;
    const stressResult = AladdinRiskEngine.runStressTest(
      this.portfolio,
      scenario,
    );

    container.innerHTML = `
      <div class="terminal-screen screen-risk">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">2. BLACKROCK ALADDIN RISK ENGINE</h2>
            <span class="screen-subtitle">PARAMETRIC VALUE-AT-RISK (VaR 95%), BENCHMARK BETA &amp; STRESS SIMULATION</span>
          </div>
          <span class="terminal-badge badge-aladdin">ALADDIN CORE ACTIVE</span>
        </div>

        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">TOTAL PORTFOLIO VALUE</span>
            <span class="kpi-val text-cyan">$${Math.round(varResult.portfolioValueUsd).toLocaleString()}</span>
            <span class="kpi-sub">${this.portfolio.positions.length} ACTIVE POSITIONS</span>
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
            <span class="screen-subtitle">BINANCE FUTURES PUBLIC 8-HOUR RATE, ANNUALIZED APR &amp; SQUEEZE DETECTOR</span>
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
            <span class="screen-subtitle">TOTAL NAV: $${Math.round(totalNominal + this.portfolio.cashUsd).toLocaleString()} USD</span>
          </div>
        </div>

        <table class="terminal-table mt-3">
          <thead>
            <tr>
              <th>ASSET</th>
              <th>QUANTITY</th>
              <th>ENTRY PRICE</th>
              <th>CURRENT PRICE</th>
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
                  <td>$${pos.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
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
            <p>Live streaming multi-asset pricing matrix, orderflow depth imbalance, and Fear &amp; Greed gauge.</p>
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
            <p>BlackRock Aladdin Parametric Value-at-Risk (VaR 95%), Portfolio Beta to Bitcoin, and Diversification score.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">FUND &lt;GO&gt; [F4]</span>
            <p>Perpetual futures funding rate heatmap, APR/APY compounding, and short-squeeze trigger detector.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">MACRO &lt;GO&gt;</span>
            <p>Bitcoin Mempool sat/vB fee dynamics (mempool.space) &amp; Open Interest (OI) metrics.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">PORT &lt;GO&gt; [F8]</span>
            <p>Portfolio holdings ledger, unrealized PnL tracking, and leverage margins.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">BTC &lt;GO&gt; / ETH &lt;GO&gt;</span>
            <p>Direct symbol lookup and real-time execution monitor.</p>
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
