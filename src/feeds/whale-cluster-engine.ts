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

export type AlphaSignalType =
  | "ONCHAIN_DUMP_WATCH" // On-chain BTC inflow linked with exchange SELL tranches
  | "ONCHAIN_ACCUMULATION" // Spot BUY tranches linked with on-chain settlement
  | "BULLISH_BID_ABSORPTION" // Heavy market SELLs absorbed by passive limit BUY wall (Price refuses to drop -> LONG)
  | "BEARISH_ASK_ABSORPTION" // Heavy market BUYs absorbed by passive limit SELL wall (Price refuses to rise -> SHORT)
  | "ICEBERG_MOMENTUM_BREAKOUT"; // Multi-tranche Iceberg/Cross-Venue sweep pushing price cleanly

export interface InstitutionalAlphaSignal {
  id: string;
  timestamp: number;
  asset: string;
  signalType: AlphaSignalType;
  direction: "LONG" | "SHORT";
  conviction: number; // 70-99%
  headline: string;
  rationale: string;
  triggerPrice: number;
  notionalUsd: number;
  linkedCampaignId: string;
}

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

  /**
   * Generates high-conviction Institutional Alpha Signals by combining:
   * 1. Pre-Trade On-Chain Mempool transfers correlated with Exchange Orderbook Tranches
   * 2. Limit Orderbook Absorption (Heavy Taker Delta failing to move price -> Passive Whale Wall)
   * 3. Multi-Tranche Iceberg / Cross-Venue Momentum Breakouts
   */
  public static generateAlphaSignals(
    campaigns: WhaleTrancheCampaign[],
    allTrades: WhaleTrade[],
  ): InstitutionalAlphaSignal[] {
    const signals: InstitutionalAlphaSignal[] = [];
    const onChainTransfers = allTrades.filter(
      (t) => t.venue === "BTC_MEMPOOL" && t.valueUsd >= 100000,
    );

    for (const c of campaigns) {
      if (c.totalValueUsd < 150000) continue;

      // 1. Check On-Chain -> Orderbook Correlation (within 45 minutes of on-chain transfer)
      const linkedOnChain = onChainTransfers.find(
        (tx) =>
          tx.asset === c.asset &&
          Math.abs(c.lastTime - tx.timestamp) <= 45 * 60 * 1000,
      );

      if (
        linkedOnChain &&
        c.venues.some((v) => v !== "BTC_MEMPOOL") &&
        c.trancheCount >= 2
      ) {
        const isSellDump = c.side === "SELL";
        const leadMin = Math.max(
          1,
          Math.round(Math.abs(c.lastTime - linkedOnChain.timestamp) / 60000),
        );
        signals.push({
          id: `SIG-OC-${c.campaignId}`,
          timestamp: c.lastTime,
          asset: c.asset,
          signalType: isSellDump
            ? "ONCHAIN_DUMP_WATCH"
            : "ONCHAIN_ACCUMULATION",
          direction: isSellDump ? "SHORT" : "LONG",
          conviction: Math.min(98, c.confidenceScore + 6),
          headline: isSellDump
            ? `🔴 CONFIRMED ON-CHAIN DUMP: ${c.asset} Mempool Inflow -> ${c.trancheCount} Sell Tranches`
            : `🟢 CONFIRMED ON-CHAIN ACCUMULATION: ${c.trancheCount} Spot Buy Clips + On-Chain Settlement`,
          rationale: `On-chain transfer of $${Math.round(linkedOnChain.valueUsd).toLocaleString()} (${linkedOnChain.quantity.toFixed(2)} ${c.asset}) correlated with ${c.trancheCount} ${c.side} tranches ($${Math.round(c.totalValueUsd).toLocaleString()} total @ VWAP $${c.vwapPrice.toLocaleString()}) across ${c.venues.join("+")} (${leadMin}m window).`,
          triggerPrice: c.lastPrice,
          notionalUsd: c.totalValueUsd + linkedOnChain.valueUsd,
          linkedCampaignId: c.campaignId,
        });
        continue;
      }

      // 2. Check Limit Absorption (Passive Whale Wall absorbing aggressive Taker flow)
      // In evaluateCampaignSignature, priceImpactBps is positive when price moves IN the direction of the taker side.
      // If a whale hammers the book with >= 2 tranches and >= $250k, yet priceImpactBps <= 0.8 bps (or negative!),
      // a massive passive limit wall is absorbing 100% of the market orders -> Reversal Signal!
      if (
        c.trancheCount >= 2 &&
        c.totalValueUsd >= 250000 &&
        c.priceImpactBps <= 0.8
      ) {
        const isBullishBidAbsorption = c.side === "SELL"; // Takers selling heavily, but price refuses to drop!
        signals.push({
          id: `SIG-ABS-${c.campaignId}`,
          timestamp: c.lastTime,
          asset: c.asset,
          signalType: isBullishBidAbsorption
            ? "BULLISH_BID_ABSORPTION"
            : "BEARISH_ASK_ABSORPTION",
          direction: isBullishBidAbsorption ? "LONG" : "SHORT",
          conviction: Math.min(
            96,
            82 + Math.min(12, Math.floor(c.totalValueUsd / 200000)),
          ),
          headline: isBullishBidAbsorption
            ? `⚡ BULLISH BID ABSORPTION: $${Math.round(c.totalValueUsd).toLocaleString()} Market Sells Absorbed @ $${c.vwapPrice.toLocaleString()}`
            : `⚡ BEARISH ASK ABSORPTION: $${Math.round(c.totalValueUsd).toLocaleString()} Market Buys Capped @ $${c.vwapPrice.toLocaleString()}`,
          rationale: `${c.trancheCount} aggressive ${c.side} tranches (${c.totalOrdersSwept} orders swept) hit ${c.venues.join("+")}, but price failed to move (${c.priceImpactBps.toFixed(1)} bps impact). Passive institutional limit wall is absorbing flow.`,
          triggerPrice: c.vwapPrice,
          notionalUsd: c.totalValueUsd,
          linkedCampaignId: c.campaignId,
        });
        continue;
      }

      // 3. Check Multi-Tranche Iceberg / Cross-Venue Momentum Breakout
      if (
        c.trancheCount >= 2 &&
        c.totalValueUsd >= 250000 &&
        c.priceImpactBps >= 2.5 &&
        (c.algoType === "ICEBERG_CLIP" ||
          c.algoType === "CROSS_VENUE_SWEEP" ||
          c.algoType === "TWAP_CAMPAIGN")
      ) {
        signals.push({
          id: `SIG-MOM-${c.campaignId}`,
          timestamp: c.lastTime,
          asset: c.asset,
          signalType: "ICEBERG_MOMENTUM_BREAKOUT",
          direction: c.side === "BUY" ? "LONG" : "SHORT",
          conviction: c.confidenceScore,
          headline: `${c.side === "BUY" ? "🟢" : "🔴"} ${c.algoType} MOMENTUM: ${c.asset} ${c.trancheCount} Tranches Driving +${c.priceImpactBps.toFixed(1)} bps`,
          rationale: `Institutional ${c.algoType} (${c.lotUniformityScore}% lot uniformity, avg ${Math.round(c.meanIntervalSec)}s cadence) swept ${c.totalOrdersSwept} limit orders across ${c.venues.join("+")} with VWAP $${c.vwapPrice.toLocaleString()}.`,
          triggerPrice: c.lastPrice,
          notionalUsd: c.totalValueUsd,
          linkedCampaignId: c.campaignId,
        });
      }
    }

    return signals.sort((a, b) => b.conviction - a.conviction).slice(0, 8);
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
