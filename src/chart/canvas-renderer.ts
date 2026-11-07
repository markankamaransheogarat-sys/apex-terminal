/**
 * Apex Terminal - High-Frequency HTML5 Canvas Chart Renderer (TradingView Superchart v6.0)
 * Zero-dependency 60 FPS institutional candlestick, Heikin-Ashi, Hollow & Baseline engine:
 * - 5 Chart Styles: Candles, Hollow Candles, Heikin-Ashi, Mountain Area & Baseline
 * - Interactive Mouse-Wheel Zoom, Click-Drag Pan & Right Y-Axis Drag Scaling
 * - Interactive TradingView Drawing Suite: Price/Time Ruler (📏), Fibonacci Retracement (🌀),
 *   Diagonal Trendlines (📐), and Horizontal Levels (➖) with LocalStorage persistence
 * - Smart Money Concepts (SMC): Auto-detected BOS / CHoCH, Fair Value Gaps (FVG) & Order Blocks (OB)
 * - Session VWAP + ±1.5σ Bands, EMA 20/50 Trend Ribbon & Bollinger Bands (20, 2σ)
 * - TradingView Long/Short Position R:R Box Overlay (Entry, Wall-Protected SL, TP1/TP2)
 * - Bookmap L2 Liquidity Walls & 50x-100x Liquidation Magnet Heatmap
 * - Dedicated Bottom Oscillator Sub-Pane: MACD (12,26,9), RSI (14) + SMA, or CVD Delta
 * - Live Bar-Close Countdown Timer, Watermark & 1-Click PNG Chart Snapshot Export
 */

import {
  Candle,
  ChartData,
  ChartDrawingTool,
  ChartSubPaneMode,
  ChartUserDrawing,
} from "./types.js";
import { WhaleTrade } from "../feeds/whale-stream.js";
import { WhaleTrancheCampaign } from "../feeds/whale-cluster-engine.js";
import { CapitalClusterZone } from "../orderbook/orderbook-service.js";
import {
  LiquidationMagnetCluster,
  QuantTradeSetup,
} from "../execution/quant-execution-calculator.js";

export type ChartVisualMode =
  "CANDLES" | "HOLLOW" | "HEIKIN_ASHI" | "AREA" | "BASELINE";

export interface ChartRenderOptions {
  visualMode?: ChartVisualMode;
  drawingTool?: ChartDrawingTool;
  subPaneMode?: ChartSubPaneMode;
  showVWAP?: boolean;
  showVwapBands?: boolean;
  showEmaRibbon?: boolean;
  showBollingerBands?: boolean;
  showSmcOverlay?: boolean;
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

  // Interactive Crosshair, Pan/Zoom & Y-Axis Scale State
  private mouseX: number = -1;
  private mouseY: number = -1;
  private isHovering: boolean = false;
  private isDragging: boolean = false;
  private isScalingY: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragStartOffset: number = 0;
  private dragStartYScale: number = 1.0;

  // Viewport Window (TradingView-style zoom & pan)
  private visibleCount: number = 78;
  private panOffsetRight: number = 0; // 0 = anchored to latest live candle
  private yScaleFactor: number = 1.0; // 1.0 = auto-fit, >1 = zoomed out Y, <1 = zoomed in Y

  // Interactive Drawing State
  private drawings: ChartUserDrawing[] = [];
  private activeDraftDrawing: ChartUserDrawing | null = null;
  private onToolCompleteCallback: (() => void) | null = null;

  // Institutional Overlays
  private whaleCampaigns: WhaleTrancheCampaign[] = [];
  private whaleTrades: WhaleTrade[] = [];
  private bidClusters: CapitalClusterZone[] = [];
  private askClusters: CapitalClusterZone[] = [];
  private liquidationPools: LiquidationMagnetCluster[] = [];
  private activeTradeSetup: QuantTradeSetup | null = null;

  // Layout Constants
  private readonly padding = {
    top: 52,
    right: 88,
    bottom: 28,
    left: 14,
  };

  // Institutional Color Palette
  private readonly colors = {
    bg: "#070a10",
    bgVignette: "#0d1320",
    grid: "rgba(30, 41, 59, 0.45)",
    text: "#94a3b8",
    textBright: "#f8fafc",
    bull: "#00e676",
    bullBody: "rgba(0, 230, 118, 0.82)",
    bullDim: "rgba(0, 230, 118, 0.16)",
    bear: "#ff1744",
    bearBody: "rgba(255, 23, 68, 0.82)",
    bearDim: "rgba(255, 23, 68, 0.16)",
    vwap: "#38bdf8",
    vwapBandFill: "rgba(56, 189, 248, 0.06)",
    vwapBandLine: "rgba(56, 189, 248, 0.35)",
    ema20: "#a855f7",
    ema50: "#f59e0b",
    poc: "#facc15",
    vpBar: "rgba(56, 189, 248, 0.16)",
    vpPocBar: "rgba(250, 204, 21, 0.42)",
    crosshair: "rgba(148, 163, 184, 0.55)",
    crosshairBg: "#1e293b",
    cvdLine: "#22d3ee",
  };

  constructor(canvas: HTMLCanvasElement, options: ChartRenderOptions = {}) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not initialize 2D context on chart canvas");
    }
    this.ctx = context;

    this.options = {
      visualMode: options.visualMode ?? "CANDLES",
      drawingTool: options.drawingTool ?? "CURSOR",
      subPaneMode: options.subPaneMode ?? "MACD",
      showVWAP: options.showVWAP ?? true,
      showVwapBands: options.showVwapBands ?? true,
      showEmaRibbon: options.showEmaRibbon ?? true,
      showBollingerBands: options.showBollingerBands ?? false,
      showSmcOverlay: options.showSmcOverlay ?? true,
      showVolumeProfile: options.showVolumeProfile ?? true,
      showGrid: options.showGrid ?? true,
      showWhaleOverlay: options.showWhaleOverlay ?? true,
      showLiquidityHeatmap: options.showLiquidityHeatmap ?? true,
      showTradeSetupBox: options.showTradeSetupBox ?? true,
      showCvdCurve: options.showCvdCurve ?? true,
    };

    this.bindEvents();
  }

  public setOptions(options: Partial<ChartRenderOptions>): void {
    this.options = { ...this.options, ...options };
    this.render();
  }

  public getOptions(): Required<ChartRenderOptions> {
    return { ...this.options };
  }

  public setDrawingTool(tool: ChartDrawingTool, onComplete?: () => void): void {
    this.options.drawingTool = tool;
    if (onComplete) this.onToolCompleteCallback = onComplete;
    this.render();
  }

  public getDrawingsCount(): number {
    return this.drawings.length;
  }

  public undoLastDrawing(): void {
    this.drawings.pop();
    this.saveDrawingsToStorage();
    this.render();
  }

  public clearDrawings(): void {
    this.drawings = [];
    this.activeDraftDrawing = null;
    this.saveDrawingsToStorage();
    this.render();
  }

  private getStorageKey(): string {
    return `apex_chart_drawings_${this.data?.symbol ?? "BTCUSDT"}`;
  }

  private loadDrawingsFromStorage(): void {
    if (typeof localStorage === "undefined" || !this.data) return;
    try {
      const raw = localStorage.getItem(this.getStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.drawings = parsed;
        }
      } else {
        this.drawings = [];
      }
    } catch {
      this.drawings = [];
    }
  }

  private saveDrawingsToStorage(): void {
    if (typeof localStorage === "undefined" || !this.data) return;
    try {
      localStorage.setItem(this.getStorageKey(), JSON.stringify(this.drawings));
    } catch {
      // ignore quota errors
    }
  }

  /**
   * Exports current high-DPI canvas chart to a downloadable PNG file
   */
  public exportSnapshotPng(): void {
    if (!this.canvas) return;
    try {
      const dataUrl = this.canvas.toDataURL("image/png");
      const link = document.createElement("a");
      const sym = this.data?.symbol ?? "BTCUSDT";
      const tf = this.data?.timeframe ?? "1h";
      link.download = `APEX-SUPERCHART-${sym}-${tf}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.warn("Chart snapshot export failed:", e);
    }
  }

  private bindEvents(): void {
    // Mouse Move (Crosshair, Pan, Y-Axis Scale, or Drawing Draft)
    this.canvas.addEventListener("mousemove", (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      this.isHovering = true;

      if (this.isScalingY) {
        const dy = this.mouseY - this.dragStartY;
        this.yScaleFactor = Math.max(
          0.35,
          Math.min(2.6, this.dragStartYScale * (1 + dy * 0.005)),
        );
        this.render();
        return;
      }

      if (this.activeDraftDrawing && this.data) {
        const coords = this.screenToChartCoords(this.mouseX, this.mouseY);
        if (coords) {
          this.activeDraftDrawing.endCandleIndex = coords.candleIndex;
          this.activeDraftDrawing.endPrice = coords.price;
        }
        this.render();
        return;
      }

      if (this.isDragging && this.data && this.data.candles.length > 0) {
        const dx = this.mouseX - this.dragStartX;
        const chartW =
          this.canvas.getBoundingClientRect().width -
          this.padding.left -
          this.padding.right;
        const step = chartW / Math.max(10, this.visibleCount);
        const candleDelta = Math.round(dx / step);
        const maxOffset = Math.max(
          0,
          this.data.candles.length - this.visibleCount,
        );
        this.panOffsetRight = Math.max(
          0,
          Math.min(maxOffset, this.dragStartOffset + candleDelta),
        );
      }
      this.render();
    });

    // Mouse Down (Start Pan, Right Y-Axis Scale, or Drawing Tool)
    this.canvas.addEventListener("mousedown", (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking on Right Y-Axis to scale price
      if (x >= rect.width - this.padding.right) {
        this.isScalingY = true;
        this.dragStartY = y;
        this.dragStartYScale = this.yScaleFactor;
        return;
      }

      // Check if an active drawing tool is selected
      const tool = this.options.drawingTool;
      if (tool !== "CURSOR" && this.data) {
        const coords = this.screenToChartCoords(x, y);
        if (coords) {
          if (tool === "HLINE") {
            this.drawings.push({
              id: `d_${Date.now()}`,
              type: "HLINE",
              startCandleIndex: coords.candleIndex,
              startPrice: coords.price,
              endCandleIndex: coords.candleIndex,
              endPrice: coords.price,
            });
            this.saveDrawingsToStorage();
            this.options.drawingTool = "CURSOR";
            if (this.onToolCompleteCallback) this.onToolCompleteCallback();
            this.render();
            return;
          }

          this.activeDraftDrawing = {
            id: `d_${Date.now()}`,
            type: tool,
            startCandleIndex: coords.candleIndex,
            startPrice: coords.price,
            endCandleIndex: coords.candleIndex,
            endPrice: coords.price,
          };
          this.render();
          return;
        }
      }

      this.isDragging = true;
      this.dragStartX = x;
      this.dragStartOffset = this.panOffsetRight;
    });

    window.addEventListener("mouseup", () => {
      if (this.activeDraftDrawing) {
        if (
          Math.abs(
            this.activeDraftDrawing.endCandleIndex -
              this.activeDraftDrawing.startCandleIndex,
          ) >= 1 ||
          Math.abs(
            this.activeDraftDrawing.endPrice -
              this.activeDraftDrawing.startPrice,
          ) > 0
        ) {
          this.drawings.push(this.activeDraftDrawing);
          this.saveDrawingsToStorage();
        }
        this.activeDraftDrawing = null;
        this.options.drawingTool = "CURSOR";
        if (this.onToolCompleteCallback) this.onToolCompleteCallback();
        this.render();
      }
      this.isDragging = false;
      this.isScalingY = false;
    });

    // Double-click resets Y-axis scale or full view
    this.canvas.addEventListener("dblclick", () => {
      this.resetView();
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.isHovering = false;
      this.isDragging = false;
      this.isScalingY = false;
      this.render();
    });

    // Mouse Wheel Zoom (TradingView-style candle density zoom)
    this.canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 8 : -8;
        this.zoom(delta);
      },
      { passive: false },
    );

    // Mobile Touch Support for Crosshair Inspection & Drag
    this.canvas.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = touch.clientX - rect.left;
        this.mouseY = touch.clientY - rect.top;
        this.isHovering = true;
        this.isDragging = true;
        this.dragStartX = this.mouseX;
        this.dragStartOffset = this.panOffsetRight;
        this.render();
      },
      { passive: true },
    );

    this.canvas.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = touch.clientX - rect.left;
        this.mouseY = touch.clientY - rect.top;
        this.isHovering = true;

        if (this.isDragging && this.data && this.data.candles.length > 0) {
          const dx = this.mouseX - this.dragStartX;
          const chartW = rect.width - this.padding.left - this.padding.right;
          const step = chartW / Math.max(10, this.visibleCount);
          const candleDelta = Math.round(dx / step);
          const maxOffset = Math.max(
            0,
            this.data.candles.length - this.visibleCount,
          );
          this.panOffsetRight = Math.max(
            0,
            Math.min(maxOffset, this.dragStartOffset + candleDelta),
          );
        }
        this.render();
      },
      { passive: true },
    );

    this.canvas.addEventListener("touchend", () => {
      this.isDragging = false;
    });
  }

  public zoom(deltaCandles: number): void {
    const total = this.data?.candles.length ?? 120;
    this.visibleCount = Math.max(
      18,
      Math.min(Math.max(total, 140), this.visibleCount + deltaCandles),
    );
    const maxOffset = Math.max(0, total - this.visibleCount);
    this.panOffsetRight = Math.min(this.panOffsetRight, maxOffset);
    this.render();
  }

  public resetView(): void {
    this.visibleCount = 78;
    this.panOffsetRight = 0;
    this.yScaleFactor = 1.0;
    this.render();
  }

  public setData(data: ChartData): void {
    const prevSym = this.data?.symbol;
    this.data = data;
    if (prevSym !== data.symbol) {
      this.loadDrawingsFromStorage();
    }
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
    liquidationPools: LiquidationMagnetCluster[],
  ): void {
    this.bidClusters = bidClusters;
    this.askClusters = askClusters;
    this.liquidationPools = liquidationPools;
    this.render();
  }

  public setTradeSetupOverlay(setup: QuantTradeSetup | null): void {
    this.activeTradeSetup = setup;
    this.render();
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = parent.getBoundingClientRect();

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);

    this.render();
  }

  private getLayoutMetrics(): {
    width: number;
    height: number;
    chartWidth: number;
    priceHeight: number;
    volumeTop: number;
    volumeHeight: number;
    subPaneTop: number;
    subPaneHeight: number;
    startIdx: number;
    endIdx: number;
    minPrice: number;
    maxPrice: number;
    priceRange: number;
  } | null {
    if (!this.data || this.data.candles.length === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) return null;

    const chartWidth = width - this.padding.left - this.padding.right;
    const totalInnerHeight = height - this.padding.top - this.padding.bottom;

    const hasSubPane = this.options.subPaneMode !== "NONE";
    const priceHeight = hasSubPane
      ? totalInnerHeight * 0.66
      : totalInnerHeight * 0.8;
    const volumeTop = this.padding.top + priceHeight + 6;
    const volumeHeight = hasSubPane
      ? totalInnerHeight * 0.13
      : totalInnerHeight * 0.18;
    const subPaneTop = hasSubPane ? volumeTop + volumeHeight + 6 : height;
    const subPaneHeight = hasSubPane
      ? Math.max(36, totalInnerHeight - priceHeight - volumeHeight - 12)
      : 0;

    const allCandles = this.data.candles;
    const endIdx = Math.max(1, allCandles.length - this.panOffsetRight);
    const startIdx = Math.max(0, endIdx - this.visibleCount);
    const candles = allCandles.slice(startIdx, endIdx);

    let rawMin = Infinity;
    let rawMax = -Infinity;
    for (const c of candles) {
      if (c.low < rawMin) rawMin = c.low;
      if (c.high > rawMax) rawMax = c.high;
    }

    if (this.options.showTradeSetupBox && this.activeTradeSetup) {
      const s = this.activeTradeSetup;
      rawMin = Math.min(rawMin, s.protectedStopLoss * 0.999);
      rawMax = Math.max(rawMax, s.takeProfit2_25R * 1.001);
    }

    const midPrice = (rawMax + rawMin) / 2;
    const halfSpan =
      Math.max((rawMax - rawMin) / 2, midPrice * 0.002, 1e-6) *
      1.07 *
      this.yScaleFactor;
    const minPrice = midPrice - halfSpan;
    const maxPrice = midPrice + halfSpan;
    const priceRange = maxPrice - minPrice || 1;

    return {
      width,
      height,
      chartWidth,
      priceHeight,
      volumeTop,
      volumeHeight,
      subPaneTop,
      subPaneHeight,
      startIdx,
      endIdx,
      minPrice,
      maxPrice,
      priceRange,
    };
  }

  private screenToChartCoords(
    x: number,
    y: number,
  ): { candleIndex: number; price: number } | null {
    const m = this.getLayoutMetrics();
    if (!m || !this.data) return null;
    const count = Math.max(1, m.endIdx - m.startIdx);
    const step = m.chartWidth / count;
    const relIdx = Math.floor((x - this.padding.left) / step);
    const clampedRel = Math.max(0, Math.min(count - 1, relIdx));
    const candleIndex = m.startIdx + clampedRel;

    const clampedY = Math.max(
      this.padding.top,
      Math.min(this.padding.top + m.priceHeight, y),
    );
    const ratio = 1 - (clampedY - this.padding.top) / m.priceHeight;
    const price = m.minPrice + ratio * m.priceRange;
    return { candleIndex, price };
  }

  public render(): void {
    const m = this.getLayoutMetrics();
    if (!m || !this.data) return;

    const {
      width,
      height,
      chartWidth,
      priceHeight,
      volumeTop,
      volumeHeight,
      subPaneTop,
      subPaneHeight,
      startIdx,
      endIdx,
      minPrice,
      maxPrice,
      priceRange,
    } = m;

    // 1. Deep Institutional Background with Subtle Radial Vignette
    const bgGrad = this.ctx.createRadialGradient(
      width * 0.5,
      height * 0.35,
      20,
      width * 0.5,
      height * 0.5,
      width * 0.85,
    );
    bgGrad.addColorStop(0, this.colors.bgVignette);
    bgGrad.addColorStop(1, this.colors.bg);
    this.ctx.fillStyle = bgGrad;
    this.ctx.fillRect(0, 0, width, height);

    const allCandles = this.data.candles;
    const candles = allCandles.slice(startIdx, endIdx);
    if (candles.length === 0) return;

    let maxVolume = 1;
    for (const c of candles) {
      if (c.volume > maxVolume) maxVolume = c.volume;
    }

    // Precompute Indicator Arrays over full series, then slice
    const fullEma20 = this.computeEMA(allCandles, 20);
    const fullEma50 = this.computeEMA(allCandles, 50);
    const fullRsi14 = this.computeRSI(allCandles, 14);
    const fullVwapBands = this.computeVwapBands(allCandles);

    const vwapSlice = this.data.vwap.slice(startIdx, endIdx);
    const vwapUpperSlice = fullVwapBands.upper.slice(startIdx, endIdx);
    const vwapLowerSlice = fullVwapBands.lower.slice(startIdx, endIdx);
    const ema20Slice = fullEma20.slice(startIdx, endIdx);
    const ema50Slice = fullEma50.slice(startIdx, endIdx);
    const rsiSlice = fullRsi14.slice(startIdx, endIdx);
    const bbSlice = (this.data.bollinger ?? []).slice(startIdx, endIdx);
    const macdSlice = (this.data.macd ?? []).slice(startIdx, endIdx);

    // 2. Giant TradingView Background Watermark
    this.drawWatermark(width, priceHeight);

    // 3. Price & Time Grid
    if (this.options.showGrid) {
      this.drawGrid(width, height, chartWidth, priceHeight, minPrice, maxPrice);
    }

    // 4. Right-Side Volume Profile (VPVR) & POC Line
    if (this.options.showVolumeProfile) {
      this.drawVolumeProfile(chartWidth, priceHeight, minPrice, priceRange);
    }

    // 5. Bookmap-Style L2 Capital Walls & 50x-100x Liquidation Magnet Heatmap
    if (this.options.showLiquidityHeatmap) {
      this.drawLiquidityHeatmap(chartWidth, priceHeight, minPrice, priceRange);
    }

    // 6. Smart Money Concepts (SMC: Order Blocks, Fair Value Gaps, BOS/CHoCH)
    if (this.options.showSmcOverlay && this.data.smc) {
      this.drawSmartMoneyConcepts(
        this.data.smc,
        startIdx,
        endIdx,
        chartWidth,
        priceHeight,
        minPrice,
        priceRange,
      );
    }

    // 7. TradingView-Style Long/Short Position R:R Box (from EXEC <GO>)
    if (this.options.showTradeSetupBox && this.activeTradeSetup) {
      this.drawTradeSetupBox(
        this.activeTradeSetup,
        chartWidth,
        priceHeight,
        minPrice,
        priceRange,
      );
    }

    // 8. Bollinger Bands (20, 2σ)
    if (this.options.showBollingerBands && bbSlice.length > 0) {
      this.drawBollingerBands(
        bbSlice,
        chartWidth,
        priceHeight,
        minPrice,
        priceRange,
      );
    }

    // 9. EMA 20 / EMA 50 Trend Ribbon Cloud
    if (this.options.showEmaRibbon) {
      this.drawEmaRibbon(
        ema20Slice,
        ema50Slice,
        chartWidth,
        priceHeight,
        minPrice,
        priceRange,
      );
    }

    // 10. Session VWAP + ±1.5σ Standard Deviation Channel
    if (this.options.showVWAP && vwapSlice.length > 0) {
      this.drawVWAPAndBands(
        vwapSlice,
        vwapUpperSlice,
        vwapLowerSlice,
        chartWidth,
        priceHeight,
        minPrice,
        priceRange,
      );
    }

    // 11. Main Price Series (Candles / Hollow / Heikin-Ashi / Area / Baseline) + Swing High/Low Tags
    this.drawPriceSeries(
      candles,
      chartWidth,
      priceHeight,
      minPrice,
      priceRange,
    );

    // 12. Whale Iceberg Campaign VWAP Lines & Institutional Block Trade Bubbles
    if (this.options.showWhaleOverlay) {
      this.drawWhaleOverlay(
        candles,
        chartWidth,
        priceHeight,
        minPrice,
        priceRange,
      );
    }

    // 13. Interactive User Drawings (Fibonacci, Ruler, Trendlines, Horizontal Levels)
    this.drawUserDrawings(
      candles,
      startIdx,
      endIdx,
      chartWidth,
      priceHeight,
      minPrice,
      priceRange,
    );

    // 14. Sub-Pane 1: Volume Bars + Cumulative Volume Delta (CVD) Curve
    this.drawVolumeAndCvd(
      candles,
      chartWidth,
      volumeTop,
      volumeHeight,
      maxVolume,
    );

    // 15. Sub-Pane 2: Dedicated TradingView Oscillator (MACD 12,26,9 / RSI-14 / CVD Velocity)
    if (this.options.subPaneMode !== "NONE" && subPaneHeight > 20) {
      this.drawOscillatorSubPane(
        candles,
        macdSlice,
        rsiSlice,
        chartWidth,
        subPaneTop,
        subPaneHeight,
      );
    }

    // 16. Live Price Line + Bar Close Countdown Timer Badge
    const lastCandle = allCandles[allCandles.length - 1];
    if (lastCandle) {
      this.drawCurrentPriceLine(
        lastCandle.close,
        lastCandle.open,
        lastCandle.timestamp,
        chartWidth,
        priceHeight,
        minPrice,
        priceRange,
      );
    }

    // 17. Interactive Crosshair + Multi-Metric Top HUD
    if (this.isHovering && this.mouseX >= this.padding.left) {
      this.drawCrosshair(
        candles,
        vwapSlice,
        ema20Slice,
        ema50Slice,
        rsiSlice,
        width,
        height,
        chartWidth,
        priceHeight,
        minPrice,
        priceRange,
      );
    } else if (lastCandle) {
      const idx = candles.length - 1;
      this.drawLegend(
        lastCandle,
        vwapSlice[idx],
        ema20Slice[idx],
        ema50Slice[idx],
        rsiSlice[idx],
      );
    }
  }

  private drawWatermark(width: number, priceHeight: number): void {
    if (!this.data) return;
    this.ctx.save();
    this.ctx.fillStyle = "rgba(148, 163, 184, 0.045)";
    this.ctx.textAlign = "center";
    this.ctx.font = "bold 42px 'JetBrains Mono', monospace";
    const centerX =
      this.padding.left +
      (width - this.padding.left - this.padding.right) * 0.5;
    const centerY = this.padding.top + priceHeight * 0.52;
    this.ctx.fillText(
      `${this.data.symbol} • ${this.data.timeframe.toUpperCase()}`,
      centerX,
      centerY,
    );
    this.ctx.font = "bold 14px 'JetBrains Mono', monospace";
    this.ctx.fillText(
      "APEX // QUANT SUPERCHART WORKSTATION",
      centerX,
      centerY + 26,
    );
    this.ctx.restore();
  }

  private drawGrid(
    width: number,
    height: number,
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    maxPrice: number,
  ): void {
    const steps = 6;
    this.ctx.strokeStyle = this.colors.grid;
    this.ctx.lineWidth = 1;
    this.ctx.font = "10px 'JetBrains Mono', monospace";
    this.ctx.fillStyle = this.colors.text;
    this.ctx.textAlign = "left";

    // Right Y-Axis background strip
    this.ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    this.ctx.fillRect(
      width - this.padding.right,
      this.padding.top,
      this.padding.right,
      height - this.padding.top - this.padding.bottom,
    );
    this.ctx.fillStyle = this.colors.text;

    for (let i = 0; i <= steps; i++) {
      const ratio = i / steps;
      const y = this.padding.top + priceHeight * ratio;
      const price = maxPrice - (maxPrice - minPrice) * ratio;

      this.ctx.beginPath();
      this.ctx.moveTo(this.padding.left, y);
      this.ctx.lineTo(width - this.padding.right, y);
      this.ctx.stroke();

      this.ctx.fillText(
        this.formatPrice(price),
        width - this.padding.right + 6,
        y + 3,
      );
    }

    const vSteps = 7;
    for (let i = 1; i < vSteps; i++) {
      const x = this.padding.left + (chartWidth / vSteps) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(x, this.padding.top);
      this.ctx.lineTo(x, height - this.padding.bottom);
      this.ctx.stroke();
    }

    // Right price axis border line
    this.ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
    this.ctx.beginPath();
    this.ctx.moveTo(width - this.padding.right, this.padding.top);
    this.ctx.lineTo(width - this.padding.right, height - this.padding.bottom);
    this.ctx.stroke();
  }

  private drawVolumeProfile(
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    if (!this.data) return;
    const profile = this.data.volumeProfile;
    if (profile.length === 0) return;

    const maxBarWidth = chartWidth * 0.22;
    const binPixelHeight = Math.max(2, priceHeight / profile.length - 1);

    for (const node of profile) {
      const y =
        this.padding.top +
        priceHeight -
        ((node.priceLevel - minPrice) / priceRange) * priceHeight;
      if (y < this.padding.top || y > this.padding.top + priceHeight) continue;

      const barW = (node.percentage / 100) * maxBarWidth;
      const x = this.padding.left + chartWidth - barW;

      this.ctx.fillStyle = node.isPOC
        ? this.colors.vpPocBar
        : this.colors.vpBar;
      this.ctx.fillRect(x, y - binPixelHeight / 2, barW, binPixelHeight);

      if (node.isPOC) {
        this.ctx.save();
        this.ctx.strokeStyle = this.colors.poc;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([4, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(this.padding.left, y);
        this.ctx.lineTo(this.padding.left + chartWidth, y);
        this.ctx.stroke();

        this.ctx.fillStyle = this.colors.poc;
        this.ctx.font = "bold 9px 'JetBrains Mono', monospace";
        this.ctx.textAlign = "right";
        this.ctx.fillText(
          `POC $${this.formatPrice(node.priceLevel)}`,
          this.padding.left + chartWidth - 6,
          y - 4,
        );
        this.ctx.restore();
      }
    }
  }

  private drawLiquidityHeatmap(
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    this.ctx.save();
    this.ctx.font = "bold 9px 'JetBrains Mono', monospace";

    for (const zone of this.bidClusters.slice(0, 3)) {
      const y =
        this.padding.top +
        priceHeight -
        ((zone.priceBucket - minPrice) / priceRange) * priceHeight;
      if (y < this.padding.top + 8 || y > this.padding.top + priceHeight - 8)
        continue;
      const alpha = Math.min(
        0.24,
        Math.max(0.07, zone.shareOfSidePercent / 100),
      );
      this.ctx.fillStyle = `rgba(0, 230, 118, ${alpha.toFixed(2)})`;
      this.ctx.fillRect(this.padding.left, y - 4, chartWidth, 8);
      this.ctx.fillStyle = "#00e676";
      this.ctx.textAlign = "left";
      this.ctx.fillText(
        `🧱 BID WALL $${(zone.notionalUsd / 1e6).toFixed(2)}M (${zone.wallStatus === "VERIFIED_FORTRESS" ? "🛡️ VERIFIED" : zone.wallStatus === "ICEBERG_RELOADED" ? "🧊 ICEBERG" : "ACTIVE"})`,
        this.padding.left + 8,
        y - 6,
      );
    }

    for (const zone of this.askClusters.slice(0, 3)) {
      const y =
        this.padding.top +
        priceHeight -
        ((zone.priceBucket - minPrice) / priceRange) * priceHeight;
      if (y < this.padding.top + 8 || y > this.padding.top + priceHeight - 8)
        continue;
      const alpha = Math.min(
        0.24,
        Math.max(0.07, zone.shareOfSidePercent / 100),
      );
      this.ctx.fillStyle = `rgba(255, 23, 68, ${alpha.toFixed(2)})`;
      this.ctx.fillRect(this.padding.left, y - 4, chartWidth, 8);
      this.ctx.fillStyle = "#ff1744";
      this.ctx.textAlign = "left";
      this.ctx.fillText(
        `🧱 ASK WALL $${(zone.notionalUsd / 1e6).toFixed(2)}M (${zone.wallStatus === "VERIFIED_FORTRESS" ? "🛡️ VERIFIED" : zone.wallStatus === "ICEBERG_RELOADED" ? "🧊 ICEBERG" : "ACTIVE"})`,
        this.padding.left + 8,
        y - 6,
      );
    }

    for (const pool of this.liquidationPools) {
      if (pool.tier === "25x") continue;
      const y =
        this.padding.top +
        priceHeight -
        ((pool.priceLevel - minPrice) / priceRange) * priceHeight;
      if (y < this.padding.top + 8 || y > this.padding.top + priceHeight - 8)
        continue;

      const isShortPool = pool.side === "SHORT_LIQ_MAGNET";
      this.ctx.strokeStyle = isShortPool
        ? "rgba(250, 204, 21, 0.55)"
        : "rgba(168, 85, 247, 0.55)";
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([2, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(this.padding.left, y);
      this.ctx.lineTo(this.padding.left + chartWidth, y);
      this.ctx.stroke();

      this.ctx.fillStyle = isShortPool ? "#facc15" : "#c084fc";
      this.ctx.textAlign = "right";
      this.ctx.fillText(
        `🧲 ${pool.tier} ${isShortPool ? "SHORT LIQ" : "LONG LIQ"} ($${(pool.estimatedPoolUsd / 1e6).toFixed(0)}M)`,
        this.padding.left + chartWidth - 78,
        y - 3,
      );
    }

    this.ctx.restore();
  }

  /**
   * Smart Money Concepts (SMC) Overlay:
   * - Institutional Order Blocks (Bullish OB / Bearish OB)
   * - 3-Candle Fair Value Gaps (Bullish FVG / Bearish FVG)
   * - Market Structure Breaks (BOS ▲ / BOS ▼ / CHoCH ⚡)
   */
  private drawSmartMoneyConcepts(
    smc: NonNullable<ChartData["smc"]>,
    startIdx: number,
    endIdx: number,
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    const count = Math.max(1, endIdx - startIdx);
    const step = chartWidth / count;

    this.ctx.save();
    this.ctx.font = "bold 9px 'JetBrains Mono', monospace";

    // 1. Institutional Order Blocks (extend to right edge)
    for (const ob of smc.orderBlocks) {
      if (ob.candleIndex < startIdx - 15 || ob.candleIndex >= endIdx) continue;
      const relStart = Math.max(0, ob.candleIndex - startIdx);
      const xStart = this.padding.left + relStart * step;
      const xEnd = this.padding.left + chartWidth;
      const yTop =
        this.padding.top +
        priceHeight -
        ((ob.high - minPrice) / priceRange) * priceHeight;
      const yBot =
        this.padding.top +
        priceHeight -
        ((ob.low - minPrice) / priceRange) * priceHeight;
      if (yBot < this.padding.top || yTop > this.padding.top + priceHeight)
        continue;

      const isBull = ob.type === "BULL_OB";
      this.ctx.fillStyle = isBull
        ? "rgba(16, 185, 129, 0.09)"
        : "rgba(244, 63, 94, 0.09)";
      this.ctx.fillRect(
        xStart,
        Math.max(this.padding.top, yTop),
        xEnd - xStart,
        Math.max(4, yBot - yTop),
      );
      this.ctx.strokeStyle = isBull
        ? "rgba(16, 185, 129, 0.45)"
        : "rgba(244, 63, 94, 0.45)";
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([]);
      this.ctx.strokeRect(
        xStart,
        Math.max(this.padding.top, yTop),
        xEnd - xStart,
        Math.max(4, yBot - yTop),
      );

      this.ctx.fillStyle = isBull ? "#34d399" : "#fb7185";
      this.ctx.textAlign = "left";
      this.ctx.fillText(
        `🏦 ${isBull ? "BULL OB" : "BEAR OB"} ($${(ob.volumeUsd / 1e6).toFixed(1)}M)`,
        xStart + 4,
        yTop + 10,
      );
    }

    // 2. Fair Value Gaps (FVG)
    for (const fvg of smc.fairValueGaps) {
      if (fvg.mitigated) continue;
      if (fvg.startIndex < startIdx - 10 || fvg.startIndex >= endIdx) continue;
      const relStart = Math.max(0, fvg.startIndex - startIdx);
      const xStart = this.padding.left + relStart * step;
      const boxW = Math.min(
        chartWidth - (xStart - this.padding.left),
        step * 18,
      );
      const yTop =
        this.padding.top +
        priceHeight -
        ((fvg.topPrice - minPrice) / priceRange) * priceHeight;
      const yBot =
        this.padding.top +
        priceHeight -
        ((fvg.bottomPrice - minPrice) / priceRange) * priceHeight;
      if (yBot < this.padding.top || yTop > this.padding.top + priceHeight)
        continue;

      const isBull = fvg.type === "BULLISH";
      this.ctx.fillStyle = isBull
        ? "rgba(56, 189, 248, 0.12)"
        : "rgba(217, 70, 239, 0.12)";
      this.ctx.fillRect(xStart, yTop, boxW, Math.max(3, yBot - yTop));
      this.ctx.fillStyle = isBull ? "#38bdf8" : "#e879f9";
      this.ctx.textAlign = "left";
      this.ctx.fillText(
        isBull ? "⚡ BULL FVG" : "⚡ BEAR FVG",
        xStart + 4,
        (yTop + yBot) / 2 + 3,
      );
    }

    // 3. Structure Breaks (BOS / CHoCH)
    for (const brk of smc.structureBreaks) {
      if (brk.breakIndex < startIdx || brk.startIndex >= endIdx) continue;
      const rStart = Math.max(0, brk.startIndex - startIdx);
      const rEnd = Math.min(count - 1, brk.breakIndex - startIdx);
      const x1 = this.padding.left + (rStart + 0.5) * step;
      const x2 = this.padding.left + (rEnd + 0.5) * step;
      const y =
        this.padding.top +
        priceHeight -
        ((brk.price - minPrice) / priceRange) * priceHeight;
      if (y < this.padding.top + 8 || y > this.padding.top + priceHeight - 8)
        continue;

      const isBull = brk.type === "BOS_BULL" || brk.type === "CHOCH_BULL";
      const isChoch = brk.type === "CHOCH_BULL" || brk.type === "CHOCH_BEAR";

      this.ctx.strokeStyle = isBull ? "#00e676" : "#ff1744";
      this.ctx.lineWidth = isChoch ? 1.6 : 1.1;
      this.ctx.setLineDash(isChoch ? [5, 3] : [2, 2]);
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y);
      this.ctx.lineTo(x2, y);
      this.ctx.stroke();

      const midX = (x1 + x2) / 2;
      this.ctx.fillStyle = isBull ? "#00e676" : "#ff1744";
      this.ctx.textAlign = "center";
      const label = isChoch
        ? isBull
          ? "CHoCH ▲"
          : "CHoCH ▼"
        : isBull
          ? "BOS ▲"
          : "BOS ▼";
      this.ctx.fillText(label, midX, isBull ? y - 4 : y + 10);
    }

    this.ctx.restore();
  }

  private drawTradeSetupBox(
    setup: QuantTradeSetup,
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    const toY = (p: number) =>
      this.padding.top +
      priceHeight -
      ((p - minPrice) / priceRange) * priceHeight;

    const yEntry = toY(setup.optimalEntryPrice);
    const ySL = toY(setup.protectedStopLoss);
    const yTP1 = toY(setup.takeProfit1_15R);
    const yTP2 = toY(setup.takeProfit2_25R);

    const boxLeft = this.padding.left + chartWidth * 0.7;
    const boxWidth = chartWidth * 0.3;

    this.ctx.save();

    const slTop = Math.min(yEntry, ySL);
    const slHeight = Math.abs(ySL - yEntry);
    this.ctx.fillStyle = "rgba(255, 23, 68, 0.11)";
    this.ctx.fillRect(boxLeft, slTop, boxWidth, slHeight);
    this.ctx.strokeStyle = "rgba(255, 23, 68, 0.65)";
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([3, 3]);
    this.ctx.strokeRect(boxLeft, slTop, boxWidth, slHeight);

    const tpTop = Math.min(yEntry, yTP2);
    const tpHeight = Math.abs(yTP2 - yEntry);
    this.ctx.fillStyle = "rgba(0, 230, 118, 0.10)";
    this.ctx.fillRect(boxLeft, tpTop, boxWidth, tpHeight);
    this.ctx.strokeStyle = "rgba(0, 230, 118, 0.65)";
    this.ctx.strokeRect(boxLeft, tpTop, boxWidth, tpHeight);

    this.ctx.strokeStyle = "rgba(0, 230, 118, 0.45)";
    this.ctx.beginPath();
    this.ctx.moveTo(boxLeft, yTP1);
    this.ctx.lineTo(boxLeft + boxWidth, yTP1);
    this.ctx.stroke();

    this.ctx.setLineDash([]);
    this.ctx.strokeStyle = "#38bdf8";
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(boxLeft, yEntry);
    this.ctx.lineTo(boxLeft + boxWidth, yEntry);
    this.ctx.stroke();

    this.ctx.font = "bold 9px 'JetBrains Mono', monospace";
    this.ctx.textAlign = "left";
    this.ctx.fillStyle = "#00e676";
    this.ctx.fillText(
      `🎯 TP2 ($${this.formatPrice(setup.takeProfit2_25R)}) [${setup.rewardToRiskRatio.toFixed(1)}R]`,
      boxLeft + 5,
      yTP2 + (setup.direction === "LONG" ? 11 : -4),
    );
    this.ctx.fillText(
      `🎯 TP1 ($${this.formatPrice(setup.takeProfit1_15R)}) [1.5R]`,
      boxLeft + 5,
      yTP1 - 3,
    );
    this.ctx.fillStyle = "#ff1744";
    this.ctx.fillText(
      `🛡️ WALL SL ($${this.formatPrice(setup.protectedStopLoss)}) [-1.0R]`,
      boxLeft + 5,
      ySL + (setup.direction === "LONG" ? -4 : 11),
    );

    this.ctx.restore();
  }

  private drawBollingerBands(
    bb: NonNullable<ChartData["bollinger"]>,
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    const count = bb.length;
    if (count < 2) return;
    const step = chartWidth / count;
    const toY = (p: number) =>
      this.padding.top +
      priceHeight -
      ((p - minPrice) / priceRange) * priceHeight;

    this.ctx.save();
    this.ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = this.padding.left + i * step + step / 2;
      const y = toY(bb[i]!.upper);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    for (let i = count - 1; i >= 0; i--) {
      const x = this.padding.left + i * step + step / 2;
      const y = toY(bb[i]!.lower);
      this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
    this.ctx.fillStyle = "rgba(16, 185, 129, 0.05)";
    this.ctx.fill();

    this.ctx.strokeStyle = "rgba(16, 185, 129, 0.45)";
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([2, 2]);

    this.ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = this.padding.left + i * step + step / 2;
      const y = toY(bb[i]!.upper);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();

    this.ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = this.padding.left + i * step + step / 2;
      const y = toY(bb[i]!.lower);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawEmaRibbon(
    ema20: number[],
    ema50: number[],
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    const count = Math.min(ema20.length, ema50.length);
    if (count < 2) return;
    const step = chartWidth / count;
    const toY = (p: number) =>
      this.padding.top +
      priceHeight -
      ((p - minPrice) / priceRange) * priceHeight;

    this.ctx.save();
    this.ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = this.padding.left + i * step + step / 2;
      const y = toY(ema20[i]!);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    for (let i = count - 1; i >= 0; i--) {
      const x = this.padding.left + i * step + step / 2;
      const y = toY(ema50[i]!);
      this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
    const isBullTrend = (ema20[count - 1] ?? 0) >= (ema50[count - 1] ?? 0);
    this.ctx.fillStyle = isBullTrend
      ? "rgba(168, 85, 247, 0.08)"
      : "rgba(245, 158, 11, 0.08)";
    this.ctx.fill();

    this.ctx.strokeStyle = this.colors.ema20;
    this.ctx.lineWidth = 1.4;
    this.ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = this.padding.left + i * step + step / 2;
      const y = toY(ema20[i]!);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();

    this.ctx.strokeStyle = this.colors.ema50;
    this.ctx.lineWidth = 1.4;
    this.ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = this.padding.left + i * step + step / 2;
      const y = toY(ema50[i]!);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawVWAPAndBands(
    vwap: number[],
    upperBand: number[],
    lowerBand: number[],
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    const count = vwap.length;
    if (count < 2) return;
    const step = chartWidth / count;
    const toY = (p: number) =>
      this.padding.top +
      priceHeight -
      ((p - minPrice) / priceRange) * priceHeight;

    this.ctx.save();

    if (this.options.showVwapBands && upperBand.length === count) {
      this.ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = this.padding.left + i * step + step / 2;
        const y = toY(upperBand[i]!);
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      for (let i = count - 1; i >= 0; i--) {
        const x = this.padding.left + i * step + step / 2;
        const y = toY(lowerBand[i]!);
        this.ctx.lineTo(x, y);
      }
      this.ctx.closePath();
      this.ctx.fillStyle = this.colors.vwapBandFill;
      this.ctx.fill();

      this.ctx.strokeStyle = this.colors.vwapBandLine;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([3, 3]);

      this.ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = this.padding.left + i * step + step / 2;
        const y = toY(upperBand[i]!);
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();

      this.ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = this.padding.left + i * step + step / 2;
        const y = toY(lowerBand[i]!);
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    this.ctx.strokeStyle = this.colors.vwap;
    this.ctx.lineWidth = 1.8;
    this.ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = this.padding.left + i * step + step / 2;
      const y = toY(vwap[i]!);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawPriceSeries(
    candles: Candle[],
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    const count = candles.length;
    if (count === 0) return;
    const step = chartWidth / count;
    const toY = (p: number) =>
      this.padding.top +
      priceHeight -
      ((p - minPrice) / priceRange) * priceHeight;

    // Visual Mode: AREA (Gradient Mountain Chart)
    if (this.options.visualMode === "AREA") {
      this.ctx.save();
      const firstC = candles[0]!;
      const lastC = candles[count - 1]!;
      const isUp = lastC.close >= firstC.open;
      const strokeColor = isUp ? this.colors.bull : this.colors.bear;

      const grad = this.ctx.createLinearGradient(
        0,
        this.padding.top,
        0,
        this.padding.top + priceHeight,
      );
      grad.addColorStop(
        0,
        isUp ? "rgba(0, 230, 118, 0.32)" : "rgba(255, 23, 68, 0.32)",
      );
      grad.addColorStop(1, "rgba(7, 10, 16, 0.0)");

      this.ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = this.padding.left + i * step + step / 2;
        const y = toY(candles[i]!.close);
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.lineTo(
        this.padding.left + (count - 1) * step + step / 2,
        this.padding.top + priceHeight,
      );
      this.ctx.lineTo(
        this.padding.left + step / 2,
        this.padding.top + priceHeight,
      );
      this.ctx.closePath();
      this.ctx.fillStyle = grad;
      this.ctx.fill();

      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = 2.2;
      this.ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = this.padding.left + i * step + step / 2;
        const y = toY(candles[i]!.close);
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();
      this.ctx.restore();
      return;
    }

    // Visual Mode: BASELINE (TradingView Baseline split at window midpoint)
    if (this.options.visualMode === "BASELINE") {
      this.ctx.save();
      const basePrice =
        candles.reduce((acc, c) => acc + c.close, 0) / (candles.length || 1);
      const baseY = toY(basePrice);

      this.ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
      this.ctx.setLineDash([4, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(this.padding.left, baseY);
      this.ctx.lineTo(this.padding.left + chartWidth, baseY);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      for (let i = 1; i < count; i++) {
        const x0 = this.padding.left + (i - 1) * step + step / 2;
        const y0 = toY(candles[i - 1]!.close);
        const x1 = this.padding.left + i * step + step / 2;
        const y1 = toY(candles[i]!.close);
        const above = candles[i]!.close >= basePrice;

        this.ctx.fillStyle = above
          ? "rgba(0, 230, 118, 0.14)"
          : "rgba(255, 23, 68, 0.14)";
        this.ctx.beginPath();
        this.ctx.moveTo(x0, baseY);
        this.ctx.lineTo(x0, y0);
        this.ctx.lineTo(x1, y1);
        this.ctx.lineTo(x1, baseY);
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.strokeStyle = above ? this.colors.bull : this.colors.bear;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(x0, y0);
        this.ctx.lineTo(x1, y1);
        this.ctx.stroke();
      }
      this.ctx.restore();
      return;
    }

    // Transform to Heikin-Ashi if selected
    const displayCandles: Candle[] =
      this.options.visualMode === "HEIKIN_ASHI"
        ? this.toHeikinAshi(candles)
        : candles;

    const candleWidth = Math.max(2, Math.min(20, step * 0.74));
    let highestIdx = 0;
    let lowestIdx = 0;

    for (let i = 0; i < count; i++) {
      const c = displayCandles[i]!;
      if (c.high > displayCandles[highestIdx]!.high) highestIdx = i;
      if (c.low < displayCandles[lowestIdx]!.low) lowestIdx = i;

      const xCenter = this.padding.left + i * step + step / 2;
      const isBull = c.close >= c.open;

      const yHigh = toY(c.high);
      const yLow = toY(c.low);
      const yOpen = toY(c.open);
      const yClose = toY(c.close);

      // Wick
      this.ctx.strokeStyle = isBull ? this.colors.bull : this.colors.bear;
      this.ctx.lineWidth = 1.15;
      this.ctx.beginPath();
      this.ctx.moveTo(xCenter, yHigh);
      this.ctx.lineTo(xCenter, yLow);
      this.ctx.stroke();

      // Candle Body
      const bodyTop = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));

      if (this.options.visualMode === "HOLLOW" && isBull) {
        this.ctx.fillStyle = this.colors.bg;
        this.ctx.fillRect(
          xCenter - candleWidth / 2,
          bodyTop,
          candleWidth,
          bodyHeight,
        );
      } else {
        this.ctx.fillStyle = isBull
          ? this.colors.bullBody
          : this.colors.bearBody;
        this.ctx.fillRect(
          xCenter - candleWidth / 2,
          bodyTop,
          candleWidth,
          bodyHeight,
        );
      }

      if (candleWidth >= 4) {
        this.ctx.strokeStyle = isBull ? this.colors.bull : this.colors.bear;
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(
          xCenter - candleWidth / 2,
          bodyTop,
          candleWidth,
          bodyHeight,
        );
      }
    }

    // Swing High / Swing Low Callouts
    this.ctx.save();
    this.ctx.font = "bold 9px 'JetBrains Mono', monospace";
    const hiC = displayCandles[highestIdx]!;
    const hiX = this.padding.left + highestIdx * step + step / 2;
    const hiY = toY(hiC.high);
    this.ctx.fillStyle = "#00e676";
    this.ctx.textAlign =
      highestIdx > count * 0.8
        ? "right"
        : highestIdx < count * 0.2
          ? "left"
          : "center";
    this.ctx.fillText(`▲ HIGH $${this.formatPrice(hiC.high)}`, hiX, hiY - 6);

    const loC = displayCandles[lowestIdx]!;
    const loX = this.padding.left + lowestIdx * step + step / 2;
    const loY = toY(loC.low);
    this.ctx.fillStyle = "#ff1744";
    this.ctx.textAlign =
      lowestIdx > count * 0.8
        ? "right"
        : lowestIdx < count * 0.2
          ? "left"
          : "center";
    this.ctx.fillText(`▼ LOW $${this.formatPrice(loC.low)}`, loX, loY + 12);
    this.ctx.restore();
  }

  /**
   * Renders interactive user drawings:
   * - Price/Time Ruler (📏)
   * - Fibonacci Retracement 0%..100% with Golden Pocket (🌀)
   * - Diagonal Trendlines (📐)
   * - Horizontal Levels (➖)
   */
  private drawUserDrawings(
    _candles: Candle[],
    startIdx: number,
    endIdx: number,
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    const allDrawings = this.activeDraftDrawing
      ? [...this.drawings, this.activeDraftDrawing]
      : this.drawings;
    if (allDrawings.length === 0) return;

    const count = Math.max(1, endIdx - startIdx);
    const step = chartWidth / count;
    const toX = (cIdx: number) =>
      this.padding.left + (cIdx - startIdx + 0.5) * step;
    const toY = (p: number) =>
      this.padding.top +
      priceHeight -
      ((p - minPrice) / priceRange) * priceHeight;

    this.ctx.save();
    this.ctx.font = "bold 9px 'JetBrains Mono', monospace";

    for (const d of allDrawings) {
      if (d.type === "HLINE") {
        const y = toY(d.startPrice);
        if (y < this.padding.top || y > this.padding.top + priceHeight)
          continue;
        this.ctx.strokeStyle = "#facc15";
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([6, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(this.padding.left, y);
        this.ctx.lineTo(this.padding.left + chartWidth, y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.ctx.fillStyle = "#facc15";
        this.ctx.textAlign = "left";
        this.ctx.fillText(
          `🎯 LEVEL $${this.formatPrice(d.startPrice)}`,
          this.padding.left + 12,
          y - 4,
        );
        continue;
      }

      const x1 = toX(d.startCandleIndex);
      const y1 = toY(d.startPrice);
      const x2 = toX(d.endCandleIndex);
      const y2 = toY(d.endPrice);

      if (d.type === "TRENDLINE") {
        this.ctx.strokeStyle = "#38bdf8";
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([]);
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();

        // Endpoints
        this.ctx.fillStyle = "#38bdf8";
        this.ctx.beginPath();
        this.ctx.arc(x1, y1, 3.5, 0, Math.PI * 2);
        this.ctx.arc(x2, y2, 3.5, 0, Math.PI * 2);
        this.ctx.fill();

        const pct = ((d.endPrice - d.startPrice) / (d.startPrice || 1)) * 100;
        this.ctx.fillStyle = "#f8fafc";
        this.ctx.textAlign = "center";
        this.ctx.fillText(
          `📐 ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% ($${this.formatPrice(d.endPrice)})`,
          (x1 + x2) / 2,
          (y1 + y2) / 2 - 6,
        );
      } else if (d.type === "RULER") {
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        const isUp = d.endPrice >= d.startPrice;

        this.ctx.fillStyle = isUp
          ? "rgba(0, 230, 118, 0.14)"
          : "rgba(255, 23, 68, 0.14)";
        this.ctx.fillRect(left, top, w, h);
        this.ctx.strokeStyle = isUp ? "#00e676" : "#ff1744";
        this.ctx.lineWidth = 1.4;
        this.ctx.strokeRect(left, top, w, h);

        const priceDiff = d.endPrice - d.startPrice;
        const pctDiff = (priceDiff / (d.startPrice || 1)) * 100;
        const barSpan = Math.abs(d.endCandleIndex - d.startCandleIndex);

        const labelText = `${priceDiff >= 0 ? "+" : ""}${this.formatPrice(priceDiff)} (${pctDiff >= 0 ? "+" : ""}${pctDiff.toFixed(2)}%) • ${barSpan} bars`;
        const labelW = this.ctx.measureText(labelText).width + 14;
        const labelX = left + w / 2 - labelW / 2;
        const labelY = top - 22 < this.padding.top ? top + 6 : top - 22;

        this.ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
        this.ctx.fillRect(labelX, labelY, labelW, 18);
        this.ctx.strokeStyle = isUp ? "#00e676" : "#ff1744";
        this.ctx.strokeRect(labelX, labelY, labelW, 18);
        this.ctx.fillStyle = isUp ? "#00e676" : "#ff1744";
        this.ctx.textAlign = "center";
        this.ctx.fillText(labelText, left + w / 2, labelY + 12);
      } else if (d.type === "FIB") {
        const levels = [
          { ratio: 0, label: "0.0%", color: "#94a3b8" },
          { ratio: 0.236, label: "23.6%", color: "#f87171" },
          { ratio: 0.382, label: "38.2%", color: "#fbbf24" },
          { ratio: 0.5, label: "50.0%", color: "#34d399" },
          { ratio: 0.618, label: "61.8% GOLDEN", color: "#38bdf8" },
          { ratio: 0.786, label: "78.6%", color: "#a855f7" },
          { ratio: 1, label: "100.0%", color: "#94a3b8" },
        ];
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2, left + step * 10);
        const diff = d.endPrice - d.startPrice;

        // Golden Pocket Shaded Fill (0.5 to 0.618)
        const p50 = d.endPrice - diff * 0.5;
        const p618 = d.endPrice - diff * 0.618;
        const y50 = toY(p50);
        const y618 = toY(p618);
        this.ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
        this.ctx.fillRect(
          left,
          Math.min(y50, y618),
          right - left,
          Math.abs(y618 - y50),
        );

        for (const lv of levels) {
          const lvlPrice = d.endPrice - diff * lv.ratio;
          const ly = toY(lvlPrice);
          if (ly < this.padding.top || ly > this.padding.top + priceHeight)
            continue;
          this.ctx.strokeStyle = lv.color;
          this.ctx.lineWidth = lv.ratio === 0.618 ? 1.8 : 1;
          this.ctx.beginPath();
          this.ctx.moveTo(left, ly);
          this.ctx.lineTo(right, ly);
          this.ctx.stroke();

          this.ctx.fillStyle = lv.color;
          this.ctx.textAlign = "left";
          this.ctx.fillText(
            `${lv.label} ($${this.formatPrice(lvlPrice)})`,
            left + 4,
            ly - 3,
          );
        }
      }
    }

    this.ctx.restore();
  }

  private drawVolumeAndCvd(
    candles: Candle[],
    chartWidth: number,
    volumeTop: number,
    volumeHeight: number,
    maxVolume: number,
  ): void {
    const count = candles.length;
    if (count === 0) return;
    const step = chartWidth / count;
    const barWidth = Math.max(1.5, Math.min(18, step * 0.68));

    const cvdValues: number[] = [];
    let runningCvd = 0;

    for (let i = 0; i < count; i++) {
      const c = candles[i]!;
      const xCenter = this.padding.left + i * step + step / 2;
      const isBull = c.close >= c.open;
      const barH = (c.volume / maxVolume) * volumeHeight;
      const y = volumeTop + volumeHeight - barH;

      this.ctx.fillStyle = isBull ? this.colors.bullDim : this.colors.bearDim;
      this.ctx.fillRect(xCenter - barWidth / 2, y, barWidth, barH);

      const hlRange = c.high - c.low;
      const buyRatio = hlRange > 0 ? (c.close - c.low) / hlRange : 0.5;
      const deltaVol = c.volume * (2 * buyRatio - 1) * c.close;
      runningCvd += deltaVol;
      cvdValues.push(runningCvd);
    }

    if (this.options.showCvdCurve && cvdValues.length > 1) {
      const minCvd = Math.min(...cvdValues);
      const maxCvd = Math.max(...cvdValues);
      const cvdSpan = maxCvd - minCvd || 1;

      this.ctx.save();
      this.ctx.strokeStyle = this.colors.cvdLine;
      this.ctx.lineWidth = 1.4;
      this.ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = this.padding.left + i * step + step / 2;
        const y =
          volumeTop +
          volumeHeight -
          ((cvdValues[i]! - minCvd) / cvdSpan) * (volumeHeight - 4) -
          2;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();

      const netCvd = cvdValues[cvdValues.length - 1] ?? 0;
      this.ctx.fillStyle = netCvd >= 0 ? "#00e676" : "#ff1744";
      this.ctx.font = "bold 9px 'JetBrains Mono', monospace";
      this.ctx.textAlign = "left";
      this.ctx.fillText(
        `⚡ CVD DELTA: ${netCvd >= 0 ? "▲ +" : "▼ -"}$${(Math.abs(netCvd) / 1e6).toFixed(2)}M`,
        this.padding.left + 6,
        volumeTop + 10,
      );
      this.ctx.restore();
    }
  }

  /**
   * Dedicated Bottom TradingView Oscillator Sub-Pane:
   * - MACD (12, 26, 9) with 4-color momentum histogram
   * - RSI (14) + SMA (14) with 70/30 channel
   * - CVD Velocity bar delta
   */
  private drawOscillatorSubPane(
    candles: Candle[],
    macdSlice: NonNullable<ChartData["macd"]>,
    rsiSlice: number[],
    chartWidth: number,
    subPaneTop: number,
    subPaneHeight: number,
  ): void {
    const count = candles.length;
    if (count < 2) return;
    const step = chartWidth / count;

    this.ctx.save();
    // Sub-pane top divider
    this.ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(this.padding.left, subPaneTop - 2);
    this.ctx.lineTo(this.padding.left + chartWidth, subPaneTop - 2);
    this.ctx.stroke();

    this.ctx.font = "bold 9px 'JetBrains Mono', monospace";
    this.ctx.textAlign = "left";

    if (this.options.subPaneMode === "MACD" && macdSlice.length > 0) {
      let maxAbs = 1e-6;
      for (const m of macdSlice) {
        maxAbs = Math.max(
          maxAbs,
          Math.abs(m.macd),
          Math.abs(m.signal),
          Math.abs(m.histogram),
        );
      }
      const zeroY = subPaneTop + subPaneHeight / 2;
      const scale = (subPaneHeight * 0.42) / maxAbs;

      // Zero line
      this.ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
      this.ctx.beginPath();
      this.ctx.moveTo(this.padding.left, zeroY);
      this.ctx.lineTo(this.padding.left + chartWidth, zeroY);
      this.ctx.stroke();

      // 4-Color TradingView Histogram
      const barW = Math.max(1.5, Math.min(14, step * 0.65));
      for (let i = 0; i < macdSlice.length; i++) {
        const h = macdSlice[i]!.histogram;
        const prevH = i > 0 ? macdSlice[i - 1]!.histogram : 0;
        const x = this.padding.left + i * step + step / 2;
        const barH = Math.abs(h) * scale;

        if (h >= 0) {
          this.ctx.fillStyle =
            h >= prevH ? "#00e676" : "rgba(0, 230, 118, 0.45)";
          this.ctx.fillRect(x - barW / 2, zeroY - barH, barW, barH);
        } else {
          this.ctx.fillStyle =
            h <= prevH ? "#ff1744" : "rgba(255, 23, 68, 0.45)";
          this.ctx.fillRect(x - barW / 2, zeroY, barW, barH);
        }
      }

      // MACD Line (Cyan)
      this.ctx.strokeStyle = "#38bdf8";
      this.ctx.lineWidth = 1.4;
      this.ctx.beginPath();
      for (let i = 0; i < macdSlice.length; i++) {
        const x = this.padding.left + i * step + step / 2;
        const y = zeroY - macdSlice[i]!.macd * scale;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();

      // Signal Line (Orange)
      this.ctx.strokeStyle = "#f59e0b";
      this.ctx.lineWidth = 1.3;
      this.ctx.beginPath();
      for (let i = 0; i < macdSlice.length; i++) {
        const x = this.padding.left + i * step + step / 2;
        const y = zeroY - macdSlice[i]!.signal * scale;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();

      const lastM = macdSlice[macdSlice.length - 1]!;
      this.ctx.fillStyle = "#38bdf8";
      this.ctx.fillText(
        `📊 MACD (12,26,9)  MACD: ${lastM.macd.toFixed(2)}  SIG: ${lastM.signal.toFixed(2)}  HIST: ${lastM.histogram >= 0 ? "+" : ""}${lastM.histogram.toFixed(2)}`,
        this.padding.left + 6,
        subPaneTop + 11,
      );
    } else if (this.options.subPaneMode === "RSI" && rsiSlice.length > 0) {
      const toY = (v: number) =>
        subPaneTop + subPaneHeight - (v / 100) * (subPaneHeight - 10) - 4;
      const y70 = toY(70);
      const y30 = toY(30);

      this.ctx.fillStyle = "rgba(168, 85, 247, 0.08)";
      this.ctx.fillRect(this.padding.left, y70, chartWidth, y30 - y70);

      this.ctx.strokeStyle = "rgba(168, 85, 247, 0.4)";
      this.ctx.setLineDash([3, 3]);
      this.ctx.beginPath();
      this.ctx.moveTo(this.padding.left, y70);
      this.ctx.lineTo(this.padding.left + chartWidth, y70);
      this.ctx.moveTo(this.padding.left, y30);
      this.ctx.lineTo(this.padding.left + chartWidth, y30);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      this.ctx.strokeStyle = "#c084fc";
      this.ctx.lineWidth = 1.6;
      this.ctx.beginPath();
      for (let i = 0; i < rsiSlice.length; i++) {
        const x = this.padding.left + i * step + step / 2;
        const y = toY(rsiSlice[i]!);
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();

      const lastRsi = rsiSlice[rsiSlice.length - 1] ?? 50;
      this.ctx.fillStyle =
        lastRsi >= 70 ? "#ff1744" : lastRsi <= 30 ? "#00e676" : "#c084fc";
      this.ctx.fillText(
        `⚡ RSI (14): ${lastRsi.toFixed(1)} ${lastRsi >= 70 ? "[OVERBOUGHT >70]" : lastRsi <= 30 ? "[OVERSOLD <30]" : "[NEUTRAL]"}`,
        this.padding.left + 6,
        subPaneTop + 11,
      );
    } else if (this.options.subPaneMode === "CVD") {
      const zeroY = subPaneTop + subPaneHeight / 2;
      const deltas = candles.map((c) => {
        const r = c.high - c.low;
        const buyRatio = r > 0 ? (c.close - c.low) / r : 0.5;
        return c.volume * (2 * buyRatio - 1) * c.close;
      });
      const maxD = Math.max(...deltas.map((d) => Math.abs(d)), 1);
      const scale = (subPaneHeight * 0.42) / maxD;
      const barW = Math.max(2, Math.min(14, step * 0.65));

      for (let i = 0; i < deltas.length; i++) {
        const d = deltas[i]!;
        const x = this.padding.left + i * step + step / 2;
        const h = Math.abs(d) * scale;
        this.ctx.fillStyle = d >= 0 ? "#00e676" : "#ff1744";
        this.ctx.fillRect(x - barW / 2, d >= 0 ? zeroY - h : zeroY, barW, h);
      }
      const lastD = deltas[deltas.length - 1] ?? 0;
      this.ctx.fillStyle = lastD >= 0 ? "#00e676" : "#ff1744";
      this.ctx.fillText(
        `🔥 BAR DELTA VELOCITY: ${lastD >= 0 ? "+" : "-"}$${(Math.abs(lastD) / 1e6).toFixed(2)}M`,
        this.padding.left + 6,
        subPaneTop + 11,
      );
    }

    this.ctx.restore();
  }

  private drawCurrentPriceLine(
    price: number,
    openPrice: number,
    candleTimestamp: number,
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    const y =
      this.padding.top +
      priceHeight -
      ((price - minPrice) / priceRange) * priceHeight;
    if (y < this.padding.top || y > this.padding.top + priceHeight) return;

    const isBull = price >= openPrice;
    const color = isBull ? this.colors.bull : this.colors.bear;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([2, 2]);
    this.ctx.beginPath();
    this.ctx.moveTo(this.padding.left, y);
    this.ctx.lineTo(this.padding.left + chartWidth, y);
    this.ctx.stroke();

    // Right Axis Price Tag + Bar Countdown Timer
    const tagX = this.padding.left + chartWidth;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(tagX, y - 10, this.padding.right - 2, 19);

    this.ctx.fillStyle = "#04060a";
    this.ctx.font = "bold 10px 'JetBrains Mono', monospace";
    this.ctx.textAlign = "left";
    this.ctx.fillText(this.formatPrice(price), tagX + 5, y + 3);

    // Remaining time on current bar
    const countdown = this.getBarCountdownString(candleTimestamp);
    this.ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    this.ctx.fillRect(tagX, y + 9, this.padding.right - 2, 14);
    this.ctx.fillStyle = "#94a3b8";
    this.ctx.font = "9px 'JetBrains Mono', monospace";
    this.ctx.fillText(`⏱ ${countdown}`, tagX + 5, y + 19);
    this.ctx.restore();
  }

  private getBarCountdownString(candleTimestamp: number): string {
    const tf = this.data?.timeframe ?? "1h";
    const durMap: Record<string, number> = {
      "1m": 60_000,
      "5m": 300_000,
      "15m": 900_000,
      "1h": 3_600_000,
      "4h": 14_400_000,
      "1d": 86_400_000,
      "1w": 604_800_000,
    };
    const dur = durMap[tf] ?? 3_600_000;
    const remMs = Math.max(0, candleTimestamp + dur - Date.now());
    const totalSec = Math.floor(remMs / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  private drawCrosshair(
    candles: Candle[],
    vwapSlice: number[],
    ema20Slice: number[],
    ema50Slice: number[],
    rsiSlice: number[],
    width: number,
    height: number,
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    const count = candles.length;
    const step = chartWidth / count;

    const rawIndex = Math.floor((this.mouseX - this.padding.left) / step);
    const candleIndex = Math.max(0, Math.min(count - 1, rawIndex));
    const hoveredCandle = candles[candleIndex];
    if (!hoveredCandle) return;

    const snapX = this.padding.left + candleIndex * step + step / 2;

    this.ctx.save();
    this.ctx.strokeStyle = this.colors.crosshair;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 4]);

    this.ctx.beginPath();
    this.ctx.moveTo(snapX, this.padding.top);
    this.ctx.lineTo(snapX, height - this.padding.bottom);
    this.ctx.stroke();

    if (
      this.mouseY >= this.padding.top &&
      this.mouseY <= this.padding.top + priceHeight
    ) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.padding.left, this.mouseY);
      this.ctx.lineTo(width - this.padding.right, this.mouseY);
      this.ctx.stroke();

      const hoveredPrice =
        minPrice +
        ((this.padding.top + priceHeight - this.mouseY) / priceHeight) *
          priceRange;

      this.ctx.fillStyle = this.colors.crosshairBg;
      this.ctx.fillRect(
        width - this.padding.right,
        this.mouseY - 10,
        this.padding.right - 2,
        20,
      );
      this.ctx.fillStyle = this.colors.textBright;
      this.ctx.font = "10px 'JetBrains Mono', monospace";
      this.ctx.textAlign = "left";
      this.ctx.fillText(
        this.formatPrice(hoveredPrice),
        width - this.padding.right + 6,
        this.mouseY + 3,
      );
    }

    const dateStr = new Date(hoveredCandle.timestamp).toLocaleTimeString([], {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const labelW = 104;
    const labelX = Math.max(
      this.padding.left,
      Math.min(width - this.padding.right - labelW, snapX - labelW / 2),
    );
    this.ctx.fillStyle = this.colors.crosshairBg;
    this.ctx.fillRect(labelX, height - this.padding.bottom + 2, labelW, 18);
    this.ctx.fillStyle = this.colors.textBright;
    this.ctx.font = "10px 'JetBrains Mono', monospace";
    this.ctx.textAlign = "center";
    this.ctx.fillText(dateStr, labelX + labelW / 2, height - 11);

    this.ctx.restore();
    this.drawLegend(
      hoveredCandle,
      vwapSlice[candleIndex],
      ema20Slice[candleIndex],
      ema50Slice[candleIndex],
      rsiSlice[candleIndex],
    );
  }

  private drawLegend(
    c: Candle,
    vwapVal?: number,
    ema20Val?: number,
    ema50Val?: number,
    rsiVal?: number,
  ): void {
    if (!this.data) return;
    const isBull = c.close >= c.open;
    const changePct = ((c.close - c.open) / c.open) * 100;
    const sign = changePct >= 0 ? "+" : "";

    this.ctx.save();
    this.ctx.font = "bold 11px 'JetBrains Mono', monospace";
    this.ctx.textAlign = "left";

    let x = this.padding.left + 4;
    const y1 = 18;

    const modeBadge =
      this.options.visualMode === "HEIKIN_ASHI"
        ? " [HA]"
        : this.options.visualMode === "HOLLOW"
          ? " [HOLLOW]"
          : this.options.visualMode === "AREA"
            ? " [AREA]"
            : this.options.visualMode === "BASELINE"
              ? " [BASE]"
              : "";
    this.ctx.fillStyle = this.colors.textBright;
    const title = `${this.data.symbol} [${this.data.timeframe.toUpperCase()}]${modeBadge}`;
    this.ctx.fillText(title, x, y1);
    x += this.ctx.measureText(title).width + 12;

    this.ctx.font = "11px 'JetBrains Mono', monospace";
    const metrics = [
      { label: "O:", val: this.formatPrice(c.open) },
      { label: "H:", val: this.formatPrice(c.high) },
      { label: "L:", val: this.formatPrice(c.low) },
      { label: "C:", val: this.formatPrice(c.close) },
      { label: "CHG:", val: `${sign}${changePct.toFixed(2)}%` },
      { label: "VOL:", val: this.formatVolume(c.volume) },
    ];

    for (const m of metrics) {
      this.ctx.fillStyle = this.colors.text;
      this.ctx.fillText(m.label, x, y1);
      x += this.ctx.measureText(m.label).width + 3;

      this.ctx.fillStyle = isBull ? this.colors.bull : this.colors.bear;
      this.ctx.fillText(m.val, x, y1);
      x += this.ctx.measureText(m.val).width + 10;
    }

    let x2 = this.padding.left + 4;
    const y2 = 35;
    this.ctx.font = "10px 'JetBrains Mono', monospace";

    if (vwapVal) {
      this.ctx.fillStyle = this.colors.vwap;
      const vTxt = `VWAP (±1.5σ): $${this.formatPrice(vwapVal)}`;
      this.ctx.fillText(vTxt, x2, y2);
      x2 += this.ctx.measureText(vTxt).width + 12;
    }

    if (ema20Val && this.options.showEmaRibbon) {
      this.ctx.fillStyle = this.colors.ema20;
      const e20Txt = `EMA20: $${this.formatPrice(ema20Val)}`;
      this.ctx.fillText(e20Txt, x2, y2);
      x2 += this.ctx.measureText(e20Txt).width + 12;
    }

    if (ema50Val && this.options.showEmaRibbon) {
      this.ctx.fillStyle = this.colors.ema50;
      const e50Txt = `EMA50: $${this.formatPrice(ema50Val)}`;
      this.ctx.fillText(e50Txt, x2, y2);
      x2 += this.ctx.measureText(e50Txt).width + 12;
    }

    if (rsiVal !== undefined) {
      const rsiColor =
        rsiVal >= 70 ? "#ff1744" : rsiVal <= 30 ? "#00e676" : "#a855f7";
      this.ctx.fillStyle = rsiColor;
      const rTxt = `RSI(14): ${rsiVal.toFixed(1)}`;
      this.ctx.fillText(rTxt, x2, y2);
      x2 += this.ctx.measureText(rTxt).width + 12;
    }

    if (this.data.pointOfControlPrice > 0) {
      this.ctx.fillStyle = this.colors.poc;
      const pTxt = `POC: $${this.formatPrice(this.data.pointOfControlPrice)}`;
      this.ctx.fillText(pTxt, x2, y2);
      x2 += this.ctx.measureText(pTxt).width + 12;
    }

    if (this.data.smc && this.options.showSmcOverlay) {
      this.ctx.fillStyle = "#34d399";
      this.ctx.fillText(
        `SMC: ${this.data.smc.structureBreaks.length} BOS/CHoCH • ${this.data.smc.fairValueGaps.filter((f) => !f.mitigated).length} FVG • ${this.data.smc.orderBlocks.length} OB`,
        x2,
        y2,
      );
    }

    this.ctx.restore();
  }

  private drawWhaleOverlay(
    candles: Candle[],
    chartWidth: number,
    priceHeight: number,
    minPrice: number,
    priceRange: number,
  ): void {
    if (!this.data || candles.length === 0) return;
    const baseAsset = this.data.symbol.replace(/USDT$/i, "").toUpperCase();

    const symbolCampaigns = this.whaleCampaigns.filter(
      (c) => c.symbol.toUpperCase() === baseAsset,
    );
    const symbolTrades = this.whaleTrades.filter(
      (t) => t.symbol.toUpperCase() === baseAsset && t.valueUsd >= 150_000,
    );

    this.ctx.save();

    for (const camp of symbolCampaigns.slice(0, 3)) {
      if (camp.vwapPrice < minPrice || camp.vwapPrice > minPrice + priceRange) {
        continue;
      }
      const y =
        this.padding.top +
        priceHeight -
        ((camp.vwapPrice - minPrice) / priceRange) * priceHeight;
      const isBuy = camp.side === "BUY";
      const lineColor = isBuy ? "#00e676" : "#ff1744";

      this.ctx.strokeStyle = lineColor;
      this.ctx.lineWidth = 1.5;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(this.padding.left, y);
      this.ctx.lineTo(this.padding.left + chartWidth, y);
      this.ctx.stroke();

      const labelText = `🐋 ${camp.side} ICEBERG VWAP $${this.formatPrice(camp.vwapPrice)} ($${(camp.totalValueUsd / 1e6).toFixed(2)}M)`;
      this.ctx.font = "bold 9px 'JetBrains Mono', monospace";
      const textW = this.ctx.measureText(labelText).width + 10;
      this.ctx.fillStyle = "rgba(10, 14, 23, 0.88)";
      this.ctx.fillRect(this.padding.left + 8, y - 15, textW, 14);
      this.ctx.fillStyle = lineColor;
      this.ctx.textAlign = "left";
      this.ctx.fillText(labelText, this.padding.left + 13, y - 5);
    }

    this.ctx.setLineDash([]);
    const count = candles.length;
    const step = chartWidth / count;

    for (const trade of symbolTrades.slice(0, 8)) {
      if (trade.price < minPrice || trade.price > minPrice + priceRange) {
        continue;
      }
      let bestIdx = count - 1;
      let bestDiff = Infinity;
      for (let i = 0; i < count; i++) {
        const diff = Math.abs(candles[i]!.timestamp - trade.timestamp);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }

      const x = this.padding.left + bestIdx * step + step / 2;
      const y =
        this.padding.top +
        priceHeight -
        ((trade.price - minPrice) / priceRange) * priceHeight;
      const radius = Math.min(
        11,
        Math.max(4, Math.sqrt(trade.valueUsd / 100_000) * 3),
      );
      const isBuy = trade.side === "BUY";

      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = isBuy
        ? "rgba(0, 230, 118, 0.35)"
        : "rgba(255, 23, 68, 0.35)";
      this.ctx.fill();
      this.ctx.lineWidth = 1.5;
      this.ctx.strokeStyle = isBuy ? "#00e676" : "#ff1744";
      this.ctx.stroke();

      this.ctx.fillStyle = "#f8fafc";
      this.ctx.font = "bold 8px 'JetBrains Mono', monospace";
      this.ctx.textAlign = "center";
      this.ctx.fillText(isBuy ? "B" : "S", x, y + 3);
    }

    this.ctx.restore();
  }

  private toHeikinAshi(candles: Candle[]): Candle[] {
    const out: Candle[] = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      const haClose = (c.open + c.high + c.low + c.close) / 4;
      const prev = out[i - 1];
      const haOpen = prev
        ? (prev.open + prev.close) / 2
        : (c.open + c.close) / 2;
      const haHigh = Math.max(c.high, haOpen, haClose);
      const haLow = Math.min(c.low, haOpen, haClose);
      out.push({
        timestamp: c.timestamp,
        open: haOpen,
        high: haHigh,
        low: haLow,
        close: haClose,
        volume: c.volume,
        vwap: c.vwap,
      });
    }
    return out;
  }

  private computeEMA(candles: Candle[], period: number): number[] {
    const out: number[] = [];
    if (candles.length === 0) return out;
    const k = 2 / (period + 1);
    let ema = candles[0]!.close;
    for (let i = 0; i < candles.length; i++) {
      const price = candles[i]!.close;
      ema = i === 0 ? price : price * k + ema * (1 - k);
      out.push(ema);
    }
    return out;
  }

  private computeRSI(candles: Candle[], period: number = 14): number[] {
    const out: number[] = [];
    if (candles.length === 0) return out;
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 0; i < candles.length; i++) {
      if (i === 0) {
        out.push(50);
        continue;
      }
      const diff = candles[i]!.close - candles[i - 1]!.close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      if (i <= period) {
        avgGain = (avgGain * (i - 1) + gain) / i;
        avgLoss = (avgLoss * (i - 1) + loss) / i;
      } else {
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
      }

      if (avgLoss === 0) {
        out.push(100);
      } else {
        const rs = avgGain / avgLoss;
        out.push(100 - 100 / (1 + rs));
      }
    }
    return out;
  }

  private computeVwapBands(candles: Candle[]): {
    upper: number[];
    lower: number[];
  } {
    const upper: number[] = [];
    const lower: number[] = [];
    let cumVol = 0;
    let cumPV = 0;
    let cumPV2 = 0;

    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      const v = Math.max(c.volume, 1e-8);
      cumVol += v;
      cumPV += tp * v;
      cumPV2 += tp * tp * v;

      const vwap = cumPV / cumVol;
      const variance = Math.max(0, cumPV2 / cumVol - vwap * vwap);
      const sd = Math.sqrt(variance);
      upper.push(vwap + 1.5 * sd);
      lower.push(vwap - 1.5 * sd);
    }
    return { upper, lower };
  }

  private formatPrice(price: number): string {
    if (price >= 1000) {
      return price.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } else if (price >= 1) {
      return price.toFixed(3);
    } else {
      return price.toFixed(5);
    }
  }

  private formatVolume(vol: number): string {
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(2)}K`;
    return vol.toFixed(1);
  }
}
