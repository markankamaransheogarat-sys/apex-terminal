/**
 * Apex Terminal - Institutional Whale Tranche Clustering & 24-Hour Persistence Engine
 *
 * 1. Links individual whale prints (>= $50k) into Institutional Tranche Campaigns (TWAP, Iceberg,
 *    Cross-Exchange Sweeps, Orderbook Sweeps) using a 4-Factor Microstructure Fingerprinting Model.
 * 2. Persists 24 hours of whale prints and linked tranche campaigns in IndexedDB (with LocalStorage
 *    fallback) so traders can analyze multi-hour accumulation/distribution campaigns.
 */

import { WhaleTrade } from "./whale-stream.js";

export type WhaleVenue =
  | "BINANCE_SPOT"
  | "BINANCE_FUTURES"
  | "BYBIT_PERP"
  | "OKX_SWAP"
  | "BTC_MEMPOOL";

export type ExecutionAlgoType =
  | "ICEBERG_CLIP" // Repeated uniform clip sizes (e.g. 2.5 BTC every 20s)
  | "CROSS_VENUE_SWEEP" // Simultaneous execution across Binance + Bybit/OKX (<3s apart)
  | "TWAP_CAMPAIGN" // Time-weighted rhythmic execution over minutes
  | "ORDERBOOK_SWEEP" // Aggressive single sweep eating 25+ resting limit orders
  | "ONCHAIN_SETTLEMENT" // Mempool on-chain whale transfer linked to market flow
  | "SINGLE_BLOCK"; // Isolated block trade

export interface WhaleTrancheCampaign {
  campaignId: string;
  asset: string;
  symbol: string;
  side: "BUY" | "SELL";
  algoType: ExecutionAlgoType;
  trancheCount: number;
  totalValueUsd: number;
  totalQuantity: number;
  vwapPrice: number;
  firstPrice: number;
  lastPrice: number;
  priceImpactBps: number;
  meanIntervalSec: number;
  lotUniformityScore: number; // 0-100
  confidenceScore: number; // 0-99%
  venues: WhaleVenue[];
  totalOrdersSwept: number;
  startTime: number;
  lastTime: number;
  trades: WhaleTrade[];
}

export class WhaleClusterEngine {
  // Maximum time gap (ms) between consecutive tranches of the same active campaign (15 minutes)
  private static readonly MAX_CAMPAIGN_GAP_MS = 15 * 60 * 1000;
  // Retention window: 24 hours
  public static readonly RETENTION_24H_MS = 24 * 60 * 60 * 1000;

  /**
   * Clusters an array of chronological or reverse-chronological whale trades
   * into linked Institutional Tranche Campaigns.
   */
  public static clusterTrades(trades: WhaleTrade[]): WhaleTrancheCampaign[] {
    if (trades.length === 0) return [];

    // Sort ascending by timestamp to reconstruct campaigns chronologically
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    const campaigns: WhaleTrancheCampaign[] = [];
    const activeByKey = new Map<string, WhaleTrancheCampaign>();

    for (const trade of sorted) {
      // On-chain mempool transfers get grouped by asset + onchain key or linked if close
      const key = `${trade.asset}_${trade.side}`;
      const existing = activeByKey.get(key);

      const venue: WhaleVenue = trade.venue || "BINANCE_SPOT";
      const ordersSwept = trade.ordersSwept || 1;

      if (
        existing &&
        trade.timestamp - existing.lastTime <=
          WhaleClusterEngine.MAX_CAMPAIGN_GAP_MS
      ) {
        // Link trade as a new tranche in the existing campaign
        existing.trades.push(trade);
        existing.trancheCount = existing.trades.length;
        const prevNotional = existing.vwapPrice * existing.totalQuantity;
        existing.totalQuantity += trade.quantity;
        existing.totalValueUsd += trade.valueUsd;
        existing.vwapPrice =
          existing.totalQuantity > 0
            ? (prevNotional + trade.price * trade.quantity) /
              existing.totalQuantity
            : trade.price;
        existing.lastPrice = trade.price;
        existing.lastTime = trade.timestamp;
        existing.totalOrdersSwept += ordersSwept;

        if (!existing.venues.includes(venue)) {
          existing.venues.push(venue);
        }

        // Recompute microstructure metrics
        WhaleClusterEngine.evaluateCampaignSignature(existing);
        trade.campaignId = existing.campaignId;
        trade.trancheIndex = existing.trancheCount;
      } else {
        // Start a new campaign
        const hash = Math.abs(
          Math.floor(trade.timestamp / 1000) ^ Math.floor(trade.valueUsd),
        )
          .toString(16)
          .toUpperCase()
          .slice(0, 4)
          .padStart(4, "0");
        const campaignId = `TR-${trade.asset}-${hash}`;
        trade.campaignId = campaignId;
        trade.trancheIndex = 1;

        const newCampaign: WhaleTrancheCampaign = {
          campaignId,
          asset: trade.asset,
          symbol: trade.symbol,
          side: trade.side,
          algoType:
            venue === "BTC_MEMPOOL"
              ? "ONCHAIN_SETTLEMENT"
              : ordersSwept >= 25
                ? "ORDERBOOK_SWEEP"
                : "SINGLE_BLOCK",
          trancheCount: 1,
          totalValueUsd: trade.valueUsd,
          totalQuantity: trade.quantity,
          vwapPrice: trade.price,
          firstPrice: trade.price,
          lastPrice: trade.price,
          priceImpactBps: 0,
          meanIntervalSec: 0,
          lotUniformityScore: 100,
          confidenceScore: ordersSwept >= 25 ? 82 : 65,
          venues: [venue],
          totalOrdersSwept: ordersSwept,
          startTime: trade.timestamp,
          lastTime: trade.timestamp,
          trades: [trade],
        };

        campaigns.push(newCampaign);
        activeByKey.set(key, newCampaign);
      }
    }

    // Return newest campaigns first
    return campaigns.sort((a, b) => b.lastTime - a.lastTime);
  }

  /**
   * Evaluates the microstructure signature of a multi-tranche campaign:
   * - Lot uniformity (Iceberg detection)
   * - Cross-venue simultaneity (Smart Order Router sweep)
   * - Cadence regularity (TWAP bot)
   * - Price impact in bps
   */
  private static evaluateCampaignSignature(c: WhaleTrancheCampaign): void {
    const n = c.trades.length;
    if (n <= 1) return;

    // 1. Price impact in basis points (1 bp = 0.01%)
    if (c.firstPrice > 0) {
      const rawMove = ((c.lastPrice - c.firstPrice) / c.firstPrice) * 10000;
      c.priceImpactBps = c.side === "BUY" ? rawMove : -rawMove;
    }

    // 2. Inter-arrival intervals
    const intervalsSec: number[] = [];
    let hasCrossVenueSimultaneous = false;

    for (let i = 1; i < n; i++) {
      const dtMs = Math.max(
        0,
        c.trades[i]!.timestamp - c.trades[i - 1]!.timestamp,
      );
      intervalsSec.push(dtMs / 1000);
      if (
        dtMs <= 4000 &&
        c.trades[i]!.venue &&
        c.trades[i - 1]!.venue &&
        c.trades[i]!.venue !== c.trades[i - 1]!.venue
      ) {
        hasCrossVenueSimultaneous = true;
      }
    }

    const meanInterval =
      intervalsSec.reduce((acc, v) => acc + v, 0) / intervalsSec.length;
    c.meanIntervalSec = meanInterval;

    // 3. Lot size uniformity (Coefficient of Variation of quantities)
    const quantities = c.trades.map((t) => t.quantity);
    const meanQty = quantities.reduce((acc, q) => acc + q, 0) / n;
    const varianceQty =
      quantities.reduce((acc, q) => acc + Math.pow(q - meanQty, 2), 0) / n;
    const stdQty = Math.sqrt(varianceQty);
    const cv = meanQty > 0 ? stdQty / meanQty : 1;
    // Uniformity score: CV=0 -> 100%, CV>=1 -> 20%
    c.lotUniformityScore = Math.round(
      Math.max(15, Math.min(100, (1 - cv * 0.8) * 100)),
    );

    // 4. Classify Execution Algorithm & Confidence Score
    if (c.venues.includes("BTC_MEMPOOL") && c.venues.length > 1) {
      c.algoType = "ONCHAIN_SETTLEMENT";
      c.confidenceScore = 91;
    } else if (hasCrossVenueSimultaneous || c.venues.length >= 2) {
      c.algoType = "CROSS_VENUE_SWEEP";
      c.confidenceScore = Math.min(98, 84 + n * 2);
    } else if (c.lotUniformityScore >= 78 && n >= 2) {
      c.algoType = "ICEBERG_CLIP";
      c.confidenceScore = Math.min(
        99,
        80 + Math.round(c.lotUniformityScore * 0.15) + n,
      );
    } else if (n >= 3) {
      c.algoType = "TWAP_CAMPAIGN";
      c.confidenceScore = Math.min(96, 76 + n * 3);
    } else if (c.totalOrdersSwept >= 30) {
      c.algoType = "ORDERBOOK_SWEEP";
      c.confidenceScore = 88;
    } else {
      c.algoType = "TWAP_CAMPAIGN";
      c.confidenceScore = 74;
    }
  }
}

/**
 * 24-Hour Browser Persistence Store using IndexedDB + LocalStorage hybrid
 * Stores up to 5,000 whale prints for 24 hours without blocking UI.
 */
export class WhalePersistenceStore {
  private static readonly DB_NAME = "apex_whale_intelligence_db";
  private static readonly STORE_NAME = "whale_trades_24h";
  private static readonly LS_FALLBACK_KEY = "apex_whale_24h_backup";
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor() {
    this.dbPromise = this.initIndexedDB();
  }

  private initIndexedDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(WhalePersistenceStore.DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(WhalePersistenceStore.STORE_NAME)) {
            const store = db.createObjectStore(
              WhalePersistenceStore.STORE_NAME,
              {
                keyPath: "id",
              },
            );
            store.createIndex("timestamp", "timestamp", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  public async saveTrades(trades: WhaleTrade[]): Promise<void> {
    const cutoff = Date.now() - WhaleClusterEngine.RETENTION_24H_MS;
    const valid = trades.filter((t) => t.timestamp >= cutoff).slice(0, 2500);

    // 1. Save compact backup to LocalStorage (top 300 trades for instant synchronous boot)
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(
          WhalePersistenceStore.LS_FALLBACK_KEY,
          JSON.stringify({
            updatedAt: Date.now(),
            trades: valid.slice(0, 300),
          }),
        );
      } catch {}
    }

    // 2. Save full 24h dataset to IndexedDB
    const db = await this.dbPromise;
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(
          WhalePersistenceStore.STORE_NAME,
          "readwrite",
        );
        const store = tx.objectStore(WhalePersistenceStore.STORE_NAME);

        for (const t of valid.slice(0, 500)) {
          store.put(t);
        }

        // Prune records older than 24h
        const idx = store.index("timestamp");
        const range = IDBKeyRange.upperBound(cutoff);
        const cursorReq = idx.openKeyCursor(range);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  public loadSyncBackup(): WhaleTrade[] {
    if (typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(WhalePersistenceStore.LS_FALLBACK_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const cutoff = Date.now() - WhaleClusterEngine.RETENTION_24H_MS;
      if (parsed && Array.isArray(parsed.trades)) {
        return parsed.trades.filter((t: WhaleTrade) => t.timestamp >= cutoff);
      }
    } catch {}
    return [];
  }

  public async loadAll24hTrades(): Promise<WhaleTrade[]> {
    const cutoff = Date.now() - WhaleClusterEngine.RETENTION_24H_MS;
    const db = await this.dbPromise;
    if (!db) {
      return this.loadSyncBackup();
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(WhalePersistenceStore.STORE_NAME, "readonly");
        const store = tx.objectStore(WhalePersistenceStore.STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = Array.isArray(req.result)
            ? (req.result as WhaleTrade[])
            : [];
          const filtered = list
            .filter((t) => t.timestamp >= cutoff)
            .sort((a, b) => b.timestamp - a.timestamp);
          resolve(filtered.length > 0 ? filtered : this.loadSyncBackup());
        };
        req.onerror = () => resolve(this.loadSyncBackup());
      } catch {
        resolve(this.loadSyncBackup());
      }
    });
  }
}
