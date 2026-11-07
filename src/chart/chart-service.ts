/**
 * Apex Terminal - Chart Data Service
 * Fetches real historical candlestick klines from Binance REST API,
 * calculates institutional VWAP, Volume Profile (POC), Smart Money Concepts (SMC:
 * Fair Value Gaps, BOS/CHoCH Structure Breaks, Institutional Order Blocks),
 * MACD (12, 26, 9), and Bollinger Bands (20, 2),
 * and updates candles in real-time from incoming live WebSocket ticks.
 */

import {
  BollingerBandPoint,
  Candle,
  ChartData,
  ChartTimeframe,
  FairValueGap,
  MacdPoint,
  OrderBlockZone,
  SmartMoneyAnalysis,
  StructureBreak,
  VolumeProfileNode,
} from "./types.js";

export class ChartService {
  private candles: Candle[] = [];
  private currentSymbol: string = "BTCUSDT";
  private currentTimeframe: ChartTimeframe = "1h";
  private isFetching: boolean = false;
  private listeners: Array<(data: ChartData) => void> = [];

  constructor(symbol: string = "BTCUSDT", timeframe: ChartTimeframe = "1h") {
    this.currentSymbol = symbol;
    this.currentTimeframe = timeframe;
  }

  public isFetchingCandles(): boolean {
    return this.isFetching;
  }

  public getSymbol(): string {
    return this.currentSymbol;
  }

  public getTimeframe(): ChartTimeframe {
    return this.currentTimeframe;
  }

  public onChartUpdate(listener: (data: ChartData) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public async loadCandles(
    symbol: string = this.currentSymbol,
    timeframe: ChartTimeframe = this.currentTimeframe,
    limit: number = 120,
  ): Promise<ChartData> {
    this.currentSymbol = symbol.toUpperCase();
    this.currentTimeframe = timeframe;
    this.isFetching = true;

    try {
      const fetchFn = typeof fetch !== "undefined" ? fetch : undefined;
      if (!fetchFn) {
        return this.generateSyntheticCandles(limit);
      }

      const formattedSym = this.currentSymbol.endsWith("USDT")
        ? this.currentSymbol
        : `${this.currentSymbol}USDT`;

      const url = `https://api.binance.com/api/v3/klines?symbol=${formattedSym}&interval=${this.currentTimeframe}&limit=${limit}`;
      const res = await fetchFn(url, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`Binance klines HTTP ${res.status}`);
      }

      const raw = (await res.json()) as any[];
      if (!Array.isArray(raw)) {
        throw new Error("Invalid klines response");
      }

      this.candles = raw.map((k) => ({
        timestamp: Number(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      const data = this.buildChartData();
      this.notify(data);
      return data;
    } catch (err) {
      console.warn(
        "[ChartService] Failed to load Binance klines, generating fallback:",
        err,
      );
      const fallback = this.generateSyntheticCandles(limit);
      this.notify(fallback);
      return fallback;
    } finally {
      this.isFetching = false;
    }
  }

  /**
   * Process a live price tick from WebSocket and update the active candle
   */
  public updateWithLiveTick(
    price: number,
    quantity: number = 0,
    timestamp: number = Date.now(),
  ): ChartData | null {
    if (this.candles.length === 0) return null;

    const lastCandle = this.candles[this.candles.length - 1]!;
    const timeframeMs = this.getTimeframeDurationMs(this.currentTimeframe);
    const candleElapsed = timestamp - lastCandle.timestamp;

    if (candleElapsed >= timeframeMs) {
      // Create new candle
      const newCandle: Candle = {
        timestamp: lastCandle.timestamp + timeframeMs,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: quantity,
      };
      this.candles.push(newCandle);
      if (this.candles.length > 150) {
        this.candles.shift();
      }
    } else {
      // Update existing candle
      lastCandle.close = price;
      if (price > lastCandle.high) lastCandle.high = price;
      if (price < lastCandle.low) lastCandle.low = price;
      lastCandle.volume += quantity;
    }

    const data = this.buildChartData();
    this.notify(data);
    return data;
  }

  public buildChartData(): ChartData {
    if (this.candles.length === 0) {
      return {
        symbol: this.currentSymbol,
        timeframe: this.currentTimeframe,
        candles: [],
        vwap: [],
        volumeProfile: [],
        minPrice: 0,
        maxPrice: 0,
        maxVolume: 0,
        pointOfControlPrice: 0,
        smc: { fairValueGaps: [], structureBreaks: [], orderBlocks: [] },
        macd: [],
        bollinger: [],
      };
    }

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVolume = 0;

    let cumTypicalVol = 0;
    let cumVol = 0;
    const vwapValues: number[] = [];

    for (const c of this.candles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.volume > maxVolume) maxVolume = c.volume;

      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumTypicalVol += typicalPrice * c.volume;
      cumVol += c.volume;
      const vwap = cumVol > 0 ? cumTypicalVol / cumVol : c.close;
      c.vwap = vwap;
      vwapValues.push(vwap);
    }

    // Calculate Volume Profile (24 price bins)
    const binCount = 24;
    const priceRange = maxPrice - minPrice;
    const binHeight = priceRange > 0 ? priceRange / binCount : 1;
    const bins: number[] = new Array(binCount).fill(0);

    for (const c of this.candles) {
      const binIdx = Math.min(
        binCount - 1,
        Math.max(0, Math.floor((c.close - minPrice) / binHeight)),
      );
      bins[binIdx] = (bins[binIdx] ?? 0) + c.volume;
    }

    const maxBinVol = Math.max(...bins, 1);
    let pocIdx = 0;
    let highestVol = 0;

    bins.forEach((vol, idx) => {
      if (vol > highestVol) {
        highestVol = vol;
        pocIdx = idx;
      }
    });

    const volumeProfile: VolumeProfileNode[] = bins.map((vol, idx) => ({
      priceLevel: minPrice + (idx + 0.5) * binHeight,
      volume: vol,
      percentage: (vol / maxBinVol) * 100,
      isPOC: idx === pocIdx,
    }));

    const pointOfControlPrice = minPrice + (pocIdx + 0.5) * binHeight;
    const smc = ChartService.detectSmartMoneyConcepts(this.candles);
    const macd = ChartService.calculateMACD(this.candles);
    const bollinger = ChartService.calculateBollingerBands(this.candles);

    return {
      symbol: this.currentSymbol,
      timeframe: this.currentTimeframe,
      candles: [...this.candles],
      vwap: vwapValues,
      volumeProfile,
      minPrice,
      maxPrice,
      maxVolume,
      pointOfControlPrice,
      smc,
      macd,
      bollinger,
    };
  }

  /**
   * Institutional Smart Money Concepts (SMC) Engine:
   * - Detects 3-candle Fair Value Gaps (FVG / Price Imbalances)
   * - Detects Swing High / Swing Low Structure Breaks (BOS & CHoCH)
   * - Detects Institutional Order Blocks (Bullish OB / Bearish OB)
   */
  public static detectSmartMoneyConcepts(
    candles: Candle[],
  ): SmartMoneyAnalysis {
    const fairValueGaps: FairValueGap[] = [];
    const structureBreaks: StructureBreak[] = [];
    const orderBlocks: OrderBlockZone[] = [];

    if (candles.length < 6) {
      return { fairValueGaps, structureBreaks, orderBlocks };
    }

    // 1. Fair Value Gaps (FVG)
    for (let i = 2; i < candles.length; i++) {
      const c0 = candles[i - 2]!;
      const c1 = candles[i - 1]!;
      const c2 = candles[i]!;
      const midBody = Math.abs(c1.close - c1.open);
      const avgRange = (c0.high - c0.low + (c2.high - c2.low)) / 2 || 1;

      // Bullish FVG: candle[i-2].high < candle[i].low with displacement
      if (c2.low > c0.high && midBody > avgRange * 0.35) {
        let mitigated = false;
        for (let k = i + 1; k < candles.length; k++) {
          if (candles[k]!.low <= c0.high) {
            mitigated = true;
            break;
          }
        }
        fairValueGaps.push({
          startIndex: i - 1,
          topPrice: c2.low,
          bottomPrice: c0.high,
          type: "BULLISH",
          mitigated,
        });
      }
      // Bearish FVG: candle[i-2].low > candle[i].high with displacement
      else if (c2.high < c0.low && midBody > avgRange * 0.35) {
        let mitigated = false;
        for (let k = i + 1; k < candles.length; k++) {
          if (candles[k]!.high >= c0.low) {
            mitigated = true;
            break;
          }
        }
        fairValueGaps.push({
          startIndex: i - 1,
          topPrice: c0.low,
          bottomPrice: c2.high,
          type: "BEARISH",
          mitigated,
        });
      }
    }

    // 2. Swing Pivots -> BOS / CHoCH & Order Blocks
    let lastSwingHighIdx = -1;
    let lastSwingHighPrice = -Infinity;
    let lastSwingLowIdx = -1;
    let lastSwingLowPrice = Infinity;
    let currentTrend: "BULL" | "BEAR" | "NEUTRAL" = "NEUTRAL";

    const lookback = 3;
    for (let i = lookback; i < candles.length - 1; i++) {
      // Check if index (i - 2) was a 2-bar pivot high / low
      const pIdx = i - 2;
      if (pIdx >= 2) {
        const p = candles[pIdx]!;
        const isPivotHigh =
          p.high >= candles[pIdx - 1]!.high &&
          p.high >= candles[pIdx - 2]!.high &&
          p.high >= candles[pIdx + 1]!.high &&
          p.high >= candles[pIdx + 2]!.high;
        const isPivotLow =
          p.low <= candles[pIdx - 1]!.low &&
          p.low <= candles[pIdx - 2]!.low &&
          p.low <= candles[pIdx + 1]!.low &&
          p.low <= candles[pIdx + 2]!.low;

        if (isPivotHigh) {
          lastSwingHighIdx = pIdx;
          lastSwingHighPrice = p.high;
        }
        if (isPivotLow) {
          lastSwingLowIdx = pIdx;
          lastSwingLowPrice = p.low;
        }
      }

      const cur = candles[i]!;
      // Bullish Break above Last Swing High
      if (
        lastSwingHighIdx >= 0 &&
        i - lastSwingHighIdx <= 35 &&
        cur.close > lastSwingHighPrice
      ) {
        const breakType = currentTrend === "BEAR" ? "CHOCH_BULL" : "BOS_BULL";
        structureBreaks.push({
          startIndex: lastSwingHighIdx,
          breakIndex: i,
          price: lastSwingHighPrice,
          type: breakType,
        });

        // Find last bearish candle between swing high and break as Bullish Order Block
        for (let k = i - 1; k >= Math.max(0, lastSwingHighIdx - 3); k--) {
          const obCandle = candles[k]!;
          if (obCandle.close < obCandle.open) {
            orderBlocks.push({
              candleIndex: k,
              high: obCandle.high,
              low: obCandle.low,
              type: "BULL_OB",
              volumeUsd: obCandle.volume * obCandle.close,
            });
            break;
          }
        }

        currentTrend = "BULL";
        lastSwingHighIdx = -1; // consumed
      }

      // Bearish Break below Last Swing Low
      if (
        lastSwingLowIdx >= 0 &&
        i - lastSwingLowIdx <= 35 &&
        cur.close < lastSwingLowPrice
      ) {
        const breakType = currentTrend === "BULL" ? "CHOCH_BEAR" : "BOS_BEAR";
        structureBreaks.push({
          startIndex: lastSwingLowIdx,
          breakIndex: i,
          price: lastSwingLowPrice,
          type: breakType,
        });

        // Find last bullish candle before bearish break as Bearish Order Block
        for (let k = i - 1; k >= Math.max(0, lastSwingLowIdx - 3); k--) {
          const obCandle = candles[k]!;
          if (obCandle.close > obCandle.open) {
            orderBlocks.push({
              candleIndex: k,
              high: obCandle.high,
              low: obCandle.low,
              type: "BEAR_OB",
              volumeUsd: obCandle.volume * obCandle.close,
            });
            break;
          }
        }

        currentTrend = "BEAR";
        lastSwingLowIdx = -1; // consumed
      }
    }

    return {
      fairValueGaps: fairValueGaps.slice(-8),
      structureBreaks: structureBreaks.slice(-8),
      orderBlocks: orderBlocks.slice(-5),
    };
  }

  /**
   * Calculates institutional MACD (12, 26, 9)
   */
  public static calculateMACD(
    candles: Candle[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9,
  ): MacdPoint[] {
    if (candles.length === 0) return [];
    const kFast = 2 / (fastPeriod + 1);
    const kSlow = 2 / (slowPeriod + 1);
    const kSig = 2 / (signalPeriod + 1);

    let emaFast = candles[0]!.close;
    let emaSlow = candles[0]!.close;
    let emaSignal = 0;

    const result: MacdPoint[] = [];
    for (let i = 0; i < candles.length; i++) {
      const price = candles[i]!.close;
      emaFast = i === 0 ? price : price * kFast + emaFast * (1 - kFast);
      emaSlow = i === 0 ? price : price * kSlow + emaSlow * (1 - kSlow);
      const macd = emaFast - emaSlow;
      emaSignal = i === 0 ? macd : macd * kSig + emaSignal * (1 - kSig);
      const histogram = macd - emaSignal;
      result.push({ macd, signal: emaSignal, histogram });
    }
    return result;
  }

  /**
   * Calculates Bollinger Bands (SMA period + ±mult * standard deviation)
   */
  public static calculateBollingerBands(
    candles: Candle[],
    period: number = 20,
    stdDevMult: number = 2,
  ): BollingerBandPoint[] {
    const out: BollingerBandPoint[] = [];
    for (let i = 0; i < candles.length; i++) {
      const start = Math.max(0, i - period + 1);
      const slice = candles.slice(start, i + 1);
      const mean =
        slice.reduce((acc, c) => acc + c.close, 0) / (slice.length || 1);
      const variance =
        slice.reduce((acc, c) => acc + Math.pow(c.close - mean, 2), 0) /
        (slice.length || 1);
      const sd = Math.sqrt(variance);
      out.push({
        upper: mean + stdDevMult * sd,
        middle: mean,
        lower: mean - stdDevMult * sd,
      });
    }
    return out;
  }

  public getTimeframeDurationMs(tf: ChartTimeframe): number {
    switch (tf) {
      case "1m":
        return 60 * 1000;
      case "5m":
        return 5 * 60 * 1000;
      case "15m":
        return 15 * 60 * 1000;
      case "1h":
        return 60 * 60 * 1000;
      case "4h":
        return 4 * 60 * 60 * 1000;
      case "1d":
        return 24 * 60 * 60 * 1000;
      case "1w":
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  private generateSyntheticCandles(count: number): ChartData {
    const basePrice = this.currentSymbol.startsWith("BTC")
      ? 77000
      : this.currentSymbol.startsWith("ETH")
        ? 2300
        : this.currentSymbol.startsWith("SOL")
          ? 135
          : 500;

    const now = Date.now();
    const intervalMs = this.getTimeframeDurationMs(this.currentTimeframe);
    let current = basePrice;
    this.candles = [];

    for (let i = count; i >= 0; i--) {
      const change = (Math.random() - 0.49) * (basePrice * 0.015);
      const open = current;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * (basePrice * 0.008);
      const low = Math.min(open, close) - Math.random() * (basePrice * 0.008);
      const volume = Math.random() * 500 + 50;

      this.candles.push({
        timestamp: now - i * intervalMs,
        open,
        high,
        low,
        close,
        volume,
      });

      current = close;
    }

    return this.buildChartData();
  }

  private notify(data: ChartData): void {
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (err) {
        console.error("[ChartService] Listener error:", err);
      }
    }
  }
}
