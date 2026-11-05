/**
 * Real Historical Returns Service
 * Fetches real 60-day daily klines from Binance Public REST API
 * to calculate real historical return series, volatility, covariance,
 * and correlation matrices for the BlackRock Aladdin Risk Engine.
 */

import { ReferenceData } from "../risk/sample-data.js";

export class HistoricalReturnsService {
  private static instance: HistoricalReturnsService | null = null;
  private returnsCache: Record<string, number[]> = {};
  private isFetching = false;
  private hasRealData = false;
  private listeners: Array<(returns: Record<string, number[]>) => void> = [];

  public static getInstance(): HistoricalReturnsService {
    if (!this.instance) {
      this.instance = new HistoricalReturnsService();
    }
    return this.instance;
  }

  constructor() {
    // Start with calibrated baseline while fetching live
    this.returnsCache = ReferenceData.getCalibratedReturns();
    this.loadFromStorage();
  }

  public getReturns(): Record<string, number[]> {
    return this.returnsCache;
  }

  public isLive(): boolean {
    return this.hasRealData;
  }

  public onReturnsUpdated(
    listener: (returns: Record<string, number[]>) => void,
  ): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Fetches real 60-day daily klines for key crypto assets
   */
  public async fetchRealReturns(
    symbols: string[] = [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
      "BNBUSDT",
      "XRPUSDT",
      "DOGEUSDT",
      "SUIUSDT",
      "AVAXUSDT",
    ],
  ): Promise<Record<string, number[]>> {
    if (this.isFetching) return this.returnsCache;
    this.isFetching = true;

    try {
      const fetchFn = typeof fetch !== "undefined" ? fetch : undefined;
      if (!fetchFn) {
        this.isFetching = false;
        return this.returnsCache;
      }

      const results = await Promise.allSettled(
        symbols.map(async (sym) => {
          const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=61`;
          const res = await fetchFn(url, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${sym}`);
          const raw = await res.json();
          if (!Array.isArray(raw) || raw.length < 5)
            throw new Error("Invalid klines payload");

          const closes: number[] = raw.map((k: any) => parseFloat(k[4]));
          const returns: number[] = [];
          for (let i = 1; i < closes.length; i++) {
            const prev = closes[i - 1];
            const curr = closes[i];
            if (prev !== undefined && curr !== undefined && prev > 0) {
              returns.push((curr - prev) / prev);
            }
          }
          return { sym, returns };
        }),
      );

      let successCount = 0;
      results.forEach((r) => {
        if (r.status === "fulfilled") {
          const { sym, returns } = r.value;
          const base = sym.replace("USDT", "");
          this.returnsCache[sym] = returns;
          this.returnsCache[base] = returns;
          successCount++;
        }
      });

      if (successCount > 0) {
        this.hasRealData = true;
        this.saveToStorage();
        this.notifyListeners();
      }
    } catch (err) {
      console.warn(
        "[HistoricalReturns] Failed to fetch real daily returns:",
        err,
      );
    } finally {
      this.isFetching = false;
    }

    return this.returnsCache;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.returnsCache);
      } catch (err) {
        console.error("[HistoricalReturns] Listener error:", err);
      }
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          "apex_real_daily_returns",
          JSON.stringify({
            timestamp: Date.now(),
            data: this.returnsCache,
          }),
        );
      }
    } catch {
      // storage unavailable
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage !== "undefined") {
        const item = localStorage.getItem("apex_real_daily_returns");
        if (item) {
          const parsed = JSON.parse(item);
          // 24 hour cache validity
          if (
            parsed &&
            parsed.data &&
            Date.now() - parsed.timestamp < 24 * 3600 * 1000
          ) {
            this.returnsCache = { ...this.returnsCache, ...parsed.data };
            this.hasRealData = true;
          }
        }
      }
    } catch {
      // ignore
    }
  }
}
