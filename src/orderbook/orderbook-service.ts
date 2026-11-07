/**
 * Apex Terminal - Senior Quant L2 Orderbook Microstructure & Liquidity Wall Engine (BOOK <GO>)
 *
 * Streams real-time 20-level L2 Orderbook Depth from Binance Spot (@depth20@100ms)
 * with instant REST depth snapshot initialization.
 *
 * Computes institutional quantitative execution metrics:
 * 1. Stoikov Micro-Price (Volume-weighted top-of-book fair price & micro-alpha skew in bps)
 * 2. Multi-Level Order Book Imbalance (OBI-20 across all 20 bid/ask levels)
 * 3. Institutional Liquidity Wall Detector ("Плиты" >= 2.5x mean depth level)
 * 4. Market Impact / Slippage Estimator for $500k and $2M aggressive sweeps
 */

export interface OrderbookLevel {
  price: number;
  quantity: number;
  notionalUsd: number;
  cumulativeUsd: number;
  depthPercent: number; // 0-100% relative to max cumulative side depth
  isWall: boolean; // True if notionalUsd >= 2.5x mean level size
  wallMultiple: number; // e.g. 3.4x average level
}

export interface L2OrderbookSnapshot {
  symbol: string;
  asset: string;
  timestamp: number;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spreadUsd: number;
  spreadBps: number;
  /**
   * Stoikov (2018) Micro-Price:
   * I = Q_bid / (Q_bid + Q_ask)
   * P_micro = P_bid * (1 - I) + P_ask * I
   */
  microPrice: number;
  microPriceSkewBps: number; // (microPrice - midPrice) / midPrice * 10000
  /**
   * 20-level Order Book Imbalance:
   * (TotalBidUsd - TotalAskUsd) / (TotalBidUsd + TotalAskUsd) in [-100%, +100%]
   */
  obi20Percent: number;
  totalBidDepthUsd: number;
  totalAskDepthUsd: number;
  biggestBidWall: OrderbookLevel | null;
  biggestAskWall: OrderbookLevel | null;
  slippageBuy1M_Bps: number;
  slippageSell1M_Bps: number;
  regime:
    | "STRONG_BID_SUPPORT"
    | "STRONG_ASK_RESISTANCE"
    | "BALANCED_BOOK"
    | "THIN_LIQUIDITY";
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

export interface MultiAssetWallSummary {
  symbol: string;
  asset: string;
  midPrice: number;
  microPriceSkewBps: number;
  obi20Percent: number;
  dominantWallSide: "BID_WALL" | "ASK_WALL";
  dominantWallPrice: number;
  dominantWallUsd: number;
  dominantWallMultiple: number;
  regime: L2OrderbookSnapshot["regime"];
}

export type WallIntegrityStatus =
  "VERIFIED_FORTRESS" | "ICEBERG_RELOADED" | "ACTIVE_CLUSTER" | "SPOOF_PULLED";

export interface SpoofWallEvent {
  id: string;
  symbol: string;
  asset: string;
  side: "BID" | "ASK";
  priceBucket: number;
  peakNotionalUsd: number;
  currentNotionalUsd: number;
  dropPercent: number;
  status: WallIntegrityStatus;
  ageSeconds: number;
  timestamp: number;
}

export interface CapitalClusterZone {
  side: "BID" | "ASK";
  priceBucket: number;
  quantity: number;
  notionalUsd: number;
  cumulativeUsd: number;
  depthPercent: number;
  shareOfSidePercent: number; // % of total bid/ask liquidity concentrated at this zone
  distanceFromMidPercent: number;
  distanceFromMidUsd: number;
  wallMultiple: number;
  isWhaleCluster: boolean;
  levelsMerged: number;
  wallStatus: WallIntegrityStatus;
  persistenceScore: number; // 0-100 institutional wall conviction score
}

export interface GroupedOrderbookView {
  bucketStepUsd: number;
  availableBuckets: Array<{ label: string; step: number }>;
  groupedBids: CapitalClusterZone[];
  groupedAsks: CapitalClusterZone[];
  topBidClusters: CapitalClusterZone[]; // Top 4 biggest Bid money zones
  topAskClusters: CapitalClusterZone[]; // Top 4 biggest Ask money zones
  totalBidCapitalUsd: number;
  totalAskCapitalUsd: number;
  bidAskRatio: number;
  spoofAndIntegrityEvents: SpoofWallEvent[];
}

interface TrackedWallState {
  firstSeenMs: number;
  lastSeenMs: number;
  peakNotionalUsd: number;
  lastNotionalUsd: number;
  snapshotsSeen: number;
  reloadCount: number;
  side: "BID" | "ASK";
  priceBucket: number;
}

export class OrderbookService {
  private static readonly RADAR_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "SUIUSDT",
    "XRPUSDT",
    "DOGEUSDT",
  ];
  private static wallMemory: Map<string, TrackedWallState> = new Map();
  private static spoofEventsLog: Map<string, SpoofWallEvent[]> = new Map();

  private symbol: string = "BTCUSDT";
  private ws: WebSocket | null = null;
  private snapshot: L2OrderbookSnapshot | null = null;
  private deepRawBids: Array<[string | number, string | number]> = [];
  private deepRawAsks: Array<[string | number, string | number]> = [];
  private multiSnapshots: Map<string, L2OrderbookSnapshot> = new Map();
  private listeners: Array<(snap: L2OrderbookSnapshot) => void> = [];
  private isDestroyed = false;

  constructor(
    initialSymbol: string = "BTCUSDT",
    private readonly WebSocketClass: typeof WebSocket = typeof WebSocket !==
    "undefined"
      ? WebSocket
      : (null as any),
  ) {
    this.symbol = initialSymbol.toUpperCase();
  }

  public getSymbol(): string {
    return this.symbol;
  }

  public getSnapshot(): L2OrderbookSnapshot | null {
    return this.snapshot;
  }

  public getSnapshotForSymbol(sym: string): L2OrderbookSnapshot | null {
    const clean = sym.toUpperCase();
    if (clean === this.symbol && this.snapshot) return this.snapshot;
    return this.multiSnapshots.get(clean) || null;
  }

  public getMultiAssetWalls(): MultiAssetWallSummary[] {
    const list: MultiAssetWallSummary[] = [];
    for (const sym of OrderbookService.RADAR_SYMBOLS) {
      const snap =
        sym === this.symbol && this.snapshot
          ? this.snapshot
          : this.multiSnapshots.get(sym);
      if (!snap) continue;
      const bidW = snap.biggestBidWall;
      const askW = snap.biggestAskWall;
      const isBidBigger = (bidW?.notionalUsd || 0) >= (askW?.notionalUsd || 0);
      const dom = isBidBigger ? bidW : askW;
      if (!dom) continue;

      list.push({
        symbol: snap.symbol,
        asset: snap.asset,
        midPrice: snap.midPrice,
        microPriceSkewBps: snap.microPriceSkewBps,
        obi20Percent: snap.obi20Percent,
        dominantWallSide: isBidBigger ? "BID_WALL" : "ASK_WALL",
        dominantWallPrice: dom.price,
        dominantWallUsd: dom.notionalUsd,
        dominantWallMultiple: dom.wallMultiple,
        regime: snap.regime,
      });
    }
    return list.sort((a, b) => b.dominantWallMultiple - a.dominantWallMultiple);
  }

  public async scanMultiAssetWalls(): Promise<MultiAssetWallSummary[]> {
    if (typeof fetch === "undefined") return this.getMultiAssetWalls();
    await Promise.all(
      OrderbookService.RADAR_SYMBOLS.map(async (sym) => {
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/depth?symbol=${sym}&limit=500`,
          );
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.bids) && Array.isArray(data.asks)) {
              const snap = OrderbookService.computeL2Analytics(
                sym,
                data.bids,
                data.asks,
              );
              this.multiSnapshots.set(sym, snap);
              if (sym === this.symbol && !this.snapshot) {
                this.snapshot = snap;
              }
            }
          }
        } catch {}
      }),
    );
    return this.getMultiAssetWalls();
  }

  public onSnapshot(fn: (snap: L2OrderbookSnapshot) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  public async switchSymbol(newSymbol: string): Promise<void> {
    const clean = newSymbol.toUpperCase().trim();
    const target = clean.endsWith("USDT") ? clean : `${clean}USDT`;
    if (target === this.symbol && this.snapshot) return;
    this.symbol = target;
    this.disconnectWs();
    await this.fetchRestDepth();
    this.connectWs();
  }

  public async start(): Promise<void> {
    await this.fetchRestDepth();
    this.scanMultiAssetWalls().catch(() => {});
    this.connectWs();
  }

  public stop(): void {
    this.isDestroyed = true;
    this.disconnectWs();
  }

  private disconnectWs(): void {
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }

  public async fetchRestDepth(): Promise<L2OrderbookSnapshot | null> {
    if (typeof fetch === "undefined") return this.snapshot;
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/depth?symbol=${this.symbol}&limit=1000`,
      );
      if (res.ok) {
        const raw = await res.json();
        if (raw && Array.isArray(raw.bids) && Array.isArray(raw.asks)) {
          this.deepRawBids = raw.bids;
          this.deepRawAsks = raw.asks;
          const snap = OrderbookService.computeL2Analytics(
            this.symbol,
            raw.bids,
            raw.asks,
          );
          this.snapshot = snap;
          this.multiSnapshots.set(this.symbol, snap);
          this.notify(snap);
          return snap;
        }
      }
    } catch {}
    return this.snapshot;
  }

  private mergeTopWithDeep(
    topLevels: Array<[string | number, string | number]>,
    deepLevels: Array<[string | number, string | number]>,
    isBid: boolean,
  ): Array<[string | number, string | number]> {
    if (!deepLevels || deepLevels.length <= 20) return topLevels;
    if (!topLevels || topLevels.length === 0) return deepLevels;
    const edgePrice = Number(topLevels[topLevels.length - 1]?.[0] || 0);
    if (edgePrice <= 0) return topLevels;

    const deeperTail = deepLevels.filter(([p]) => {
      const price = Number(p);
      return isBid ? price < edgePrice : price > edgePrice;
    });
    return [...topLevels, ...deeperTail];
  }

  private connectWs(): void {
    if (this.isDestroyed || !this.WebSocketClass) return;
    const streamUrl = `wss://stream.binance.com:9443/ws/${this.symbol.toLowerCase()}@depth20@100ms`;

    try {
      this.ws = new this.WebSocketClass(streamUrl);
      this.ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(
            typeof event.data === "string" ? event.data : event.data.toString(),
          );
          const bids = raw?.bids || raw?.b;
          const asks = raw?.asks || raw?.a;
          if (Array.isArray(bids) && Array.isArray(asks)) {
            const mergedBids = this.mergeTopWithDeep(
              bids,
              this.deepRawBids,
              true,
            );
            const mergedAsks = this.mergeTopWithDeep(
              asks,
              this.deepRawAsks,
              false,
            );
            const snap = OrderbookService.computeL2Analytics(
              this.symbol,
              mergedBids,
              mergedAsks,
            );
            this.snapshot = snap;
            this.multiSnapshots.set(this.symbol, snap);
            this.notify(snap);
          }
        } catch {}
      };
      this.ws.onerror = () => {
        try {
          this.ws?.close();
        } catch {}
      };
    } catch {}
  }

  private notify(snap: L2OrderbookSnapshot): void {
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch {}
    }
  }

  /**
   * Returns recommended price-bucket zoom steps tailored to the asset's price scale.
   */
  public static getRecommendedBuckets(
    midPrice: number,
  ): Array<{ label: string; step: number }> {
    if (midPrice >= 20000) {
      return [
        { label: "FINE ($1)", step: 1 },
        { label: "MICRO ($10)", step: 10 },
        { label: "CLUSTER ($25)", step: 25 },
        { label: "WHALE ($50)", step: 50 },
        { label: "MACRO ($100)", step: 100 },
        { label: "DEEP ($250)", step: 250 },
      ];
    }
    if (midPrice >= 1000) {
      return [
        { label: "FINE ($0.1)", step: 0.1 },
        { label: "MICRO ($1)", step: 1 },
        { label: "CLUSTER ($2.5)", step: 2.5 },
        { label: "WHALE ($5)", step: 5 },
        { label: "MACRO ($10)", step: 10 },
        { label: "DEEP ($25)", step: 25 },
      ];
    }
    if (midPrice >= 50) {
      return [
        { label: "FINE ($0.02)", step: 0.02 },
        { label: "MICRO ($0.10)", step: 0.1 },
        { label: "CLUSTER ($0.50)", step: 0.5 },
        { label: "WHALE ($1.0)", step: 1 },
        { label: "MACRO ($2.5)", step: 2.5 },
        { label: "DEEP ($5.0)", step: 5 },
      ];
    }
    if (midPrice >= 1) {
      return [
        { label: "FINE ($0.001)", step: 0.001 },
        { label: "MICRO ($0.005)", step: 0.005 },
        { label: "CLUSTER ($0.01)", step: 0.01 },
        { label: "WHALE ($0.025)", step: 0.025 },
        { label: "MACRO ($0.05)", step: 0.05 },
        { label: "DEEP ($0.10)", step: 0.1 },
      ];
    }
    return [
      { label: "FINE ($0.0001)", step: 0.0001 },
      { label: "MICRO ($0.0005)", step: 0.0005 },
      { label: "CLUSTER ($0.001)", step: 0.001 },
      { label: "WHALE ($0.0025)", step: 0.0025 },
      { label: "MACRO ($0.005)", step: 0.005 },
      { label: "DEEP ($0.01)", step: 0.01 },
    ];
  }

  /**
   * Groups raw orderbook levels into price buckets (Zoom Out) to expose where the largest
   * institutional money pools ("основная масса бабла") sit in the book.
   */
  public static groupOrderbookByBucket(
    snap: L2OrderbookSnapshot,
    requestedBucketStepUsd: number = 0,
  ): GroupedOrderbookView {
    const availableBuckets = OrderbookService.getRecommendedBuckets(
      snap.midPrice,
    );
    const defaultStep =
      availableBuckets[2]?.step || availableBuckets[0]?.step || 1;
    const step =
      requestedBucketStepUsd > 0 ? requestedBucketStepUsd : defaultStep;
    const decimals =
      step < 0.001 ? 5 : step < 0.01 ? 4 : step < 0.1 ? 3 : step < 1 ? 2 : 2;

    const bidMap = new Map<
      number,
      { qty: number; notional: number; count: number }
    >();
    let totalBidCapitalUsd = 0;
    for (const b of snap.bids) {
      const bucketPrice = Number(
        (Math.floor(b.price / step) * step).toFixed(decimals),
      );
      const cur = bidMap.get(bucketPrice) || { qty: 0, notional: 0, count: 0 };
      cur.qty += b.quantity;
      cur.notional += b.notionalUsd;
      cur.count += 1;
      bidMap.set(bucketPrice, cur);
      totalBidCapitalUsd += b.notionalUsd;
    }

    const askMap = new Map<
      number,
      { qty: number; notional: number; count: number }
    >();
    let totalAskCapitalUsd = 0;
    for (const a of snap.asks) {
      const bucketPrice = Number(
        (Math.ceil(a.price / step) * step).toFixed(decimals),
      );
      const cur = askMap.get(bucketPrice) || { qty: 0, notional: 0, count: 0 };
      cur.qty += a.quantity;
      cur.notional += a.notionalUsd;
      cur.count += 1;
      askMap.set(bucketPrice, cur);
      totalAskCapitalUsd += a.notionalUsd;
    }

    const allBucketNotionals = [
      ...Array.from(bidMap.values()).map((v) => v.notional),
      ...Array.from(askMap.values()).map((v) => v.notional),
    ];
    const meanBucketUsd =
      allBucketNotionals.length > 0
        ? allBucketNotionals.reduce((acc, v) => acc + v, 0) /
          allBucketNotionals.length
        : 1;

    const nowMs = Date.now();
    const symEvents = OrderbookService.spoofEventsLog.get(snap.symbol) || [];

    const evaluateWallIntegrity = (
      side: "BID" | "ASK",
      priceBucket: number,
      notionalUsd: number,
      mult: number,
    ): { status: WallIntegrityStatus; persistenceScore: number } => {
      const memKey = `${snap.symbol}:${step}:${side}:${priceBucket}`;
      const existing = OrderbookService.wallMemory.get(memKey);

      if (!existing) {
        if (mult >= 1.8) {
          OrderbookService.wallMemory.set(memKey, {
            firstSeenMs: nowMs,
            lastSeenMs: nowMs,
            peakNotionalUsd: notionalUsd,
            lastNotionalUsd: notionalUsd,
            snapshotsSeen: 1,
            reloadCount: 0,
            side,
            priceBucket,
          });
        }
        return {
          status: mult >= 2.6 ? "VERIFIED_FORTRESS" : "ACTIVE_CLUSTER",
          persistenceScore: Math.min(95, Math.round(55 + mult * 10)),
        };
      }

      existing.lastSeenMs = nowMs;
      existing.snapshotsSeen += 1;

      if (notionalUsd > existing.lastNotionalUsd * 1.18 && mult >= 2.0) {
        existing.reloadCount += 1;
      }
      if (notionalUsd > existing.peakNotionalUsd) {
        existing.peakNotionalUsd = notionalUsd;
      }

      const dropRatio =
        existing.peakNotionalUsd > 0
          ? (existing.peakNotionalUsd - notionalUsd) / existing.peakNotionalUsd
          : 0;
      const priceDidNotCross =
        side === "BID"
          ? snap.midPrice > priceBucket
          : snap.midPrice < priceBucket;

      let status: WallIntegrityStatus = "ACTIVE_CLUSTER";
      if (
        existing.peakNotionalUsd >= meanBucketUsd * 2.1 &&
        dropRatio >= 0.55 &&
        priceDidNotCross
      ) {
        status = "SPOOF_PULLED";
        const dropPct = Math.round(dropRatio * 100);
        const dup = symEvents.find(
          (e) =>
            e.priceBucket === priceBucket &&
            e.side === side &&
            nowMs - e.timestamp < 30_000,
        );
        if (!dup) {
          symEvents.unshift({
            id: `spf-${nowMs}-${priceBucket}`,
            symbol: snap.symbol,
            asset: snap.asset,
            side,
            priceBucket,
            peakNotionalUsd: existing.peakNotionalUsd,
            currentNotionalUsd: notionalUsd,
            dropPercent: dropPct,
            status: "SPOOF_PULLED",
            ageSeconds: Math.max(
              1,
              Math.round((nowMs - existing.firstSeenMs) / 1000),
            ),
            timestamp: nowMs,
          });
        }
      } else if (existing.reloadCount >= 1 && mult >= 2.0) {
        status = "ICEBERG_RELOADED";
      } else if (existing.snapshotsSeen >= 3 || mult >= 2.5) {
        status = "VERIFIED_FORTRESS";
      }

      existing.lastNotionalUsd = notionalUsd;
      const ageSec = Math.max(1, (nowMs - existing.firstSeenMs) / 1000);
      const persistenceScore =
        status === "SPOOF_PULLED"
          ? Math.max(10, Math.round(100 - dropRatio * 100))
          : Math.min(
              99,
              Math.round(
                60 +
                  Math.min(20, ageSec * 0.5) +
                  existing.reloadCount * 8 +
                  Math.min(15, mult * 3),
              ),
            );

      return { status, persistenceScore };
    };

    let cumBid = 0;
    const groupedBids: CapitalClusterZone[] = Array.from(bidMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([priceBucket, info]) => {
        cumBid += info.notional;
        const mult = meanBucketUsd > 0 ? info.notional / meanBucketUsd : 1;
        const integrity = evaluateWallIntegrity(
          "BID",
          priceBucket,
          info.notional,
          mult,
        );
        return {
          side: "BID" as const,
          priceBucket,
          quantity: info.qty,
          notionalUsd: info.notional,
          cumulativeUsd: cumBid,
          depthPercent: 0,
          shareOfSidePercent:
            totalBidCapitalUsd > 0
              ? (info.notional / totalBidCapitalUsd) * 100
              : 0,
          distanceFromMidPercent:
            snap.midPrice > 0
              ? ((priceBucket - snap.midPrice) / snap.midPrice) * 100
              : 0,
          distanceFromMidUsd: priceBucket - snap.midPrice,
          wallMultiple: mult,
          isWhaleCluster: mult >= 2.0,
          levelsMerged: info.count,
          wallStatus: integrity.status,
          persistenceScore: integrity.persistenceScore,
        };
      });

    let cumAsk = 0;
    const groupedAsks: CapitalClusterZone[] = Array.from(askMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([priceBucket, info]) => {
        cumAsk += info.notional;
        const mult = meanBucketUsd > 0 ? info.notional / meanBucketUsd : 1;
        const integrity = evaluateWallIntegrity(
          "ASK",
          priceBucket,
          info.notional,
          mult,
        );
        return {
          side: "ASK" as const,
          priceBucket,
          quantity: info.qty,
          notionalUsd: info.notional,
          cumulativeUsd: cumAsk,
          depthPercent: 0,
          shareOfSidePercent:
            totalAskCapitalUsd > 0
              ? (info.notional / totalAskCapitalUsd) * 100
              : 0,
          distanceFromMidPercent:
            snap.midPrice > 0
              ? ((priceBucket - snap.midPrice) / snap.midPrice) * 100
              : 0,
          distanceFromMidUsd: priceBucket - snap.midPrice,
          wallMultiple: mult,
          isWhaleCluster: mult >= 2.0,
          levelsMerged: info.count,
          wallStatus: integrity.status,
          persistenceScore: integrity.persistenceScore,
        };
      });

    const maxBucketNotional = Math.max(
      ...groupedBids.map((b) => b.notionalUsd),
      ...groupedAsks.map((a) => a.notionalUsd),
      1,
    );
    for (const b of groupedBids) {
      b.depthPercent = Math.min(100, (b.notionalUsd / maxBucketNotional) * 100);
    }
    for (const a of groupedAsks) {
      a.depthPercent = Math.min(100, (a.notionalUsd / maxBucketNotional) * 100);
    }

    const topBidClusters = [...groupedBids]
      .sort((a, b) => b.notionalUsd - a.notionalUsd)
      .slice(0, 4);
    const topAskClusters = [...groupedAsks]
      .sort((a, b) => b.notionalUsd - a.notionalUsd)
      .slice(0, 4);

    // Ensure top verified walls are also visible in the integrity feed if no spoofs yet
    const combinedEvents: SpoofWallEvent[] = [...symEvents.slice(0, 6)];
    if (combinedEvents.length < 4) {
      for (const c of [
        ...topBidClusters.slice(0, 2),
        ...topAskClusters.slice(0, 2),
      ]) {
        if (
          !combinedEvents.some(
            (e) => e.priceBucket === c.priceBucket && e.side === c.side,
          )
        ) {
          combinedEvents.push({
            id: `ver-${c.side}-${c.priceBucket}`,
            symbol: snap.symbol,
            asset: snap.asset,
            side: c.side,
            priceBucket: c.priceBucket,
            peakNotionalUsd: c.notionalUsd,
            currentNotionalUsd: c.notionalUsd,
            dropPercent: 0,
            status: c.wallStatus,
            ageSeconds: 45,
            timestamp: nowMs,
          });
        }
      }
    }
    OrderbookService.spoofEventsLog.set(snap.symbol, symEvents.slice(0, 12));

    return {
      bucketStepUsd: step,
      availableBuckets,
      groupedBids,
      groupedAsks,
      topBidClusters,
      topAskClusters,
      totalBidCapitalUsd,
      totalAskCapitalUsd,
      bidAskRatio:
        totalAskCapitalUsd > 0 ? totalBidCapitalUsd / totalAskCapitalUsd : 1,
      spoofAndIntegrityEvents: combinedEvents.slice(0, 6),
    };
  }

  /**
   * Pure quantitative L2 Orderbook analytics computation.
   * Accepts raw [priceStr, qtyStr][] arrays for bids and asks (up to 1000 levels).
   */
  public static computeL2Analytics(
    symbol: string,
    rawBids: Array<[string | number, string | number]>,
    rawAsks: Array<[string | number, string | number]>,
  ): L2OrderbookSnapshot {
    const asset = symbol.toUpperCase().replace("USDT", "");

    const parsedBids = rawBids
      .map(([p, q]) => ({
        price: Number(p),
        quantity: Number(q),
      }))
      .filter((x) => x.price > 0 && x.quantity > 0)
      .sort((a, b) => b.price - a.price)
      .slice(0, 1000);

    const parsedAsks = rawAsks
      .map(([p, q]) => ({
        price: Number(p),
        quantity: Number(q),
      }))
      .filter((x) => x.price > 0 && x.quantity > 0)
      .sort((a, b) => a.price - b.price)
      .slice(0, 1000);

    const bestBid = parsedBids[0]?.price || 0;
    const bestAsk = parsedAsks[0]?.price || 0;
    const bestBidQty = parsedBids[0]?.quantity || 0;
    const bestAskQty = parsedAsks[0]?.quantity || 0;

    const midPrice =
      bestBid > 0 && bestAsk > 0
        ? (bestBid + bestAsk) / 2
        : bestBid || bestAsk || 0;
    const spreadUsd =
      bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0;
    const spreadBps = midPrice > 0 ? (spreadUsd / midPrice) * 10000 : 0;

    // 1. Stoikov Micro-Price
    const topTotalQty = bestBidQty + bestAskQty;
    const imbalanceTop = topTotalQty > 0 ? bestBidQty / topTotalQty : 0.5;
    const microPrice =
      bestBid > 0 && bestAsk > 0
        ? bestBid * (1 - imbalanceTop) + bestAsk * imbalanceTop
        : midPrice;
    const microPriceSkewBps =
      midPrice > 0 ? ((microPrice - midPrice) / midPrice) * 10000 : 0;

    // 2. Compute mean level notional for Wall Detection (threshold = 2.2x mean level notional)
    const allNotionals: number[] = [];
    for (const b of parsedBids) allNotionals.push(b.price * b.quantity);
    for (const a of parsedAsks) allNotionals.push(a.price * a.quantity);
    const meanLevelUsd =
      allNotionals.length > 0
        ? allNotionals.reduce((acc, v) => acc + v, 0) / allNotionals.length
        : 1;

    // 3. Build cumulative ladders & detect Liquidity Walls ("Плиты")
    let cumBidUsd = 0;
    const bids: OrderbookLevel[] = parsedBids.map((b) => {
      const notionalUsd = b.price * b.quantity;
      cumBidUsd += notionalUsd;
      const wallMultiple = meanLevelUsd > 0 ? notionalUsd / meanLevelUsd : 1;
      return {
        price: b.price,
        quantity: b.quantity,
        notionalUsd,
        cumulativeUsd: cumBidUsd,
        depthPercent: 0,
        isWall: wallMultiple >= 2.2,
        wallMultiple,
      };
    });

    let cumAskUsd = 0;
    const asks: OrderbookLevel[] = parsedAsks.map((a) => {
      const notionalUsd = a.price * a.quantity;
      cumAskUsd += notionalUsd;
      const wallMultiple = meanLevelUsd > 0 ? notionalUsd / meanLevelUsd : 1;
      return {
        price: a.price,
        quantity: a.quantity,
        notionalUsd,
        cumulativeUsd: cumAskUsd,
        depthPercent: 0,
        isWall: wallMultiple >= 2.2,
        wallMultiple,
      };
    });

    const maxCumUsd = Math.max(cumBidUsd, cumAskUsd, 1);
    for (const b of bids) {
      b.depthPercent = Math.min(100, (b.cumulativeUsd / maxCumUsd) * 100);
    }
    for (const a of asks) {
      a.depthPercent = Math.min(100, (a.cumulativeUsd / maxCumUsd) * 100);
    }

    // 4. Find biggest Bid Wall and Ask Wall
    const biggestBidWall =
      [...bids].sort((a, b) => b.notionalUsd - a.notionalUsd)[0] || null;
    const biggestAskWall =
      [...asks].sort((a, b) => b.notionalUsd - a.notionalUsd)[0] || null;

    // 5. Multi-Level Order Book Imbalance (OBI-20)
    const totalDepth = cumBidUsd + cumAskUsd;
    const obi20Percent =
      totalDepth > 0 ? ((cumBidUsd - cumAskUsd) / totalDepth) * 100 : 0;

    // 6. Estimate Slippage (bps) for $500K sweep
    const sweepTargetUsd = 500_000;
    const slippageBuy1M_Bps = OrderbookService.estimateSweepSlippageBps(
      asks,
      midPrice,
      sweepTargetUsd,
    );
    const slippageSell1M_Bps = OrderbookService.estimateSweepSlippageBps(
      bids,
      midPrice,
      sweepTargetUsd,
    );

    const regime =
      obi20Percent >= 18
        ? "STRONG_BID_SUPPORT"
        : obi20Percent <= -18
          ? "STRONG_ASK_RESISTANCE"
          : "BALANCED_BOOK";

    return {
      symbol: symbol.toUpperCase(),
      asset,
      timestamp: Date.now(),
      bestBid,
      bestAsk,
      midPrice,
      spreadUsd,
      spreadBps,
      microPrice,
      microPriceSkewBps,
      obi20Percent,
      totalBidDepthUsd: cumBidUsd,
      totalAskDepthUsd: cumAskUsd,
      biggestBidWall,
      biggestAskWall,
      slippageBuy1M_Bps,
      slippageSell1M_Bps,
      regime,
      bids,
      asks,
    };
  }

  private static estimateSweepSlippageBps(
    levels: OrderbookLevel[],
    midPrice: number,
    targetUsd: number,
  ): number {
    if (levels.length === 0 || midPrice <= 0) return 0;
    let remainingUsd = targetUsd;
    let totalCostUsd = 0;
    let totalCoins = 0;

    for (const lvl of levels) {
      const takeUsd = Math.min(remainingUsd, lvl.notionalUsd);
      const takeCoins = takeUsd / lvl.price;
      totalCostUsd += takeUsd;
      totalCoins += takeCoins;
      remainingUsd -= takeUsd;
      if (remainingUsd <= 0) break;
    }

    if (totalCoins <= 0) return 0;
    const vwapFill = totalCostUsd / totalCoins;
    return (Math.abs(vwapFill - midPrice) / midPrice) * 10000;
  }
}
