/**
 * Apex Terminal - 1-Click Institutional Execution Blotter & Live Position Manager
 *
 * Allows instant 1-click trade execution directly from QuantTradeSetup tickets in EXEC <GO>,
 * real-time Mark-to-Market (MTM) PnL & R-multiple tracking from Binance WebSocket ticks,
 * automated partial Take-Profit ladder (TP1 1.5R -> Auto-Breakeven SL, TP2 2.5R, TP3 Magnet),
 * and persistent trade ledger in LocalStorage.
 */

import { QuantTradeSetup } from "./quant-execution-calculator.js";

export type BlotterPositionStatus =
  "OPEN" | "CLOSED_TP" | "CLOSED_SL" | "CLOSED_MANUAL";

export interface BlotterPosition {
  id: string;
  symbol: string;
  asset: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  stopLossPrice: number;
  initialStopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3MagnetPrice: number;
  initialSizeCoins: number;
  remainingSizeCoins: number;
  notionalUsd: number;
  leverage: number;
  riskBudgetUsd: number; // 1.0R dollar risk
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  currentRMultiple: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  isBreakevenStop: boolean;
  status: BlotterPositionStatus;
  openedAt: number;
  closedAt?: number;
  closeNote?: string;
}

export interface BlotterSummary {
  openPositions: BlotterPosition[];
  closedPositions: BlotterPosition[];
  totalUnrealizedPnlUsd: number;
  totalRealizedPnlUsd: number;
  netTotalPnlUsd: number;
  winRatePercent: number;
  avgRMultiple: number;
}

export class ExecutionBlotterService {
  private static readonly STORAGE_KEY = "apex_execution_blotter_v1";
  private positions: BlotterPosition[] = [];

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Opens a live tracked position directly from a QuantTradeSetup ticket in 1 click.
   */
  public openPositionFromSetup(setup: QuantTradeSetup): BlotterPosition {
    const pos: BlotterPosition = {
      id: `EX-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
      symbol: setup.symbol,
      asset: setup.asset,
      direction: setup.direction,
      entryPrice: setup.optimalEntryPrice,
      currentPrice: setup.currentPrice,
      stopLossPrice: setup.protectedStopLoss,
      initialStopLossPrice: setup.protectedStopLoss,
      tp1Price: setup.takeProfit1_15R,
      tp2Price: setup.takeProfit2_25R,
      tp3MagnetPrice: setup.takeProfit3_Magnet,
      initialSizeCoins: setup.positionSizeCoins,
      remainingSizeCoins: setup.positionSizeCoins,
      notionalUsd: setup.positionNotionalUsd,
      leverage: setup.recommendedLeverage,
      riskBudgetUsd: Math.max(1, setup.maxRiskDollarUsd),
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      totalPnlUsd: 0,
      currentRMultiple: 0,
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
      isBreakevenStop: false,
      status: "OPEN",
      openedAt: Date.now(),
    };

    this.positions.unshift(pos);
    if (this.positions.length > 60) {
      this.positions = this.positions.slice(0, 60);
    }
    this.saveToStorage();
    return pos;
  }

  /**
   * Marks all open positions to live prices and processes automatic SL / TP1 / TP2 / TP3 ladder fills.
   */
  public updateWithLivePrices(livePrices: Map<string, number>): void {
    let changed = false;

    for (const pos of this.positions) {
      if (pos.status !== "OPEN") continue;
      const live = livePrices.get(pos.symbol);
      if (!live || live <= 0) continue;

      pos.currentPrice = live;
      const dirSign = pos.direction === "LONG" ? 1 : -1;

      // 1. Check Stop-Loss trigger
      const stopTriggered =
        (pos.direction === "LONG" && live <= pos.stopLossPrice) ||
        (pos.direction === "SHORT" && live >= pos.stopLossPrice);

      if (stopTriggered && pos.remainingSizeCoins > 0) {
        const fillPnl =
          (pos.stopLossPrice - pos.entryPrice) *
          dirSign *
          pos.remainingSizeCoins;
        pos.realizedPnlUsd = Number((pos.realizedPnlUsd + fillPnl).toFixed(2));
        pos.remainingSizeCoins = 0;
        pos.unrealizedPnlUsd = 0;
        pos.totalPnlUsd = pos.realizedPnlUsd;
        pos.currentRMultiple = Number(
          (pos.totalPnlUsd / pos.riskBudgetUsd).toFixed(2),
        );
        pos.status = pos.isBreakevenStop ? "CLOSED_TP" : "CLOSED_SL";
        pos.closedAt = Date.now();
        pos.closeNote = pos.isBreakevenStop
          ? "Closed at Breakeven Stop after TP1+"
          : "Stopped out at Wall-Protected Stop (-1.0R)";
        changed = true;
        continue;
      }

      // 2. Check TP1 (1.5R): book 35% of initial size & move Stop-Loss to Breakeven
      const tp1Triggered =
        !pos.tp1Hit &&
        ((pos.direction === "LONG" && live >= pos.tp1Price) ||
          (pos.direction === "SHORT" && live <= pos.tp1Price));

      if (tp1Triggered && pos.remainingSizeCoins > 0) {
        const clipCoins = Math.min(
          pos.remainingSizeCoins,
          Number((pos.initialSizeCoins * 0.35).toFixed(4)),
        );
        const clipPnl = (pos.tp1Price - pos.entryPrice) * dirSign * clipCoins;
        pos.realizedPnlUsd = Number((pos.realizedPnlUsd + clipPnl).toFixed(2));
        pos.remainingSizeCoins = Number(
          Math.max(0, pos.remainingSizeCoins - clipCoins).toFixed(4),
        );
        pos.tp1Hit = true;
        pos.stopLossPrice = pos.entryPrice;
        pos.isBreakevenStop = true;
        changed = true;
      }

      // 3. Check TP2 (2.5R): book another 35% of initial size
      const tp2Triggered =
        !pos.tp2Hit &&
        ((pos.direction === "LONG" && live >= pos.tp2Price) ||
          (pos.direction === "SHORT" && live <= pos.tp2Price));

      if (tp2Triggered && pos.remainingSizeCoins > 0) {
        const clipCoins = Math.min(
          pos.remainingSizeCoins,
          Number((pos.initialSizeCoins * 0.35).toFixed(4)),
        );
        const clipPnl = (pos.tp2Price - pos.entryPrice) * dirSign * clipCoins;
        pos.realizedPnlUsd = Number((pos.realizedPnlUsd + clipPnl).toFixed(2));
        pos.remainingSizeCoins = Number(
          Math.max(0, pos.remainingSizeCoins - clipCoins).toFixed(4),
        );
        pos.tp2Hit = true;
        changed = true;
      }

      // 4. Check TP3 (50x Liquidation Magnet): close remaining 30% runner
      const tp3Triggered =
        !pos.tp3Hit &&
        ((pos.direction === "LONG" && live >= pos.tp3MagnetPrice) ||
          (pos.direction === "SHORT" && live <= pos.tp3MagnetPrice));

      if (tp3Triggered && pos.remainingSizeCoins > 0) {
        const runnerPnl =
          (pos.tp3MagnetPrice - pos.entryPrice) *
          dirSign *
          pos.remainingSizeCoins;
        pos.realizedPnlUsd = Number(
          (pos.realizedPnlUsd + runnerPnl).toFixed(2),
        );
        pos.remainingSizeCoins = 0;
        pos.unrealizedPnlUsd = 0;
        pos.totalPnlUsd = pos.realizedPnlUsd;
        pos.currentRMultiple = Number(
          (pos.totalPnlUsd / pos.riskBudgetUsd).toFixed(2),
        );
        pos.tp3Hit = true;
        pos.status = "CLOSED_TP";
        pos.closedAt = Date.now();
        pos.closeNote = "Full target hit at TP3 (50x Liquidation Magnet)";
        changed = true;
        continue;
      }

      // 5. Update Unrealized PnL on remaining open size
      pos.unrealizedPnlUsd = Number(
        ((live - pos.entryPrice) * dirSign * pos.remainingSizeCoins).toFixed(2),
      );
      pos.totalPnlUsd = Number(
        (pos.realizedPnlUsd + pos.unrealizedPnlUsd).toFixed(2),
      );
      pos.currentRMultiple = Number(
        (pos.totalPnlUsd / pos.riskBudgetUsd).toFixed(2),
      );
    }

    if (changed) {
      this.saveToStorage();
    }
  }

  /**
   * Moves the Stop-Loss of an open position to exact entry price (Breakeven).
   */
  public moveStopToBreakeven(id: string): boolean {
    const pos = this.positions.find((p) => p.id === id && p.status === "OPEN");
    if (!pos) return false;
    pos.stopLossPrice = pos.entryPrice;
    pos.isBreakevenStop = true;
    this.saveToStorage();
    return true;
  }

  /**
   * Manually closes an open position at the current live market price.
   */
  public closePositionAtMarket(
    id: string,
    explicitExitPrice?: number,
  ): boolean {
    const pos = this.positions.find((p) => p.id === id && p.status === "OPEN");
    if (!pos) return false;

    const exitPrice =
      explicitExitPrice && explicitExitPrice > 0
        ? explicitExitPrice
        : pos.currentPrice;
    const dirSign = pos.direction === "LONG" ? 1 : -1;
    const closePnl =
      (exitPrice - pos.entryPrice) * dirSign * pos.remainingSizeCoins;

    pos.currentPrice = exitPrice;
    pos.realizedPnlUsd = Number((pos.realizedPnlUsd + closePnl).toFixed(2));
    pos.remainingSizeCoins = 0;
    pos.unrealizedPnlUsd = 0;
    pos.totalPnlUsd = pos.realizedPnlUsd;
    pos.currentRMultiple = Number(
      (pos.totalPnlUsd / pos.riskBudgetUsd).toFixed(2),
    );
    pos.status = "CLOSED_MANUAL";
    pos.closedAt = Date.now();
    pos.closeNote = `Closed manually at $${exitPrice.toLocaleString()}`;
    this.saveToStorage();
    return true;
  }

  public clearClosedHistory(): void {
    this.positions = this.positions.filter((p) => p.status === "OPEN");
    this.saveToStorage();
  }

  public getSummary(): BlotterSummary {
    const openPositions = this.positions.filter((p) => p.status === "OPEN");
    const closedPositions = this.positions.filter((p) => p.status !== "OPEN");

    let totalUnrealizedPnlUsd = 0;
    let totalRealizedPnlUsd = 0;

    for (const p of openPositions) {
      totalUnrealizedPnlUsd += p.unrealizedPnlUsd;
      totalRealizedPnlUsd += p.realizedPnlUsd;
    }
    for (const p of closedPositions) {
      totalRealizedPnlUsd += p.realizedPnlUsd;
    }

    const evaluated = [...openPositions, ...closedPositions];
    const winners = evaluated.filter((p) => p.totalPnlUsd > 0).length;
    const winRatePercent =
      evaluated.length > 0
        ? Number(((winners / evaluated.length) * 100).toFixed(1))
        : 0;
    const avgRMultiple =
      evaluated.length > 0
        ? Number(
            (
              evaluated.reduce((acc, p) => acc + p.currentRMultiple, 0) /
              evaluated.length
            ).toFixed(2),
          )
        : 0;

    return {
      openPositions,
      closedPositions,
      totalUnrealizedPnlUsd: Number(totalUnrealizedPnlUsd.toFixed(2)),
      totalRealizedPnlUsd: Number(totalRealizedPnlUsd.toFixed(2)),
      netTotalPnlUsd: Number(
        (totalUnrealizedPnlUsd + totalRealizedPnlUsd).toFixed(2),
      ),
      winRatePercent,
      avgRMultiple,
    };
  }

  private loadFromStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(ExecutionBlotterService.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.positions = parsed;
        }
      }
    } catch {}
  }

  private saveToStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(
        ExecutionBlotterService.STORAGE_KEY,
        JSON.stringify(this.positions),
      );
    } catch {}
  }
}
