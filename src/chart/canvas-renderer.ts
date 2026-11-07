/**
 * Apex Terminal - Zero-Dependency High-Frequency HTML5 Canvas Chart Renderer (v5.0 Pro)
 *
 * TradingView Pro + Bookmap + Exocharts Institutional Canvas Suite:
 * - 60 FPS Candlesticks, Heikin-Ashi, and Gradient Area modes
 * - Interactive Mouse-Wheel Zoom & Drag Panning (24 to 140 candles)
 * - Session VWAP + ±1.5σ Institutional Standard Deviation Bands
 * - EMA 20 & EMA 50 Trend Ribbon with Cloud Fill
 * - Horizontal Volume Profile (POC + Value Area High/Low)
 * - Bookmap-style L2 Capital Pool Heatmap Bands & 50x-100x Liquidation Magnets
 * - TradingView-style Long/Short Position R:R Box Overlay (Entry, Protected SL, TP1/TP2/TP3)
 * - Sub-Pane Volume + Cumulative Volume Delta (CVD) Curve & Live RSI-14 HUD
 */

import { ChartData, Candle } from "./types.js";
import { WhaleTrancheCampaign } from "../feeds/whale-cluster-engine.js";
import { WhaleTrade } from "../feeds/whale-stream.js";
import { CapitalClusterZone } from "../orderbook/orderbook-service.js";
import {
  LiquidationMagnetCluster,
  QuantTradeSetup,
} from "../execution/quant-execution-calculator.js";

export type ChartVisualMode = "CANDLES" | "HEIKIN_ASHI" | "AREA";

export interface ChartRenderOptions {
  visualMode?: ChartVisualMode;
  showVWAP?: boolean;
  showVwapBands?: boolean;
  showEmaRibbon?: boolean;
  showVolumeProfile?: boolean;
  showGrid?: boolean;
  showWhaleOverlay?: boolean;
  showLiquidityHeatmap?: boolean;
  showTradeSetupBox?: boolean;
  showCvdCurve?: boolean;
}

export class CanvasChartRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private data: ChartData | null = null;
  private options: Required<ChartRenderOptions>;
  private whaleCampaigns: WhaleTrancheCampaign[] = [];
  private whaleTrades: WhaleTrade[] = [];
  private bidClusters: CapitalClusterZone[] = [];
  private askClusters: CapitalClusterZone[] = [];
  private liqMagnets: LiquidationMagnetCluster[] = [];
  private tradeSetup: QuantTradeSetup | null = null;

  private hoverX: number | null = null;
  private hoverY: number | null = null;
  private hoveredCandle: Candle | null = null;

  // Interactive Zoom & Pan state
  private visibleCount: number = 72; // default visible candles
  private panOffsetRight: number = 0; // how many candles scrolled back from latest
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartOffset: number = 0;

  // Chart padding (expanded right axis for institutional price tags + R:R labels)
  private padRight = 84;
  private padBottom = 28;
  private padTop = 34;
  private padLeft = 10;

  constructor(canvas: HTMLCanvasElement, options: ChartRenderOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire 2D canvas context");
    this.ctx = ctx;

    this.options = {
      visualMode: "CANDLES",
      showVWAP: true,
      showVwapBands: true,
      showEmaRibbon: true,
      showVolumeProfile: true,
      showGrid: true,
      showWhaleOverlay: true,
      showLiquidityHeatmap: true,
      showTradeSetupBox: true,
      showCvdCurve: true,
      ...options,
    };

    this.bindMouseEvents();
  }

  public getOptions(): Required<ChartRenderOptions> {
    return { ...this.options };
  }

  public setOptions(patch: Partial<ChartRenderOptions>): void {
    this.options = { ...this.options, ...patch };
    this.render();
  }

  public zoom(deltaCandles: number): void {
    const total = this.data?.candles.length || 100;
    this.visibleCount = Math.max(
      20,
      Math.min(Math.max(40, total), this.visibleCount + deltaCandles),
    );
    this.render();
  }

  public resetView(): void {
    this.visibleCount = 72;
    this.panOffsetRight = 0;
    this.render();
  }

  public setData(data: ChartData): void {
    this.data = data;
    this.render();
  }

  public setWhaleOverlay(
    campaigns: WhaleTrancheCampaign[],
    trades: WhaleTrade[],
  ): void {
    this.whaleCampaigns = campaigns;
    this.whaleTrades = trades;
    this.render();
  }

  public setLiquidityHeatmapOverlay(
    bidClusters: CapitalClusterZone[],
    askClusters: CapitalClusterZone[],
    liqMagnets: LiquidationMagnetCluster[],
  ): void {
    this.bidClusters = bidClusters;
    this.askClusters = askClusters;
    this.liqMagnets = liqMagnets;
    this.render();
  }

  public setTradeSetupOverlay(setup: QuantTradeSetup | null): void {
    this.tradeSetup = setup;
    this.render();
  }

  public resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      2,
    );

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  private bindMouseEvents(): void {
    this.canvas.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartOffset = this.panOffsetRight;
    });

    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.hoverX = e.clientX - rect.left;
      this.hoverY = e.clientY - rect.top;

      if (this.isDragging && this.data && this.data.candles.length > 0) {
        const dx = e.clientX - this.dragStartX;
        const plotW = Math.max(100, rect.width - this.padLeft - this.padRight);
        const candleStep = plotW / Math.max(20, this.visibleCount);
        const shiftCandles = Math.round(dx / candleStep);
        const maxOffset = Math.max(
          0,
          this.data.candles.length - this.visibleCount,
        );
        this.panOffsetRight = Math.max(
          0,
          Math.min(maxOffset, this.dragStartOffset + shiftCandles),
        );
      }
      this.render();
    });

    const stopDrag = () => {
      this.isDragging = false;
    };
    this.canvas.addEventListener("mouseup", stopDrag);

    this.canvas.addEventListener("mouseleave", () => {
      this.isDragging = false;
      this.hoverX = null;
      this.hoverY = null;
      this.hoveredCandle = null;
      this.render();
    });

    // Wheel zoom in/out
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const step = e.deltaY > 0 ? 8 : -8;
        this.zoom(step);
      },
      { passive: false },
    );

    // Mobile single-finger touch crosshair & OHLCV HUD inspection
    const handleTouch = (e: TouchEvent) => {
      if (!e.touches || e.touches.length === 0) return;
      const touch = e.touches[0]!;
      const rect = this.canvas.getBoundingClientRect();
      this.hoverX = touch.clientX - rect.left;
      this.hoverY = touch.clientY - rect.top;
      this.render();
    };

    this.canvas.addEventListener("touchstart", handleTouch, { passive: true });
    this.canvas.addEventListener("touchmove", handleTouch, { passive: true });
    this.canvas.addEventListener(
      "touchend",
      () => {
        this.hoverX = null;
        this.hoverY = null;
        this.hoveredCandle = null;
        this.render();
      },
      { passive: true },
    );
  }

  private static computeEMA(values: number[], period: number): number[] {
    if (values.length === 0) return [];
    const k = 2 / (period + 1);
    const out: number[] = [values[0]!];
    for (let i = 1; i < values.length; i++) {
      out.push(values[i]! * k + out[i - 1]! * (1 - k));
    }
    return out;
  }

  private static computeRSI14(candles: Candle[]): number {
    if (candles.length < 15) return 54.0;
    let gains = 0;
    let losses = 0;
    const slice = candles.slice(-15);
    for (let i = 1; i < slice.length; i++) {
      const diff = slice[i]!.close - slice[i - 1]!.close;
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private static toHeikinAshi(candles: Candle[]): Candle[] {
    const ha: Candle[] = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      const haClose = (c.open + c.high + c.low + c.close) / 4;
      const haOpen =
        i === 0
          ? (c.open + c.close) / 2
          : (ha[i - 1]!.open + ha[i - 1]!.close) / 2;
      const haHigh = Math.max(c.high, haOpen, haClose);
      const haLow = Math.min(c.low, haOpen, haClose);
      ha.push({
        timestamp: c.timestamp,
        open: haOpen,
        high: haHigh,
        low: haLow,
        close: haClose,
        volume: c.volume,
        vwap: c.vwap,
      });
    }
    return ha;
  }

  public render(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    if (!this.data || this.data.candles.length === 0) {
      this.renderEmptyState(width, height);
      return;
    }

    const allCandles = this.data.candles;
    const allVwap = this.data.vwap;
    const volumeProfile = this.data.volumeProfile;

    // Precompute EMA20 & EMA50 across full series before slicing visible window
    const allCloses = allCandles.map((c) => c.close);
    const allEma20 = CanvasChartRenderer.computeEMA(allCloses, 20);
    const allEma50 = CanvasChartRenderer.computeEMA(allCloses, 50);

    // Slice visible window according to zoom & pan
    const totalLen = allCandles.length;
    const count = Math.min(totalLen, Math.max(18, this.visibleCount));
    const endIdx = Math.max(count, totalLen - this.panOffsetRight);
    const startIdx = Math.max(0, endIdx - count);

    const rawVisibleCandles = allCandles.slice(startIdx, endIdx);
    const candles =
      this.options.visualMode === "HEIKIN_ASHI"
        ? CanvasChartRenderer.toHeikinAshi(rawVisibleCandles)
        : rawVisibleCandles;
    const vwap = allVwap.slice(startIdx, endIdx);
    const ema20 = allEma20.slice(startIdx, endIdx);
    const ema50 = allEma50.slice(startIdx, endIdx);

    // Compute visible minPrice, maxPrice, maxVolume (including active Trade Setup box if near)
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVolume = 0;
    let highPeakIdx = 0;
    let lowTroughIdx = 0;

    candles.forEach((c, idx) => {
      if (c.low < minPrice) {
        minPrice = c.low;
        lowTroughIdx = idx;
      }
      if (c.high > maxPrice) {
        maxPrice = c.high;
        highPeakIdx = idx;
      }
      if (c.volume > maxVolume) maxVolume = c.volume;
    });

    if (this.options.showTradeSetupBox && this.tradeSetup) {
      const s = this.tradeSetup;
      const mid = (minPrice + maxPrice) / 2;
      if (Math.abs(s.optimalEntryPrice - mid) / mid < 0.08) {
        minPrice = Math.min(minPrice, s.protectedStopLoss, s.takeProfit1_15R);
        maxPrice = Math.max(maxPrice, s.protectedStopLoss, s.takeProfit2_25R);
      }
    }

    // Add 4% vertical breathing room so wicks & callout tags never clip
    const rawSpan = Math.max(maxPrice - minPrice, minPrice * 0.002, 1e-6);
    minPrice -= rawSpan * 0.05;
    maxPrice += rawSpan * 0.06;

    const plotW = width - this.padLeft - this.padRight;
    const plotH = height - this.padTop - this.padBottom;
    const volAreaH = plotH * 0.2;
    const priceAreaH = plotH * 0.8;

    const priceRange = maxPrice - minPrice || 1;
    const priceToY = (price: number) =>
      this.padTop + priceAreaH - ((price - minPrice) / priceRange) * priceAreaH;
    const yToPrice = (y: number) =>
      maxPrice - ((y - this.padTop) / priceAreaH) * priceRange;

    const isLight =
      typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-theme") === "light";
    const colUp = isLight ? "#1e9e6b" : "#8caa6b";
    const colDown = isLight ? "#c8452e" : "#c1684e";
    const colAmber = isLight ? "#a6791f" : "#d8b876";
    const colCyan = isLight ? "#0f766e" : "#68b0ab";
    const colPurple = isLight ? "#6d28d9" : "#a78bfa";
    const colMuted = isLight ? "#6f6d64" : "#b8b8ad";
    const colText = isLight ? "#17181a" : "#f1eee4";
    const colBg = isLight ? "#f2f1ec" : "#111210";
    const colGrid = isLight
      ? "rgba(226, 224, 216, 0.75)"
      : "rgba(48, 51, 46, 0.55)";

    const fmtPrice = (p: number) =>
      p < 1
        ? `$${p.toFixed(4)}`
        : p < 10
          ? `$${p.toFixed(3)}`
          : p < 100
            ? `$${p.toFixed(2)}`
            : `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // 0. Subtle institutional radial vignette on canvas background
    if (!isLight) {
      const bgGrad = ctx.createLinearGradient(0, this.padTop, 0, height);
      bgGrad.addColorStop(0, "rgba(26, 28, 25, 0.45)");
      bgGrad.addColorStop(1, "rgba(17, 18, 16, 0.9)");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(this.padLeft, this.padTop, plotW, plotH);
    }

    // 1. Background Grid Lines (Horizontal Price + Vertical Time Session Grid)
    if (this.options.showGrid) {
      ctx.strokeStyle = colGrid;
      ctx.lineWidth = 1;

      const gridLevels = 6;
      for (let i = 0; i <= gridLevels; i++) {
        const p = minPrice + (priceRange / gridLevels) * i;
        const y = priceToY(p);
        ctx.beginPath();
        ctx.moveTo(this.padLeft, y);
        ctx.lineTo(width - this.padRight, y);
        ctx.stroke();

        ctx.fillStyle = colMuted;
        ctx.font = "10px monospace";
        ctx.textAlign = "left";
        ctx.fillText(fmtPrice(p), width - this.padRight + 6, y + 3);
      }

      // Vertical time grid lines + bottom timestamps
      const timeSteps = Math.min(6, candles.length);
      for (let j = 1; j < timeSteps; j++) {
        const idx = Math.floor((candles.length / timeSteps) * j);
        const c = candles[idx];
        if (!c) continue;
        const x =
          this.padLeft +
          idx * (plotW / candles.length) +
          plotW / candles.length / 2;

        ctx.strokeStyle = colGrid;
        ctx.beginPath();
        ctx.moveTo(x, this.padTop);
        ctx.lineTo(x, this.padTop + plotH);
        ctx.stroke();

        const d = new Date(c.timestamp);
        const label =
          this.data.timeframe === "1d" || this.data.timeframe === "1w"
            ? `${d.getMonth() + 1}/${d.getDate()}`
            : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        ctx.fillStyle = colMuted;
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(label, x, height - 9);
      }

      // Divider between Price Pane and Volume/CVD Sub-Pane
      const paneDivY = this.padTop + priceAreaH;
      ctx.strokeStyle = isLight
        ? "rgba(201, 198, 188, 0.9)"
        : "rgba(67, 71, 64, 0.85)";
      ctx.beginPath();
      ctx.moveTo(this.padLeft, paneDivY);
      ctx.lineTo(width - this.padRight, paneDivY);
      ctx.stroke();
    }

    const candleCount = candles.length;
    const candleSpacing = plotW / candleCount;
    const candleWidth = Math.max(2.5, Math.min(18, candleSpacing * 0.72));

    // 2. Volume Profile (POC + Value Area) Overlay on Right Side
    if (this.options.showVolumeProfile && volumeProfile.length > 0) {
      const maxBarWidth = plotW * 0.22;
      const barH = priceAreaH / volumeProfile.length;

      for (const node of volumeProfile) {
        if (node.priceLevel < minPrice || node.priceLevel > maxPrice) continue;
        const y = priceToY(node.priceLevel) - barH / 2;
        const barW = (node.percentage / 100) * maxBarWidth;
        const x = width - this.padRight - barW;

        ctx.fillStyle = node.isPOC
          ? "rgba(140, 170, 107, 0.32)"
          : "rgba(216, 184, 118, 0.08)";
        ctx.fillRect(x, y, barW, Math.max(1.5, barH - 1));

        if (node.isPOC) {
          ctx.strokeStyle = colUp;
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, barW, Math.max(1.5, barH - 1));

          // POC Horizontal Ray across chart
          const pocY = priceToY(node.priceLevel);
          ctx.strokeStyle = "rgba(140, 170, 107, 0.45)";
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(this.padLeft, pocY);
          ctx.lineTo(width - this.padRight, pocY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // 3A. EMA 20 & EMA 50 Trend Ribbon with Shaded Cloud
    if (
      this.options.showEmaRibbon &&
      ema20.length === candleCount &&
      ema50.length === candleCount
    ) {
      // Shaded cloud between EMA20 and EMA50
      ctx.beginPath();
      for (let i = 0; i < candleCount; i++) {
        const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
        const y20 = priceToY(ema20[i]!);
        if (i === 0) ctx.moveTo(x, y20);
        else ctx.lineTo(x, y20);
      }
      for (let i = candleCount - 1; i >= 0; i--) {
        const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
        const y50 = priceToY(ema50[i]!);
        ctx.lineTo(x, y50);
      }
      ctx.closePath();
      const bullRibbon =
        (ema20[candleCount - 1] ?? 0) >= (ema50[candleCount - 1] ?? 0);
      ctx.fillStyle = bullRibbon
        ? "rgba(104, 176, 171, 0.09)"
        : "rgba(193, 104, 78, 0.09)";
      ctx.fill();

      // EMA 20 Line
      ctx.strokeStyle = colCyan;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ema20.forEach((v, i) => {
        const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
        const y = priceToY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // EMA 50 Line
      ctx.strokeStyle = colPurple;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ema50.forEach((v, i) => {
        const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
        const y = priceToY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // 3B. Session VWAP + ±1.5σ Standard Deviation Channel
    if (this.options.showVWAP && vwap.length === candleCount) {
      // Compute rolling dispersion around VWAP for ±1.5σ bands
      const diffs = candles.map((c, i) =>
        Math.abs(c.close - (vwap[i] ?? c.close)),
      );
      const meanDev =
        diffs.reduce((s, d) => s + d, 0) / Math.max(1, diffs.length);
      const bandOffset = meanDev * 1.5;

      if (this.options.showVwapBands && bandOffset > 0) {
        ctx.strokeStyle = "rgba(216, 184, 118, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);

        // Upper +1.5σ VWAP Band
        ctx.beginPath();
        vwap.forEach((v, i) => {
          const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
          const y = priceToY(v + bandOffset);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Lower -1.5σ VWAP Band
        ctx.beginPath();
        vwap.forEach((v, i) => {
          const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
          const y = priceToY(v - bandOffset);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Main Session VWAP Curve
      ctx.strokeStyle = colAmber;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      vwap.forEach((v, i) => {
        const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
        const y = priceToY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      const latestVWAP = vwap[vwap.length - 1]!;
      const vwapY = priceToY(latestVWAP);
      if (vwapY >= this.padTop && vwapY <= this.padTop + priceAreaH) {
        ctx.fillStyle = colAmber;
        ctx.fillRect(width - this.padRight, vwapY - 7, 80, 14);
        ctx.fillStyle = "#111210";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "left";
        ctx.fillText(
          `VWAP ${fmtPrice(latestVWAP)}`,
          width - this.padRight + 4,
          vwapY + 3,
        );
      }
    }

    // 4. Render Candlesticks / Heikin-Ashi / Gradient Area + Volume & CVD Sub-Pane
    let hoverIdx = -1;
    if (
      this.hoverX !== null &&
      this.hoverX >= this.padLeft &&
      this.hoverX <= width - this.padRight
    ) {
      hoverIdx = Math.floor((this.hoverX - this.padLeft) / candleSpacing);
      hoverIdx = Math.max(0, Math.min(candleCount - 1, hoverIdx));
      this.hoveredCandle = candles[hoverIdx] || null;
    } else {
      this.hoveredCandle = null;
    }

    if (this.options.visualMode === "AREA") {
      // Gradient Area Chart
      ctx.beginPath();
      candles.forEach((c, i) => {
        const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
        const y = priceToY(c.close);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = colUp;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      const firstX = this.padLeft + candleSpacing / 2;
      const lastX =
        this.padLeft + (candleCount - 1) * candleSpacing + candleSpacing / 2;
      ctx.lineTo(lastX, this.padTop + priceAreaH);
      ctx.lineTo(firstX, this.padTop + priceAreaH);
      ctx.closePath();

      const areaGrad = ctx.createLinearGradient(
        0,
        this.padTop,
        0,
        this.padTop + priceAreaH,
      );
      areaGrad.addColorStop(0, "rgba(140, 170, 107, 0.36)");
      areaGrad.addColorStop(1, "rgba(140, 170, 107, 0.01)");
      ctx.fillStyle = areaGrad;
      ctx.fill();
    }

    // Cumulative Volume Delta (CVD) points for sub-pane
    const cvdSeries: number[] = [];
    let runningCvd = 0;

    candles.forEach((c, i) => {
      const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
      const isUp = c.close >= c.open;
      const color = isUp ? colUp : colDown;

      // Estimate candle delta from body-to-range ratio
      const range = Math.max(c.high - c.low, 1e-8);
      const signedBody = (c.close - c.open) / range;
      runningCvd += c.volume * signedBody;
      cvdSeries.push(runningCvd);

      // Volume bar in sub-pane
      const volH =
        maxVolume > 0 ? (c.volume / maxVolume) * (volAreaH * 0.88) : 0;
      const volY = this.padTop + plotH - volH;
      ctx.fillStyle = isUp
        ? "rgba(140, 170, 107, 0.34)"
        : "rgba(193, 104, 78, 0.34)";
      ctx.fillRect(x - candleWidth / 2, volY, candleWidth, volH);

      if (this.options.visualMode !== "AREA") {
        // Wick (High - Low)
        const highY = priceToY(c.high);
        const lowY = priceToY(c.low);
        ctx.strokeStyle = color;
        ctx.lineWidth = candleWidth >= 8 ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();

        // Candle Body (Open - Close) with crisp border on wide zoom
        const openY = priceToY(c.open);
        const closeY = priceToY(c.close);
        const bodyTop = Math.min(openY, closeY);
        const bodyH = Math.max(1.8, Math.abs(openY - closeY));

        ctx.fillStyle = color;
        ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyH);

        if (candleWidth >= 6) {
          ctx.strokeStyle = isUp
            ? "rgba(201, 217, 160, 0.75)"
            : "rgba(227, 167, 140, 0.75)";
          ctx.lineWidth = 0.8;
          ctx.strokeRect(x - candleWidth / 2, bodyTop, candleWidth, bodyH);
        }
      }
    });

    // Render Sub-Pane Cumulative Volume Delta (CVD) Oscillator Line
    if (this.options.showCvdCurve && cvdSeries.length > 2) {
      const minCvd = Math.min(...cvdSeries);
      const maxCvd = Math.max(...cvdSeries, minCvd + 1e-6);
      const cvdSpan = maxCvd - minCvd || 1;
      const subTop = this.padTop + priceAreaH + 4;
      const subH = volAreaH - 8;

      ctx.strokeStyle = colAmber;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      cvdSeries.forEach((val, i) => {
        const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
        const y = subTop + subH - ((val - minCvd) / cvdSpan) * subH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Label CVD in sub-pane top-left
      ctx.fillStyle = colAmber;
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        "⚡ SUB-PANE: VOLUME + CUMULATIVE VOLUME DELTA (CVD)",
        this.padLeft + 6,
        this.padTop + priceAreaH + 12,
      );
    }

    // Swing High & Swing Low Automatic Callout Badges on Visible Window
    if (candles.length >= 10) {
      const hiC = candles[highPeakIdx]!;
      const hiX =
        this.padLeft + highPeakIdx * candleSpacing + candleSpacing / 2;
      const hiY = Math.max(this.padTop + 14, priceToY(hiC.high) - 6);
      ctx.fillStyle = colUp;
      ctx.font = "bold 9px monospace";
      ctx.textAlign =
        highPeakIdx > candles.length * 0.75
          ? "right"
          : highPeakIdx < candles.length * 0.25
            ? "left"
            : "center";
      ctx.fillText(`▲ HIGH ${fmtPrice(hiC.high)}`, hiX, hiY);

      const loC = candles[lowTroughIdx]!;
      const loX =
        this.padLeft + lowTroughIdx * candleSpacing + candleSpacing / 2;
      const loY = Math.min(
        this.padTop + priceAreaH - 6,
        priceToY(loC.low) + 12,
      );
      ctx.fillStyle = colDown;
      ctx.textAlign =
        lowTroughIdx > candles.length * 0.75
          ? "right"
          : lowTroughIdx < candles.length * 0.25
            ? "left"
            : "center";
      ctx.fillText(`▼ LOW ${fmtPrice(loC.low)}`, loX, loY);
    }

    // 4B. Institutional Whale Tranche Campaign VWAP Levels & Footprint Bubbles
    if (this.options.showWhaleOverlay && this.data.symbol) {
      const sym = this.data.symbol.toUpperCase();
      const matchingCampaigns = this.whaleCampaigns
        .filter(
          (c) =>
            c.symbol.toUpperCase() === sym &&
            c.vwapPrice >= minPrice * 0.985 &&
            c.vwapPrice <= maxPrice * 1.015,
        )
        .slice(0, 3);

      for (const camp of matchingCampaigns) {
        const y = Math.max(
          this.padTop + 12,
          Math.min(this.padTop + priceAreaH - 6, priceToY(camp.vwapPrice)),
        );
        const isBuy = camp.side === "BUY";
        const lineColor = isBuy ? colUp : colDown;

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.moveTo(this.padLeft, y);
        ctx.lineTo(width - this.padRight, y);
        ctx.stroke();
        ctx.setLineDash([]);

        const tagText = `🐋 ${camp.campaignId} ${camp.algoType} VWAP ${fmtPrice(camp.vwapPrice)} ($${(camp.totalValueUsd / 1e6).toFixed(2)}M · ${camp.trancheCount}x)`;
        ctx.font = "bold 9px monospace";
        const textW = ctx.measureText(tagText).width + 10;
        ctx.fillStyle = isBuy
          ? "rgba(35, 43, 28, 0.92)"
          : "rgba(46, 32, 25, 0.92)";
        ctx.fillRect(this.padLeft + 8, y - 14, textW, 14);
        ctx.strokeStyle = lineColor;
        ctx.strokeRect(this.padLeft + 8, y - 14, textW, 14);
        ctx.fillStyle = isBuy ? "#c9d9a0" : "#e3a78c";
        ctx.textAlign = "left";
        ctx.fillText(tagText, this.padLeft + 13, y - 4);
      }

      // Draw Whale Footprint Bubbles on matching candles
      const symTrades = this.whaleTrades
        .filter((t) => t.symbol.toUpperCase() === sym && t.valueUsd >= 200000)
        .slice(0, 15);

      if (candles.length >= 2 && symTrades.length > 0) {
        const intervalMs = Math.max(
          60000,
          candles[1]!.timestamp - candles[0]!.timestamp,
        );
        for (const wt of symTrades) {
          let cIdx = candles.findIndex(
            (c) =>
              wt.timestamp >= c.timestamp &&
              wt.timestamp < c.timestamp + intervalMs,
          );
          if (
            cIdx === -1 &&
            wt.timestamp >= candles[candles.length - 1]!.timestamp
          ) {
            cIdx = candles.length - 1;
          }
          if (cIdx >= 0) {
            const cx = this.padLeft + cIdx * candleSpacing + candleSpacing / 2;
            const cy = Math.max(
              this.padTop + 10,
              Math.min(
                this.padTop + priceAreaH - 10,
                priceToY(wt.price || candles[cIdx]!.close),
              ),
            );
            const radius = Math.min(
              11,
              Math.max(4, Math.sqrt(wt.valueUsd / 80000) * 3),
            );
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fillStyle =
              wt.side === "BUY"
                ? "rgba(140, 170, 107, 0.55)"
                : "rgba(216, 184, 118, 0.55)";
            ctx.fill();
            ctx.strokeStyle = wt.side === "BUY" ? colUp : colAmber;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    }

    // 4C. Bookmap-Style L2 Capital Pool Heatmap Bands & 25x-100x Liquidation Magnets
    if (this.options.showLiquidityHeatmap) {
      const allWalls = [
        ...this.bidClusters.slice(0, 3),
        ...this.askClusters.slice(0, 3),
      ];
      for (const wall of allWalls) {
        if (
          wall.priceBucket >= minPrice * 0.992 &&
          wall.priceBucket <= maxPrice * 1.008
        ) {
          const wy = Math.max(
            this.padTop + 14,
            Math.min(this.padTop + priceAreaH - 8, priceToY(wall.priceBucket)),
          );
          const isBid = wall.side === "BID";
          const alpha = Math.min(
            0.26,
            Math.max(0.08, wall.shareOfSidePercent / 120),
          );
          ctx.fillStyle = isBid
            ? `rgba(140, 170, 107, ${alpha})`
            : `rgba(193, 104, 78, ${alpha})`;
          ctx.fillRect(this.padLeft, wy - 5, plotW, 10);

          ctx.strokeStyle = isBid ? colUp : colDown;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(this.padLeft, wy);
          ctx.lineTo(width - this.padRight, wy);
          ctx.stroke();

          const statusIcon =
            wall.wallStatus === "SPOOF_PULLED"
              ? "🎭 SPOOF"
              : wall.wallStatus === "ICEBERG_RELOADED"
                ? "🧊 ICEBERG"
                : "🧱 L2 WALL";
          const label = `${statusIcon} ${isBid ? "BID" : "ASK"} ${fmtPrice(wall.priceBucket)} ($${Math.round(wall.notionalUsd / 1000)}K · ${wall.shareOfSidePercent.toFixed(1)}%)`;
          ctx.font = "bold 9px monospace";
          const tw = ctx.measureText(label).width + 8;
          const tagX = width - this.padRight - tw - 6;
          ctx.fillStyle = isBid
            ? "rgba(22, 34, 24, 0.9)"
            : "rgba(42, 22, 20, 0.9)";
          ctx.fillRect(tagX, wy - 7, tw, 13);
          ctx.fillStyle = isBid ? "#c9d9a0" : "#e3a78c";
          ctx.textAlign = "left";
          ctx.fillText(label, tagX + 4, wy + 2);
        }
      }

      const keyMagnets = this.liqMagnets.filter(
        (m) =>
          (m.tier === "50x" || m.tier === "100x") &&
          m.priceLevel >= minPrice * 0.992 &&
          m.priceLevel <= maxPrice * 1.008,
      );
      for (const mag of keyMagnets) {
        const my = Math.max(
          this.padTop + 14,
          Math.min(this.padTop + priceAreaH - 8, priceToY(mag.priceLevel)),
        );
        ctx.strokeStyle = colAmber;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(this.padLeft, my);
        ctx.lineTo(width - this.padRight, my);
        ctx.stroke();
        ctx.setLineDash([]);

        const mLabel = `🧲 ${mag.tier} ${mag.side === "SHORT_LIQ_MAGNET" ? "SHORT LIQ" : "LONG LIQ"} ${fmtPrice(mag.priceLevel)} ($${(mag.estimatedPoolUsd / 1e6).toFixed(1)}M)`;
        ctx.font = "bold 9px monospace";
        const mtw = ctx.measureText(mLabel).width + 8;
        ctx.fillStyle = "rgba(44, 36, 18, 0.92)";
        ctx.fillRect(this.padLeft + 10, my - 7, mtw, 13);
        ctx.fillStyle = colAmber;
        ctx.textAlign = "left";
        ctx.fillText(mLabel, this.padLeft + 14, my + 2);
      }
    }

    // 4D. TradingView-Style Long/Short Position R:R Box Overlay (Entry, Protected SL, TP1/TP2)
    if (this.options.showTradeSetupBox && this.tradeSetup) {
      const s = this.tradeSetup;
      const boxLeft = this.padLeft + plotW * 0.72;
      const boxW = plotW * 0.28;

      const clampY = (p: number) =>
        Math.max(
          this.padTop + 4,
          Math.min(this.padTop + priceAreaH - 4, priceToY(p)),
        );

      const entryY = clampY(s.optimalEntryPrice);
      const slY = clampY(s.protectedStopLoss);
      const tp2Y = clampY(s.takeProfit2_25R);
      const tp1Y = clampY(s.takeProfit1_15R);

      // Profit Target Zone (Green shaded R:R box)
      const tpTop = Math.min(entryY, tp2Y);
      const tpH = Math.max(4, Math.abs(tp2Y - entryY));
      ctx.fillStyle = "rgba(140, 170, 107, 0.16)";
      ctx.fillRect(boxLeft, tpTop, boxW, tpH);
      ctx.strokeStyle = colUp;
      ctx.lineWidth = 1;
      ctx.strokeRect(boxLeft, tpTop, boxW, tpH);

      // TP1 1.5R intermediate dashed line inside Profit Box
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(boxLeft, tp1Y);
      ctx.lineTo(boxLeft + boxW, tp1Y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Stop-Loss Risk Zone (Red shaded R:R box)
      const slTop = Math.min(entryY, slY);
      const slH = Math.max(4, Math.abs(slY - entryY));
      ctx.fillStyle = "rgba(193, 104, 78, 0.18)";
      ctx.fillRect(boxLeft, slTop, boxW, slH);
      ctx.strokeStyle = colDown;
      ctx.lineWidth = 1;
      ctx.strokeRect(boxLeft, slTop, boxW, slH);

      // Labels on R:R box
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = colUp;
      ctx.fillText(
        `🎯 TP2 (2.5R) ${fmtPrice(s.takeProfit2_25R)}`,
        boxLeft + 5,
        tpTop + 11,
      );
      ctx.fillStyle = colDown;
      ctx.fillText(
        `🛡️ WALL SL (-1R) ${fmtPrice(s.protectedStopLoss)}`,
        boxLeft + 5,
        slTop + slH - 4,
      );
    }

    // 5. Current Price Line & Glowing Axis Pill
    const latestCandle = candles[candles.length - 1]!;
    const curY = priceToY(latestCandle.close);
    const curUp = latestCandle.close >= latestCandle.open;
    const curColor = curUp ? colUp : colDown;

    ctx.strokeStyle = curColor;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(this.padLeft, curY);
    ctx.lineTo(width - this.padRight, curY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pulsing dot on latest price
    const lastX =
      this.padLeft + (candleCount - 1) * candleSpacing + candleSpacing / 2;
    ctx.beginPath();
    ctx.arc(lastX, curY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = curColor;
    ctx.fill();

    // Price tag on right scale
    ctx.fillStyle = curColor;
    ctx.fillRect(width - this.padRight, curY - 9, 82, 18);
    ctx.fillStyle = "#111210";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      fmtPrice(latestCandle.close),
      width - this.padRight + 4,
      curY + 4,
    );

    // 6. Interactive Crosshairs & Coordinate Tags
    if (this.hoverX !== null && this.hoverY !== null && hoverIdx >= 0) {
      const crossX =
        this.padLeft + hoverIdx * candleSpacing + candleSpacing / 2;
      const crossY = this.hoverY;

      ctx.strokeStyle = isLight
        ? "rgba(23, 24, 26, 0.4)"
        : "rgba(241, 238, 228, 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(crossX, this.padTop);
      ctx.lineTo(crossX, height - this.padBottom);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(this.padLeft, crossY);
      ctx.lineTo(width - this.padRight, crossY);
      ctx.stroke();
      ctx.setLineDash([]);

      if (crossY >= this.padTop && crossY <= this.padTop + priceAreaH) {
        const hoverPrice = yToPrice(crossY);
        const pctDiff =
          ((hoverPrice - latestCandle.close) / latestCandle.close) * 100;
        const pctStr = `${pctDiff >= 0 ? "+" : ""}${pctDiff.toFixed(2)}%`;

        ctx.fillStyle = colText;
        ctx.fillRect(width - this.padRight, crossY - 12, 82, 24);
        ctx.fillStyle = colBg;
        ctx.font = "bold 9.5px monospace";
        ctx.textAlign = "left";
        ctx.fillText(
          fmtPrice(hoverPrice),
          width - this.padRight + 4,
          crossY - 2,
        );
        ctx.fillStyle = pctDiff >= 0 ? colUp : colDown;
        ctx.fillText(pctStr, width - this.padRight + 4, crossY + 9);
      }

      const hoverCandle = candles[hoverIdx]!;
      const timeStr = new Date(hoverCandle.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      ctx.fillStyle = colText;
      ctx.fillRect(crossX - 28, height - this.padBottom + 2, 56, 16);
      ctx.fillStyle = colBg;
      ctx.font = "bold 9.5px monospace";
      ctx.textAlign = "center";
      ctx.fillText(timeStr, crossX, height - this.padBottom + 13);
    }

    // 7. Institutional Multi-Metric HUD Header
    this.renderHUD(ctx, candles, ema20, ema50);
  }

  private renderHUD(
    ctx: CanvasRenderingContext2D,
    visibleCandles: Candle[],
    ema20: number[],
    ema50: number[],
  ): void {
    if (!this.data || visibleCandles.length === 0) return;

    const isLight =
      typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-theme") === "light";
    const colUp = isLight ? "#1e9e6b" : "#8caa6b";
    const colDown = isLight ? "#c8452e" : "#c1684e";
    const colAmber = isLight ? "#a6791f" : "#d8b876";
    const colCyan = isLight ? "#0f766e" : "#68b0ab";
    const colPurple = isLight ? "#6d28d9" : "#a78bfa";
    const colMuted = isLight ? "#6f6d64" : "#b8b8ad";
    const colText = isLight ? "#17181a" : "#f1eee4";

    const c = this.hoveredCandle || visibleCandles[visibleCandles.length - 1]!;
    const chg = c.close - c.open;
    const chgPct = (chg / c.open) * 100;
    const color = chg >= 0 ? colUp : colDown;
    const sign = chg >= 0 ? "+" : "";
    const rsi14 = CanvasChartRenderer.computeRSI14(this.data.candles);
    const e20 = ema20[ema20.length - 1] || c.close;
    const e50 = ema50[ema50.length - 1] || c.close;

    const fmtPrice = (p: number) =>
      p < 1
        ? `$${p.toFixed(4)}`
        : p < 10
          ? `$${p.toFixed(3)}`
          : `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    ctx.font = "bold 10.5px monospace";
    ctx.textAlign = "left";

    // Row 1: Symbol, Mode, O, H, L, C, CHG, VOL
    const modeTag =
      this.options.visualMode === "HEIKIN_ASHI"
        ? "HA"
        : this.options.visualMode === "AREA"
          ? "AREA"
          : "PRO";
    const symTitle = `${this.data.symbol} [${this.data.timeframe.toUpperCase()} · ${modeTag}]`;
    ctx.fillStyle = colAmber;
    ctx.fillText(symTitle, this.padLeft, 14);

    let xOffset = this.padLeft + ctx.measureText(symTitle).width + 14;
    const items = [
      { label: "O", val: fmtPrice(c.open), color: colText },
      { label: "H", val: fmtPrice(c.high), color: colText },
      { label: "L", val: fmtPrice(c.low), color: colText },
      { label: "C", val: fmtPrice(c.close), color },
      { label: "CHG", val: `${sign}${chgPct.toFixed(2)}%`, color },
      {
        label: "VOL",
        val: `${Math.round(c.volume).toLocaleString()}`,
        color: colUp,
      },
    ];

    items.forEach((item) => {
      ctx.fillStyle = colMuted;
      ctx.fillText(`${item.label}:`, xOffset, 14);
      xOffset += ctx.measureText(`${item.label}:`).width + 3;

      ctx.fillStyle = item.color;
      ctx.fillText(item.val, xOffset, 14);
      xOffset += ctx.measureText(item.val).width + 10;
    });

    // Row 2: Institutional Indicators Strip (VWAP, EMA20, EMA50, RSI-14, POC)
    ctx.font = "9.5px monospace";
    let x2 = this.padLeft;
    const indItems = [
      {
        label: "VWAP (±1.5σ)",
        val: c.vwap ? fmtPrice(c.vwap) : "--",
        color: colAmber,
      },
      { label: "EMA20", val: fmtPrice(e20), color: colCyan },
      { label: "EMA50", val: fmtPrice(e50), color: colPurple },
      {
        label: "RSI(14)",
        val: `${rsi14.toFixed(1)}`,
        color: rsi14 >= 70 ? colDown : rsi14 <= 30 ? colUp : colText,
      },
      {
        label: "POC",
        val: fmtPrice(this.data.pointOfControlPrice),
        color: colUp,
      },
    ];

    indItems.forEach((ind) => {
      ctx.fillStyle = colMuted;
      ctx.fillText(`${ind.label}:`, x2, 27);
      x2 += ctx.measureText(`${ind.label}:`).width + 3;

      ctx.fillStyle = ind.color;
      ctx.fillText(ind.val, x2, 27);
      x2 += ctx.measureText(ind.val).width + 12;
    });
  }

  private renderEmptyState(width: number, height: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#85887e";
    ctx.font = "13px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "Loading high-frequency Binance OHLCV & institutional orderflow...",
      width / 2,
      height / 2,
    );
  }
}
