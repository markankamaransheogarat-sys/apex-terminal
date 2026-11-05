/**
 * Bloomberg Terminal ANSI High-Fidelity Renderer
 * Formats financial screens with authentic Bloomberg amber/green palettes,
 * fixed-width columns, progress meters, and status bars.
 */

import {
  MarketTicker,
  FundingRateData,
  GlobalMarketMetrics,
  VaRResult,
  BetaResult,
  DiversificationResult,
  StressTestResult,
  InstitutionalPortfolio,
} from "../types/index.js";

export class AnsiRenderer {
  // ANSI Color codes
  public static readonly RESET = "\x1b[0m";
  public static readonly BOLD = "\x1b[1m";
  public static readonly DIM = "\x1b[2m";
  public static readonly UNDERLINE = "\x1b[4m";

  // Bloomberg Classic Palette
  public static readonly AMBER = "\x1b[38;5;214m";
  public static readonly ORANGE = "\x1b[38;5;208m";
  public static readonly GREEN = "\x1b[38;5;82m";
  public static readonly RED = "\x1b[38;5;196m";
  public static readonly CYAN = "\x1b[38;5;51m";
  public static readonly BLUE = "\x1b[38;5;39m";
  public static readonly WHITE = "\x1b[38;5;255m";
  public static readonly GRAY = "\x1b[38;5;244m";
  public static readonly BG_DARK = "\x1b[48;5;234m";
  public static readonly BG_AMBER = "\x1b[48;5;214m\x1b[38;5;16m";

  public static header(title: string): string {
    const timeStr =
      new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";
    const topBar = `${this.BG_AMBER}${this.BOLD} APEX TERMINAL PRO ${this.RESET} ${this.CYAN}BLACKROCK ALADDIN RISK ENGINE${this.RESET} ${this.GRAY}|${this.RESET} ${this.WHITE}${timeStr}${this.RESET}\n`;
    const banner = `${this.AMBER}${this.BOLD}═══ [ ${title.toUpperCase()} ] ${"═".repeat(Math.max(0, 68 - title.length))}${this.RESET}\n`;
    return topBar + banner;
  }

  public static footer(): string {
    return (
      `\n${this.GRAY}${"─".repeat(80)}${this.RESET}\n` +
      `${this.DIM}Hotkeys: [F1] HELP  [F2] BTC  [F3] RISK  [F4] FUND  [F5] NEWS  [F8] PORT | Press <ENTER> to <GO>${this.RESET}\n`
    );
  }

  public static renderProgressBar(
    value: number,
    max: number,
    width = 20,
    color = this.AMBER,
  ): string {
    const ratio = Math.max(0, Math.min(1, value / max));
    const filled = Math.round(ratio * width);
    const empty = width - filled;
    return `${color}[${"█".repeat(filled)}${"░".repeat(empty)}]${this.RESET}`;
  }

  public static formatUsd(amount: number): string {
    return (
      "$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  public static formatPercent(val: number, signed = true): string {
    const sign = signed && val > 0 ? "+" : "";
    const color = val > 0 ? this.GREEN : val < 0 ? this.RED : this.WHITE;
    return `${color}${sign}${val.toFixed(2)}%${this.RESET}`;
  }

  /**
   * Render Single Ticker Detail Screen (<TICKER> <GO>)
   */
  public static renderTickerScreen(ticker: MarketTicker): string {
    let out = this.header(`SECURITY DESCRIPTION: ${ticker.symbol}`);

    const priceColor =
      ticker.priceChangePercent24h >= 0 ? this.GREEN : this.RED;
    const sign = ticker.priceChangePercent24h >= 0 ? "+" : "";

    out += `\n${this.BOLD}${this.WHITE}SECURITY:${this.RESET}  ${this.AMBER}${ticker.symbol}${this.RESET}       `;
    out += `${this.BOLD}SOURCE:${this.RESET}   ${this.CYAN}${ticker.source}${this.RESET}\n`;

    out += `${this.BOLD}${this.WHITE}LAST PRICE:${this.RESET} ${priceColor}${this.BOLD}${this.formatUsd(ticker.price)}${this.RESET}    `;
    out += `${this.BOLD}NET CHG:${this.RESET}  ${priceColor}${sign}${ticker.priceChange24h.toFixed(2)} (${sign}${ticker.priceChangePercent24h.toFixed(2)}%)${this.RESET}\n\n`;

    out += `${this.GRAY}┌────────────────────────────┬────────────────────────────┐${this.RESET}\n`;
    out += `${this.GRAY}│${this.RESET} 24h High:   ${this.WHITE}${this.formatUsd(ticker.high24h).padEnd(14)}${this.RESET} │ 24h Volume:  ${this.WHITE}${ticker.volume24h.toLocaleString().padEnd(12)}${this.RESET} │\n`;
    out += `${this.GRAY}│${this.RESET} 24h Low:    ${this.WHITE}${this.formatUsd(ticker.low24h).padEnd(14)}${this.RESET} │ 24h Quote Vol: ${this.WHITE}${this.formatUsd(ticker.quoteVolume24h).padEnd(10)}${this.RESET} │\n`;

    if (ticker.bidPrice !== undefined && ticker.askPrice !== undefined) {
      const spread = ticker.askPrice - ticker.bidPrice;
      const spreadBps = ticker.price > 0 ? (spread / ticker.price) * 10000 : 0;
      out += `${this.GRAY}│${this.RESET} Bid:        ${this.GREEN}${this.formatUsd(ticker.bidPrice).padEnd(14)}${this.RESET} │ Spread:      ${this.CYAN}${spread.toFixed(2)} (${spreadBps.toFixed(1)} bps)${this.RESET} │\n`;
      out += `${this.GRAY}│${this.RESET} Ask:        ${this.RED}${this.formatUsd(ticker.askPrice).padEnd(14)}${this.RESET} │ Liquidity:   ${this.GREEN}DEEP INSTITUTIONAL${this.RESET} │\n`;
    }

    out += `${this.GRAY}└────────────────────────────┴────────────────────────────┘${this.RESET}\n`;

    out += this.footer();
    return out;
  }

  /**
   * Render Aladdin Risk Engine Matrix (RISK <GO>)
   */
  public static renderRiskScreen(
    var95: VaRResult,
    var99: VaRResult,
    betaResult: BetaResult,
    divResult: DiversificationResult,
  ): string {
    let out = this.header("BLACKROCK ALADDIN RISK ANALYTICS MATRIX");

    // Portfolio Value & VaR Summary
    out += `\n${this.BOLD}${this.WHITE}PORTFOLIO VALUE:${this.RESET} ${this.AMBER}${this.formatUsd(var95.portfolioValueUsd)}${this.RESET}    `;
    out += `${this.BOLD}DAILY VOL:${this.RESET} ${this.CYAN}${(var95.dailyVolatility * 100).toFixed(2)}%${this.RESET}    `;
    out += `${this.BOLD}ANNUAL VOL:${this.RESET} ${this.CYAN}${(var95.annualizedVolatility * 100).toFixed(2)}%${this.RESET}\n\n`;

    // VaR Metrics Box
    out += `${this.AMBER}${this.BOLD}[ PARAMETRIC VALUE-AT-RISK (1-DAY HORIZON) ]${this.RESET}\n`;
    out += `${this.GRAY}┌─────────────────────┬──────────────────┬──────────────────┬──────────────┐${this.RESET}\n`;
    out += `${this.GRAY}│${this.RESET} Confidence Level    ${this.GRAY}│${this.RESET} Z-Score (Normal)  ${this.GRAY}│${this.RESET} VaR (USD)         ${this.GRAY}│${this.RESET} VaR (% NAV)   ${this.GRAY}│${this.RESET}\n`;
    out += `${this.GRAY}├─────────────────────┼──────────────────┼──────────────────┼──────────────┤${this.RESET}\n`;
    out += `${this.GRAY}│${this.RESET} 95.0% Confidence     ${this.GRAY}│${this.RESET} ${var95.zScore.toFixed(4).padEnd(16)} ${this.GRAY}│${this.RESET} ${this.RED}${this.formatUsd(var95.parametricVaRUsd).padEnd(16)}${this.RESET} ${this.GRAY}│${this.RESET} ${this.RED}${var95.parametricVaRPercent.toFixed(2)}%${this.RESET}        ${this.GRAY}│${this.RESET}\n`;
    out += `${this.GRAY}│${this.RESET} 99.0% Confidence     ${this.GRAY}│${this.RESET} ${var99.zScore.toFixed(4).padEnd(16)} ${this.GRAY}│${this.RESET} ${this.RED}${this.formatUsd(var99.parametricVaRUsd).padEnd(16)}${this.RESET} ${this.GRAY}│${this.RESET} ${this.RED}${var99.parametricVaRPercent.toFixed(2)}%${this.RESET}        ${this.GRAY}│${this.RESET}\n`;
    out += `${this.GRAY}└─────────────────────┴──────────────────┴──────────────────┴──────────────┘${this.RESET}\n\n`;

    // Component VaR Table
    out += `${this.AMBER}${this.BOLD}[ COMPONENT VaR DECOMPOSITION (95% 1-DAY) ]${this.RESET}\n`;
    out += `${this.GRAY}┌──────────┬───────────────┬─────────────────┬─────────────────┐${this.RESET}\n`;
    out += `${this.GRAY}│${this.RESET} Asset    ${this.GRAY}│${this.RESET} Marginal VaR  ${this.GRAY}│${this.RESET} Component VaR $  ${this.GRAY}│${this.RESET} Risk Contrib %   ${this.GRAY}│${this.RESET}\n`;
    out += `${this.GRAY}├──────────┼───────────────┼─────────────────┼─────────────────┤${this.RESET}\n`;

    for (const [sym, cVarUsd] of Object.entries(var95.componentVaRUsd)) {
      const mVar = var95.marginalVaR[sym] ?? 0;
      const cVarPct = var95.componentVaRPercent[sym] ?? 0;
      out += `${this.GRAY}│${this.RESET} ${sym.padEnd(8)} ${this.GRAY}│${this.RESET} ${mVar.toFixed(4).padEnd(13)} ${this.GRAY}│${this.RESET} ${this.formatUsd(cVarUsd).padEnd(15)} ${this.GRAY}│${this.RESET} ${cVarPct.toFixed(2)}%${" ".repeat(Math.max(0, 14 - cVarPct.toFixed(2).length))} ${this.GRAY}│${this.RESET}\n`;
    }
    out += `${this.GRAY}└──────────┴───────────────┴─────────────────┴─────────────────┘${this.RESET}\n\n`;

    // Systemic Beta & Diversification
    out += `${this.AMBER}${this.BOLD}[ BENCHMARK SENSITIVITY & DIVERSIFICATION ]${this.RESET}\n`;
    out += `${this.BOLD}BTC Benchmark Beta:${this.RESET}     ${this.CYAN}${betaResult.portfolioBeta.toFixed(3)}${this.RESET} (${this.GREEN}${betaResult.systemicRiskClassification}${this.RESET})\n`;
    out += `${this.BOLD}Diversification Ratio:${this.RESET}  ${this.WHITE}${divResult.diversificationRatio.toFixed(3)}${this.RESET} (Effective Assets: ${divResult.effectiveAssetsN.toFixed(2)})\n`;
    out += `${this.BOLD}Avg Asset Correlation:${this.RESET}  ${this.WHITE}${divResult.averageCorrelation.toFixed(3)}${this.RESET}\n`;

    const divMeter = this.renderProgressBar(
      divResult.score,
      100,
      24,
      divResult.score >= 50 ? this.GREEN : this.ORANGE,
    );
    out += `${this.BOLD}Diversification Score:${this.RESET}  ${divMeter} ${this.BOLD}${divResult.score}/100${this.RESET} [${this.AMBER}${divResult.regime}${this.RESET}]\n`;

    out += this.footer();
    return out;
  }

  /**
   * Render Multi-Scenario Stress Test (STRESS <GO>)
   */
  public static renderStressScreen(results: StressTestResult[]): string {
    let out = this.header("BLACKROCK ALADDIN MULTI-FACTOR STRESS TEST");

    out += `${this.GRAY}┌─────────────────────────────┬──────────────┬──────────────┬──────────────┬──────────────┐${this.RESET}\n`;
    out += `${this.GRAY}│${this.RESET} Stress Scenario              ${this.GRAY}│${this.RESET} Baseline NAV  ${this.GRAY}│${this.RESET} Stressed NAV  ${this.GRAY}│${this.RESET} Drawdown ($/%) ${this.GRAY}│${this.RESET} Health Factor ${this.GRAY}│${this.RESET}\n`;
    out += `${this.GRAY}├─────────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┤${this.RESET}\n`;

    for (const r of results) {
      const name =
        r.scenarioName.length > 27
          ? r.scenarioName.substring(0, 24) + "..."
          : r.scenarioName.padEnd(27);
      const baseNav = this.formatUsd(r.baselinePortfolioValueUsd);
      const stressNav = this.formatUsd(r.stressedPortfolioValueUsd);
      const dd = `${this.RED}-${this.formatUsd(r.totalDrawdownUsd)} (${r.totalDrawdownPercent.toFixed(1)}%)${this.RESET}`;
      const healthColor =
        r.stressedHealthFactor < 1.2
          ? this.RED
          : r.stressedHealthFactor < 2.0
            ? this.ORANGE
            : this.GREEN;
      const healthStr = `${healthColor}${r.stressedHealthFactor.toFixed(2)}${this.RESET}`;

      out += `${this.GRAY}│${this.RESET} ${name} ${this.GRAY}│${this.RESET} ${baseNav.padEnd(12)} ${this.GRAY}│${this.RESET} ${stressNav.padEnd(12)} ${this.GRAY}│${this.RESET} ${dd.padEnd(23)} ${this.GRAY}│${this.RESET} ${healthStr.padEnd(21)} ${this.GRAY}│${this.RESET}\n`;
    }
    out += `${this.GRAY}└─────────────────────────────┴──────────────┴──────────────┴──────────────┴──────────────┘${this.RESET}\n\n`;

    // Liquidation summary
    out += `${this.AMBER}${this.BOLD}[ LIQUIDATION PROXIMITY & SOLVENCY RADAR ]${this.RESET}\n`;
    for (const r of results) {
      const liqCount = r.liquidatedPositions.length;
      if (liqCount > 0) {
        out += `${this.RED}● ${r.scenarioId}:${this.RESET} ${this.BOLD}WARNING!${this.RESET} ${liqCount} position(s) breached liquidation: ${this.RED}${r.liquidatedPositions.join(", ")}${this.RESET}\n`;
      } else {
        out += `${this.GREEN}✓ ${r.scenarioId}:${this.RESET} Solvency intact. Min distance to liquidation: ${this.CYAN}${r.minimumLiquidationDistancePercent.toFixed(1)}%${this.RESET}\n`;
      }
    }

    out += this.footer();
    return out;
  }

  /**
   * Render Perpetual Funding Rate Heatmap (FUND <GO>)
   */
  public static renderFundingScreen(fundingRates: FundingRateData[]): string {
    let out = this.header(
      "BINANCE FUTURES FUNDING RATE HEATMAP & ARBITRAGE RADAR",
    );

    out += `${this.GRAY}┌────────────┬─────────────┬─────────────┬─────────────┬─────────────┬─────────────────────┐${this.RESET}\n`;
    out += `${this.GRAY}│${this.RESET} Symbol     ${this.GRAY}│${this.RESET} Mark Price   ${this.GRAY}│${this.RESET} 8h Funding   ${this.GRAY}│${this.RESET} Ann. APR     ${this.GRAY}│${this.RESET} Ann. APY     ${this.GRAY}│${this.RESET} Sentiment Regime     ${this.GRAY}│${this.RESET}\n`;
    out += `${this.GRAY}├────────────┼─────────────┼─────────────┼─────────────┼─────────────┼─────────────────────┤${this.RESET}\n`;

    for (const item of fundingRates.slice(0, 12)) {
      const sym = item.symbol.padEnd(10);
      const mark = this.formatUsd(item.markPrice).padEnd(11);
      const rateStr = `${(item.fundingRate * 100).toFixed(4)}%`.padEnd(11);
      const aprColor =
        item.annualizedAPR > 0
          ? this.GREEN
          : item.annualizedAPR < 0
            ? this.RED
            : this.WHITE;
      const aprStr =
        `${aprColor}${item.annualizedAPR > 0 ? "+" : ""}${item.annualizedAPR.toFixed(2)}%${this.RESET}`.padEnd(
          20,
        );
      const apyStr = `${item.annualizedAPY.toFixed(2)}%`.padEnd(11);

      let regimeBadge = `${this.WHITE}${item.regime}${this.RESET}`;
      if (item.regime === "EXTREME_BULL")
        regimeBadge = `${this.RED}EXTREME LONG CARRY${this.RESET}`;
      else if (item.regime === "SHORT_SQUEEZE_RISK")
        regimeBadge = `${this.BG_AMBER}SHORT SQUEEZE RISK${this.RESET}`;
      else if (item.regime === "MODERATE_BULL")
        regimeBadge = `${this.GREEN}BULL EXPANSION${this.RESET}`;
      else if (item.regime === "NEUTRAL")
        regimeBadge = `${this.GRAY}BALANCED${this.RESET}`;

      out += `${this.GRAY}│${this.RESET} ${sym} ${this.GRAY}│${this.RESET} ${mark} ${this.GRAY}│${this.RESET} ${rateStr} ${this.GRAY}│${this.RESET} ${aprStr} ${this.GRAY}│${this.RESET} ${apyStr} ${this.GRAY}│${this.RESET} ${regimeBadge.padEnd(28)} ${this.GRAY}│${this.RESET}\n`;
    }

    out += `${this.GRAY}└────────────┴─────────────┴─────────────┴─────────────┴─────────────┴─────────────────────┘${this.RESET}\n`;
    out += this.footer();
    return out;
  }

  /**
   * Render News & Sentiment (NEWS <GO>)
   */
  public static renderNewsScreen(metrics: GlobalMarketMetrics): string {
    let out = this.header(
      "GLOBAL SENTIMENT & ALTERNATIVE.ME FEAR AND GREED INDEX",
    );

    const fng = metrics.fearAndGreed;
    const fngColor =
      fng.value > 60 ? this.GREEN : fng.value < 40 ? this.RED : this.AMBER;
    const meter = this.renderProgressBar(fng.value, 100, 24, fngColor);

    out += `\n${this.BOLD}${this.WHITE}FEAR & GREED INDEX:${this.RESET}  ${meter} ${this.BOLD}${fngColor}${fng.value}/100${this.RESET} [${this.WHITE}${fng.valueClassification}${this.RESET}]\n\n`;

    out += `${this.GRAY}┌────────────────────────────────┬────────────────────────────────┐${this.RESET}\n`;
    out += `${this.GRAY}│${this.RESET} BTC Dominance: ${this.CYAN}${metrics.btcDominance?.toFixed(1) ?? "N/A"}%${this.RESET}${" ".repeat(14)} │ 24h Global Vol: ${this.WHITE}${this.formatUsd((metrics.volume24hUsd ?? 0) / 1e9)}B${this.RESET}${" ".repeat(10)} │\n`;
    out += `${this.GRAY}│${this.RESET} Total Market Cap: ${this.GREEN}${this.formatUsd((metrics.totalMarketCapUsd ?? 0) / 1e12)}T${this.RESET}${" ".repeat(10)} │ Feed Source:    ${this.AMBER}${metrics.source.substring(0, 18)}${this.RESET} │\n`;
    out += `${this.GRAY}└────────────────────────────────┴────────────────────────────────┘${this.RESET}\n\n`;

    out += `${this.AMBER}${this.BOLD}[ INSTITUTIONAL HEADLINES & RADAR ]${this.RESET}\n`;
    out += `${this.CYAN}14:25 UTC${this.RESET} | U.S. Spot ETF Net Inflows reach +$420M over 24-hour cycle.\n`;
    out += `${this.CYAN}13:50 UTC${this.RESET} | Bitcoin CME Futures Open Interest hits record institutional watermark.\n`;
    out += `${this.CYAN}12:10 UTC${this.RESET} | Global liquidity index expands as perpetual basis stabilizes at +9.2% APR.\n`;

    out += this.footer();
    return out;
  }

  /**
   * Render Portfolio View (PORT <GO>)
   */
  public static renderPortfolioScreen(
    portfolio: InstitutionalPortfolio,
  ): string {
    let out = this.header(`PORTFOLIO HOLDINGS: ${portfolio.name}`);

    out += `\n${this.BOLD}${this.WHITE}TOTAL NAV:${this.RESET}     ${this.AMBER}${this.formatUsd(portfolio.totalValueUsd)}${this.RESET}    `;
    out += `${this.BOLD}FREE MARGIN:${this.RESET}   ${this.GREEN}${this.formatUsd(portfolio.freeMarginUsd)}${this.RESET}    `;
    out += `${this.BOLD}HEALTH FACTOR:${this.RESET} ${this.CYAN}${portfolio.healthFactor.toFixed(2)}${this.RESET}\n\n`;

    out += `${this.GRAY}┌──────────┬──────────────┬──────────────┬──────────────┬──────────┬──────────────┐${this.RESET}\n`;
    out += `${this.GRAY}│${this.RESET} Symbol   ${this.GRAY}│${this.RESET} Amount        ${this.GRAY}│${this.RESET} Price (USD)   ${this.GRAY}│${this.RESET} Value (USD)   ${this.GRAY}│${this.RESET} Leverage ${this.GRAY}│${this.RESET} Alloc %       ${this.GRAY}│${this.RESET}\n`;
    out += `${this.GRAY}├──────────┼──────────────┼──────────────┼──────────────┼──────────┼──────────────┤${this.RESET}\n`;

    for (const pos of portfolio.positions) {
      const sym = pos.symbol.padEnd(8);
      const amt = pos.amount.toLocaleString().padEnd(12);
      const prc = this.formatUsd(pos.currentPrice).padEnd(12);
      const val = this.formatUsd(pos.valueUsd).padEnd(12);
      const lev = `${pos.leverage ?? 1}x (${pos.isLong ? "L" : "S"})`.padEnd(8);
      const alloc =
        portfolio.totalValueUsd > 0
          ? (pos.valueUsd / portfolio.totalValueUsd) * 100
          : 0;
      const allocStr = `${alloc.toFixed(1)}%`.padEnd(12);

      out += `${this.GRAY}│${this.RESET} ${sym} ${this.GRAY}│${this.RESET} ${amt} ${this.GRAY}│${this.RESET} ${prc} ${this.GRAY}│${this.RESET} ${val} ${this.GRAY}│${this.RESET} ${lev} ${this.GRAY}│${this.RESET} ${allocStr} ${this.GRAY}│${this.RESET}\n`;
    }

    out += `${this.GRAY}└──────────┴──────────────┴──────────────┴──────────────┴──────────┴──────────────┘${this.RESET}\n`;
    out += this.footer();
    return out;
  }

  /**
   * Render Terminal Help (HELP <GO>)
   */
  public static renderHelpScreen(): string {
    let out = this.header(
      "BLOOMBERG APEX TERMINAL USER MANUAL & COMMAND GRAMMAR",
    );

    out += `\n${this.AMBER}${this.BOLD}[ COMMAND GRAMMAR ]${this.RESET}\n`;
    out += `  ${this.WHITE}<TICKER> <GO>${this.RESET}         Open asset quote overview (e.g. ${this.CYAN}BTC <GO>${this.RESET}, ${this.CYAN}ETH <GO>${this.RESET}, ${this.CYAN}SOL <GO>${this.RESET})\n`;
    out += `  ${this.WHITE}RISK <GO>${this.RESET}             BlackRock Aladdin Parametric VaR, Beta & Diversification\n`;
    out += `  ${this.WHITE}FUND <GO>${this.RESET}             Binance Futures Funding Rate Heatmap & Squeeze Radar\n`;
    out += `  ${this.WHITE}NEWS <GO>${this.RESET}             Fear & Greed Index, sentiment and global telemetry\n`;
    out += `  ${this.WHITE}PORT <GO>${this.RESET}             Institutional portfolio breakdown and margin metrics\n`;
    out += `  ${this.WHITE}STRESS <GO>${this.RESET}           Simulate multi-factor market shocks & liquidation proximity\n`;
    out += `  ${this.WHITE}HELP <GO>${this.RESET}             Display this command syntax guide\n\n`;

    out += `${this.AMBER}${this.BOLD}[ KEYBOARD SHORTCUTS ]${this.RESET}\n`;
    out += `  ${this.GREEN}<ENTER>${this.RESET}               Execute current buffer line (acts as implicit <GO>)\n`;
    out += `  ${this.GREEN}<TAB>${this.RESET}                 Autocomplete command or ticker token\n`;
    out += `  ${this.GREEN}[F1]${this.RESET}                  HELP <GO>\n`;
    out += `  ${this.GREEN}[F2]${this.RESET}                  BTC <GO> (Primary Monitor)\n`;
    out += `  ${this.GREEN}[F3]${this.RESET}                  RISK <GO> (Aladdin Risk Matrix)\n`;
    out += `  ${this.GREEN}[F4]${this.RESET}                  FUND <GO> (Funding Heatmap)\n`;
    out += `  ${this.GREEN}[F5]${this.RESET}                  NEWS <GO> (Global Sentiment)\n`;
    out += `  ${this.GREEN}[F8]${this.RESET}                  PORT <GO> (Portfolio Holdings)\n`;
    out += `  ${this.GREEN}[ESC]${this.RESET}                 Clear active command line\n`;

    out += this.footer();
    return out;
  }
}
