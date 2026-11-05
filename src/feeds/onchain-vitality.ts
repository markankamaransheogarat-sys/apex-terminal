/**
 * Apex Terminal - On-Chain Vitality & Open Interest Aggregator
 * Pulls live zero-key Bitcoin Mempool fee dynamics and Binance Futures Open Interest.
 */

export interface MempoolFees {
  fastestFee: number; // sat/vB
  halfHourFee: number;
  hourFee: number;
  minimumFee: number;
  timestamp: number;
}

export interface OpenInterestData {
  symbol: string;
  asset: string;
  openInterestCoins: number;
  openInterestUsd: number;
  timestamp: number;
}

export interface OnChainVitalitySnapshot {
  mempool: MempoolFees | null;
  openInterest: Map<string, OpenInterestData>;
  totalTrackedOiUsd: number;
  lastUpdated: number;
}

export class OnChainVitalityService {
  private static readonly OI_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "DOGEUSDT",
  ];

  private cachedMempool: MempoolFees | null = null;
  private cachedOi: Map<string, OpenInterestData> = new Map();
  private lastUpdate = 0;

  constructor(
    private readonly fetchImpl: typeof fetch = typeof fetch !== "undefined"
      ? fetch
      : (null as any),
  ) {}

  public async fetchMempoolFees(): Promise<MempoolFees | null> {
    if (!this.fetchImpl) return null;
    try {
      const res = await this.fetchImpl(
        "https://mempool.space/api/v1/fees/recommended",
        {
          headers: { Accept: "application/json" },
        },
      );
      if (!res.ok) return this.cachedMempool;
      const data = await res.json();
      this.cachedMempool = {
        fastestFee: data.fastestFee ?? 10,
        halfHourFee: data.halfHourFee ?? 8,
        hourFee: data.hourFee ?? 6,
        minimumFee: data.minimumFee ?? 1,
        timestamp: Date.now(),
      };
      return this.cachedMempool;
    } catch {
      return this.cachedMempool;
    }
  }

  public async fetchOpenInterest(
    currentPrices: Map<string, number>,
  ): Promise<Map<string, OpenInterestData>> {
    if (!this.fetchImpl) return this.cachedOi;

    for (const sym of OnChainVitalityService.OI_SYMBOLS) {
      try {
        const res = await this.fetchImpl(
          `https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`,
          {
            headers: { Accept: "application/json" },
          },
        );
        if (res.ok) {
          const data = await res.json();
          const coins = parseFloat(data.openInterest || "0");
          const price =
            currentPrices.get(sym) ||
            (sym === "BTCUSDT" ? 94000 : sym === "ETHUSDT" ? 3400 : 200);
          const usd = coins * price;
          const asset = sym.replace("USDT", "");

          this.cachedOi.set(sym, {
            symbol: sym,
            asset,
            openInterestCoins: coins,
            openInterestUsd: usd,
            timestamp: data.time || Date.now(),
          });
        }
      } catch {}
    }

    this.lastUpdate = Date.now();
    return this.cachedOi;
  }

  public getSnapshot(): OnChainVitalitySnapshot {
    let totalOi = 0;
    this.cachedOi.forEach((item) => {
      totalOi += item.openInterestUsd;
    });

    return {
      mempool: this.cachedMempool,
      openInterest: new Map(this.cachedOi),
      totalTrackedOiUsd: totalOi,
      lastUpdated: this.lastUpdate,
    };
  }
}
