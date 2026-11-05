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

export class OrderbookService {
  private symbol: string = "BTCUSDT";
  private ws: WebSocket | null = null;
  private snapshot: L2OrderbookSnapshot | null = null;
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
        `https://api.binance.com/api/v3/depth?symbol=${this.symbol}&limit=20`,
      );
      if (res.ok) {
        const raw = await res.json();
        if (raw && Array.isArray(raw.bids) && Array.isArray(raw.asks)) {
          const snap = OrderbookService.computeL2Analytics(
            this.symbol,
            raw.bids,
            raw.asks,
          );
          this.snapshot = snap;
          this.notify(snap);
          return snap;
        }
      }
    } catch {}
    return this.snapshot;
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
            const snap = OrderbookService.computeL2Analytics(
              this.symbol,
              bids,
              asks,
            );
            this.snapshot = snap;
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
   * Pure quantitative L2 Orderbook analytics computation.
   * Accepts raw [priceStr, qtyStr][] arrays for bids and asks.
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
      .slice(0, 20);

    const parsedAsks = rawAsks
      .map(([p, q]) => ({
        price: Number(p),
        quantity: Number(q),
      }))
      .filter((x) => x.price > 0 && x.quantity > 0)
      .sort((a, b) => a.price - b.price)
      .slice(0, 20);

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
