/**
 * Apex Terminal - Institutional Web Application
 * Bloomberg Terminal & BlackRock Aladdin Web Experience for Digital Assets.
 */

import { BinanceWsFeedManager, BinanceWsState } from "../feeds/binance-ws.js";
import { FundingRateCalculator } from "../feeds/funding-calculator.js";
import { RestFallbackService } from "../feeds/fallback-rest.js";
import { AladdinRiskEngine } from "../risk/aladdin-engine.js";
import { ReferenceData } from "../risk/sample-data.js";
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
  toggleMute,
  isMuted,
} from "../audio.js";

// Calibrated reference portfolio & returns
const DEFAULT_PORTFOLIO: InstitutionalPortfolio =
  ReferenceData.getSamplePortfolio();
const CALIBRATED_RETURNS = ReferenceData.getCalibratedReturns();

class ApexWebTerminal {
  private binanceWs: BinanceWsFeedManager;
  private restService: RestFallbackService;

  private tickers: Map<string, MarketTicker> = new Map();
  private prevPrices: Map<string, number> = new Map();
  private fundingRates: FundingRateData[] = [];
  private fearGreed: FearAndGreedData | null = null;
  private portfolio: InstitutionalPortfolio = DEFAULT_PORTFOLIO;

  private activeScreen: "MARKET" | "RISK" | "FUNDING" | "PORT" | "HELP" =
    "MARKET";
  private selectedStressId: string = "CRYPTO_CRASH_20";

  constructor() {
    this.binanceWs = new BinanceWsFeedManager({
      webSocketConstructor:
        typeof WebSocket !== "undefined" ? WebSocket : undefined,
    });
    this.restService = new RestFallbackService();

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
            <input type="text" id="cmd-input" class="command-input" placeholder="Enter command (e.g. BTC &lt;GO&gt;, RISK &lt;GO&gt;, FUND &lt;GO&gt;)..." autocomplete="off" spellcheck="false" />
            <button id="btn-go" class="btn-go">&lt;GO&gt;</button>
          </div>
          <div class="quick-commands">
            <button class="cmd-chip active" data-cmd="MARKET">MARKET &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="RISK">RISK &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="FUND">FUND &lt;GO&gt;</button>
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

    // Audio toggle
    audioToggle?.addEventListener("click", () => {
      const muted = toggleMute();
      audioToggle.textContent = muted ? "🔇 SOUND: OFF" : "🔊 SOUND: ON";
      if (!muted) playCommandGo();
    });

    // Command typing sound
    cmdInput?.addEventListener("keydown", (e) => {
      playTerminalKey(e.key);
      if (e.key === "Enter") {
        this.executeCommand(cmdInput.value);
        cmdInput.value = "";
      }
    });

    // Go button
    btnGo?.addEventListener("click", () => {
      this.executeCommand(cmdInput.value);
      cmdInput.value = "";
    });

    // Quick Command Chips
    document.querySelectorAll(".cmd-chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        const cmd = (e.currentTarget as HTMLElement).getAttribute("data-cmd");
        if (cmd) {
          playCommandGo();
          this.executeCommand(`${cmd} <GO>`);
        }
      });
    });

    // Global Keybindings (F1-F8)
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

    // Update chip active states
    document.querySelectorAll(".cmd-chip").forEach((c) => {
      const match = c.getAttribute("data-cmd") === this.activeScreen;
      c.classList.toggle("active", match);
    });

    this.render();
  }

  private startFeeds(): void {
    // 1. WebSocket Binance
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

    // 2. Fetch Initial Funding Rates
    FundingRateCalculator.fetchLiveFundingRates()
      .then((rates) => {
        this.fundingRates = rates;
        if (this.activeScreen === "FUNDING") this.render();
      })
      .catch((e) => console.warn("Funding fetch notice:", e));

    // 3. Fetch Fear & Greed Index
    this.restService
      .fetchFearAndGreed()
      .then((data) => {
        this.fearGreed = data;
        if (this.activeScreen === "MARKET") this.render();
      })
      .catch((e) => console.warn("Fear & Greed notice:", e));

    // Refresh rates every 60s
    setInterval(() => {
      FundingRateCalculator.fetchLiveFundingRates().then(
        (r) => (this.fundingRates = r),
      );
    }, 60000);
  }

  private updateWsStatus(state: BinanceWsState): void {
    const el = document.getElementById("ws-status");
    const txt = document.getElementById("ws-status-text");
    if (!el || !txt) return;

    el.className = `feed-status status-${state.toLowerCase()}`;
    txt.textContent = `BINANCE WS: ${state}`;
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
      items.unshift(`
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
    } else if (this.activeScreen === "RISK") {
      this.renderRiskScreen(body);
    } else if (this.activeScreen === "FUNDING") {
      this.renderFundingScreen(body);
    } else if (this.activeScreen === "PORT") {
      this.renderPortfolioScreen(body);
    } else if (this.activeScreen === "HELP") {
      this.renderHelpScreen(body);
    }
  }

  // ==========================================
  // SCREEN 1: MARKET MATRIX & ORDERFLOW
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
    void priceCell.offsetWidth; // Trigger reflow for animation
    priceCell.classList.add(
      isUp ? "cell-flash-up" : isDown ? "cell-flash-down" : "cell-neutral",
    );

    if (chgCell) {
      chgCell.textContent = `${ticker.priceChangePercent24h >= 0 ? "+" : ""}${ticker.priceChangePercent24h.toFixed(2)}%`;
      chgCell.className = `td-chg ${ticker.priceChangePercent24h >= 0 ? "text-green" : "text-red"}`;
    }
  }

  // ==========================================
  // SCREEN 2: BLACKROCK ALADDIN RISK ENGINE
  // ==========================================
  private renderRiskScreen(container: HTMLElement): void {
    // Sync portfolio prices with live feeds
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

        <!-- Aladdin High-Level Risk Metrics -->
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

        <!-- Stress Testing Scenario Section -->
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

            <!-- Position Stress Impact Table -->
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
  // SCREEN 3: FUNDING HEATMAP & MACRO WIRE
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
  // SCREEN 4: PORTFOLIO HOLDINGS
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
  // SCREEN 5: HELP & GRAMMAR
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
            <span class="help-cmd">RISK &lt;GO&gt; [F3]</span>
            <p>BlackRock Aladdin Parametric Value-at-Risk (VaR 95%), Portfolio Beta to Bitcoin, and Diversification score.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">FUND &lt;GO&gt; [F4]</span>
            <p>Perpetual futures funding rate heatmap, APR/APY compounding, and short-squeeze trigger detector.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">PORT &lt;GO&gt; [F8]</span>
            <p>Portfolio holdings ledger, unrealized PnL tracking, and leverage margins.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">BTC &lt;GO&gt; / ETH &lt;GO&gt;</span>
            <p>Direct symbol lookup and real-time execution monitor.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">HELP &lt;GO&gt; [F1]</span>
            <p>Display this syntax index and institutional architecture guide.</p>
          </div>
        </div>
      </div>
    `;
  }
}

// Launch once DOM is ready
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    new ApexWebTerminal();
  });
}
