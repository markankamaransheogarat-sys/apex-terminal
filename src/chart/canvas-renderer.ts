/**
 * Apex Terminal - Zero-Dependency High-Frequency HTML5 Canvas Chart Renderer
 * Renders 60 FPS Candlesticks, Volume bars, VWAP curve, and Volume Profile (POC)
 * with High-DPI scaling, interactive crosshairs, and institutional HUD.
 */

import { ChartData, Candle } from "./types.js";
import { WhaleTrancheCampaign } from "../feeds/whale-cluster-engine.js";
import { WhaleTrade } from "../feeds/whale-stream.js";
import { CapitalClusterZone } from "../orderbook/orderbook-service.js";
import { LiquidationMagnetCluster } from "../execution/quant-execution-calculator.js";

export interface ChartRenderOptions {
  showVWAP?: boolean;
  showVolumeProfile?: boolean;
  showGrid?: boolean;
  showWhaleOverlay?: boolean;
  showLiquidityHeatmap?: boolean;
}

export class CanvasChartRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private data: ChartData | null = null;
  private options: ChartRenderOptions;
  private whaleCampaigns: WhaleTrancheCampaign[] = [];
  private whaleTrades: WhaleTrade[] = [];
  private bidClusters: CapitalClusterZone[] = [];
  private askClusters: CapitalClusterZone[] = [];
  private liqMagnets: LiquidationMagnetCluster[] = [];

  private hoverX: number | null = null;
  private hoverY: number | null = null;
  private hoveredCandle: Candle | null = null;

  // Chart padding
  private padRight = 75; // price scale area
  private padBottom = 26; // time scale area
  private padTop = 24; // HUD area
  private padLeft = 10;

  constructor(canvas: HTMLCanvasElement, options: ChartRenderOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire 2D canvas context");
    this.ctx = ctx;

    this.options = {
      showVWAP: true,
      showVolumeProfile: true,
      showGrid: true,
      showWhaleOverlay: true,
      showLiquidityHeatmap: true,
      ...options,
    };

    this.bindMouseEvents();
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
    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.hoverX = e.clientX - rect.left;
      this.hoverY = e.clientY - rect.top;
      this.render();
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.hoverX = null;
      this.hoverY = null;
      this.hoveredCandle = null;
      this.render();
    });

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

    const { candles, vwap, volumeProfile, minPrice, maxPrice, maxVolume } =
      this.data;

    const plotW = width - this.padLeft - this.padRight;
    const plotH = height - this.padTop - this.padBottom;
    const volAreaH = plotH * 0.22; // lower 22% for volume
    const priceAreaH = plotH * 0.78;

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
    const colMuted = isLight ? "#6f6d64" : "#b8b8ad";
    const colText = isLight ? "#17181a" : "#f1eee4";
    const colBg = isLight ? "#f2f1ec" : "#111210";
    const colGrid = isLight
      ? "rgba(226, 224, 216, 0.8)"
      : "rgba(48, 51, 46, 0.65)";

    // 1. Background Grid Lines
    if (this.options.showGrid) {
      ctx.strokeStyle = colGrid;
      ctx.lineWidth = 1;

      // Horizontal price grid (5 levels)
      const gridLevels = 5;
      for (let i = 0; i <= gridLevels; i++) {
        const p = minPrice + (priceRange / gridLevels) * i;
        const y = priceToY(p);
        ctx.beginPath();
        ctx.moveTo(this.padLeft, y);
        ctx.lineTo(width - this.padRight, y);
        ctx.stroke();

        // Price label on right axis
        ctx.fillStyle = colMuted;
        ctx.font = "10px monospace";
        ctx.textAlign = "left";
        ctx.fillText(
          `$${p.toLocaleString(undefined, { minimumFractionDigits: p < 10 ? 4 : 2 })}`,
          width - this.padRight + 6,
          y + 3,
        );
      }
    }

    // 2. Volume Profile (POC) Overlay (Right side of chart)
    if (this.options.showVolumeProfile && volumeProfile.length > 0) {
      const maxBarWidth = plotW * 0.25; // max 25% of chart width
      const barH = priceAreaH / volumeProfile.length;

      for (const node of volumeProfile) {
        const y = priceToY(node.priceLevel) - barH / 2;
        const barW = (node.percentage / 100) * maxBarWidth;
        const x = width - this.padRight - barW;

        ctx.fillStyle = node.isPOC
          ? "rgba(140, 170, 107, 0.28)" // POC sage olive glow
          : "rgba(216, 184, 118, 0.09)";
        ctx.fillRect(x, y, barW, Math.max(1, barH - 1));

        if (node.isPOC) {
          ctx.strokeStyle = colUp;
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, barW, Math.max(1, barH - 1));
        }
      }
    }

    // 3. Render Candlesticks and Volume Bars
    const candleCount = candles.length;
    const candleSpacing = plotW / candleCount;
    const candleWidth = Math.max(2, candleSpacing * 0.7);

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

    candles.forEach((c, i) => {
      const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
      const isUp = c.close >= c.open;
      const color = isUp ? colUp : colDown;

      // Volume bar at bottom
      const volH = maxVolume > 0 ? (c.volume / maxVolume) * volAreaH : 0;
      const volY = this.padTop + plotH - volH;
      ctx.fillStyle = isUp
        ? "rgba(140, 170, 107, 0.32)"
        : "rgba(193, 104, 78, 0.32)";
      ctx.fillRect(x - candleWidth / 2, volY, candleWidth, volH);

      // Wick (High - Low)
      const highY = priceToY(c.high);
      const lowY = priceToY(c.low);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body (Open - Close)
      const openY = priceToY(c.open);
      const closeY = priceToY(c.close);
      const bodyTop = Math.min(openY, closeY);
      const bodyH = Math.max(1.5, Math.abs(openY - closeY));

      ctx.fillStyle = color;
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyH);
    });

    // 4. VWAP Line Overlay
    if (this.options.showVWAP && vwap.length === candles.length) {
      ctx.strokeStyle = colAmber;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();

      candles.forEach((_, i) => {
        const x = this.padLeft + i * candleSpacing + candleSpacing / 2;
        const v = vwap[i]!;
        const y = priceToY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]); // reset dash

      // VWAP label on right axis
      const latestVWAP = vwap[vwap.length - 1]!;
      const vwapY = priceToY(latestVWAP);
      ctx.fillStyle = colAmber;
      ctx.fillRect(width - this.padRight, vwapY - 7, 72, 14);
      ctx.fillStyle = "#111210";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        `VWAP $${latestVWAP.toLocaleString(undefined, { maximumFractionDigits: 1 })}`,
        width - this.padRight + 4,
        vwapY + 3,
      );
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

        // Draw institutional campaign tag on left side of line
        const tagText = `🐋 ${camp.campaignId} ${camp.algoType} VWAP $${camp.vwapPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} ($${(camp.totalValueUsd / 1e6).toFixed(2)}M · ${camp.trancheCount}x)`;
        ctx.font = "bold 10px monospace";
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
          // Find closest candle in time or map to recent candles
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
      // Render Top Bid & Ask L2 Capital Concentration Bands
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
          const label = `${statusIcon} ${isBid ? "BID" : "ASK"} $${wall.priceBucket.toLocaleString()} ($${Math.round(wall.notionalUsd / 1000)}K · ${wall.shareOfSidePercent.toFixed(1)}%)`;
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

      // Render 50x & 100x Liquidation Magnet Lines
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

        const mLabel = `🧲 ${mag.tier} ${mag.side === "SHORT_LIQ_MAGNET" ? "SHORT LIQ" : "LONG LIQ"} $${mag.priceLevel.toLocaleString()} ($${(mag.estimatedPoolUsd / 1e6).toFixed(1)}M)`;
        ctx.font = "bold 9px monospace";
        const mtw = ctx.measureText(mLabel).width + 8;
        ctx.fillStyle = "rgba(44, 36, 18, 0.92)";
        ctx.fillRect(this.padLeft + 10, my - 7, mtw, 13);
        ctx.fillStyle = colAmber;
        ctx.textAlign = "left";
        ctx.fillText(mLabel, this.padLeft + 14, my + 2);
      }
    }

    // 5. Current Price Line & Badge
    const latestCandle = candles[candles.length - 1]!;
    const curY = priceToY(latestCandle.close);
    const curUp = latestCandle.close >= latestCandle.open;
    const curColor = curUp ? colUp : colDown;

    ctx.strokeStyle = curColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(this.padLeft, curY);
    ctx.lineTo(width - this.padRight, curY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price tag on scale
    ctx.fillStyle = curColor;
    ctx.fillRect(width - this.padRight, curY - 9, 74, 18);
    ctx.fillStyle = "#111210";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      `$${latestCandle.close.toLocaleString(undefined, { minimumFractionDigits: latestCandle.close < 10 ? 4 : 2 })}`,
      width - this.padRight + 4,
      curY + 4,
    );

    // 6. Interactive Crosshairs & Coordinate Tags
    if (this.hoverX !== null && this.hoverY !== null && hoverIdx >= 0) {
      const crossX =
        this.padLeft + hoverIdx * candleSpacing + candleSpacing / 2;
      const crossY = this.hoverY;

      ctx.strokeStyle = isLight
        ? "rgba(23, 24, 26, 0.35)"
        : "rgba(241, 238, 228, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(crossX, this.padTop);
      ctx.lineTo(crossX, height - this.padBottom);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(this.padLeft, crossY);
      ctx.lineTo(width - this.padRight, crossY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Hover Price Tag on right axis
      const hoverPrice = yToPrice(crossY);
      ctx.fillStyle = colText;
      ctx.fillRect(width - this.padRight, crossY - 8, 74, 16);
      ctx.fillStyle = colBg;
      ctx.font = "bold 10px monospace";
      ctx.fillText(
        `$${hoverPrice.toLocaleString(undefined, { minimumFractionDigits: hoverPrice < 10 ? 4 : 2 })}`,
        width - this.padRight + 4,
        crossY + 4,
      );

      // Hover Time Tag on bottom axis
      const hoverCandle = candles[hoverIdx]!;
      const timeStr = new Date(hoverCandle.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      ctx.fillStyle = colText;
      ctx.fillRect(crossX - 25, height - this.padBottom + 2, 50, 16);
      ctx.fillStyle = colBg;
      ctx.textAlign = "center";
      ctx.fillText(timeStr, crossX, height - this.padBottom + 14);
    }

    // 7. Institutional HUD Header
    this.renderHUD(ctx);
  }

  private renderHUD(ctx: CanvasRenderingContext2D): void {
    if (!this.data || this.data.candles.length === 0) return;

    const isLight =
      typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-theme") === "light";
    const colUp = isLight ? "#1e9e6b" : "#8caa6b";
    const colDown = isLight ? "#c8452e" : "#c1684e";
    const colAmber = isLight ? "#a6791f" : "#d8b876";
    const colMuted = isLight ? "#6f6d64" : "#b8b8ad";
    const colText = isLight ? "#17181a" : "#f1eee4";

    const c =
      this.hoveredCandle || this.data.candles[this.data.candles.length - 1]!;
    const chg = c.close - c.open;
    const chgPct = (chg / c.open) * 100;
    const color = chg >= 0 ? colUp : colDown;
    const sign = chg >= 0 ? "+" : "";

    ctx.font = "11px monospace";
    ctx.textAlign = "left";

    // Symbol & Timeframe badge
    ctx.fillStyle = colAmber;
    ctx.fillText(
      `${this.data.symbol} [${this.data.timeframe.toUpperCase()}]`,
      this.padLeft,
      16,
    );

    // O, H, L, C metrics
    let xOffset = this.padLeft + 120;
    const items = [
      {
        label: "O",
        val: `$${c.open.toLocaleString(undefined, { minimumFractionDigits: c.open < 10 ? 4 : 2 })}`,
        color: colText,
      },
      {
        label: "H",
        val: `$${c.high.toLocaleString(undefined, { minimumFractionDigits: c.high < 10 ? 4 : 2 })}`,
        color: colText,
      },
      {
        label: "L",
        val: `$${c.low.toLocaleString(undefined, { minimumFractionDigits: c.low < 10 ? 4 : 2 })}`,
        color: colText,
      },
      {
        label: "C",
        val: `$${c.close.toLocaleString(undefined, { minimumFractionDigits: c.close < 10 ? 4 : 2 })}`,
        color,
      },
      { label: "CHG", val: `${sign}${chgPct.toFixed(2)}%`, color },
      {
        label: "VOL",
        val: `${Math.round(c.volume).toLocaleString()}`,
        color: colUp,
      },
    ];

    if (c.vwap) {
      items.push({
        label: "VWAP",
        val: `$${c.vwap.toLocaleString(undefined, { maximumFractionDigits: 1 })}`,
        color: colAmber,
      });
    }

    items.forEach((item) => {
      ctx.fillStyle = colMuted;
      ctx.fillText(`${item.label}:`, xOffset, 16);
      xOffset += ctx.measureText(`${item.label}: `).width;

      ctx.fillStyle = item.color;
      ctx.fillText(item.val, xOffset, 16);
      xOffset += ctx.measureText(`${item.val}  `).width;
    });
  }

  private renderEmptyState(width: number, height: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#b8b8ad";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "Loading real-time candlestick data from Binance...",
      width / 2,
      height / 2,
    );
  }
}
