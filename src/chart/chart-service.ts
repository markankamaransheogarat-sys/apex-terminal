/**
 * Apex Terminal - Chart Data Service
 * Fetches real historical candlestick klines from Binance REST API,
 * calculates institutional VWAP and Volume Profile (POC),
 * and updates candles in real-time from incoming live WebSocket ticks.
 */

import {
  Candle,
  ChartData,
  ChartTimeframe,
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
    limit: number = 100,
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
    };
  }

  private getTimeframeDurationMs(tf: ChartTimeframe): number {
    switch (tf) {
      case "1m":
        return 60 * 1000;
      case "5m":
        return 5 * 60 * 1000;
      case "15m":
        return 15 * 60 * 1000;
      case "1h":
        return 60 * 60 * 1000;
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
