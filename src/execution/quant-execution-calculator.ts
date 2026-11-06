/**
 * Apex Terminal - Senior Quant Execution Calculator, Wall-Protected Stop-Loss,
 * Kelly Criterion Sizer & Liquidation Magnet Cluster Engine (EXEC <GO>)
 */

import { Candle } from "../chart/types.js";
import { L2OrderbookSnapshot } from "../orderbook/orderbook-service.js";
import { WhaleTrancheCampaign } from "../feeds/whale-cluster-engine.js";

export interface LiquidationMagnetCluster {
  id: string;
  tier: "100x" | "50x" | "25x";
  side: "SHORT_LIQ_MAGNET" | "LONG_LIQ_MAGNET"; // SHORT_LIQ_MAGNET = above price (short squeeze), LONG_LIQ_MAGNET = below price (long flush)
  priceLevel: number;
  hvnAnchorPrice: number; // Real Volume Profile entry node from which this leverage band was projected
  distancePercent: number;
  estimatedPoolUsd: number;
  gravityScore: number; // 0-100 magnetic pull intensity
  isPrimaryMagnet: boolean;
}

export interface LiquidationMagnetMap {
  symbol: string;
  asset: string;
  currentPrice: number;
  pocPrice: number; // Point of Control (highest volume entry node)
  openInterestUsd: number;
  primaryMagnet: LiquidationMagnetCluster;
  upperShortSqueezePools: LiquidationMagnetCluster[];
  lowerLongFlushPools: LiquidationMagnetCluster[];
}

export interface QuantTradeSetup {
  symbol: string;
  asset: string;
  direction: "LONG" | "SHORT";
  accountBalanceUsd: number;
  riskPercent: number;
  maxRiskDollarUsd: number;
  currentPrice: number;
  atr14Usd: number;
  atr14Percent: number;
  anchorWallPrice: number;
  anchorWhaleVwap: number;
  optimalEntryPrice: number;
  protectedStopLoss: number;
  stopDistanceUsd: number;
  stopDistancePercent: number;
  positionSizeCoins: number;
  positionNotionalUsd: number;
  recommendedLeverage: number;
  kellyFractionPercent: number; // Half-Kelly optimal capital fraction
  takeProfit1_15R: number;
  takeProfit2_25R: number;
  takeProfit3_Magnet: number;
  rewardToRiskRatio: number;
  setupRationale: string;
}

export class QuantExecutionCalculator {
  /**
   * Computes 14-period Average True Range (ATR) from real OHLC candles.
   */
  public static calculateATR(candles: Candle[], period: number = 14): number {
    if (!candles || candles.length === 0) return 0;
    if (candles.length === 1) {
      return Math.max(
        candles[0]!.close * 0.008,
        candles[0]!.high - candles[0]!.low,
      );
    }

    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const cur = candles[i]!;
      const prev = candles[i - 1]!;
      const hl = cur.high - cur.low;
      const hc = Math.abs(cur.high - prev.close);
      const lc = Math.abs(cur.low - prev.close);
      trs.push(Math.max(hl, hc, lc));
    }

    const slice = trs.slice(-period);
    const sum = slice.reduce((acc, v) => acc + v, 0);
    return slice.length > 0
      ? sum / slice.length
      : candles[candles.length - 1]!.close * 0.01;
  }

  /**
   * Computes the 6 institutional Liquidation Magnet Clusters (100x, 50x, 25x Long & Short)
   * anchored to real historical Volume Profile High-Volume Nodes (HVN) and weighted by
   * live Open Interest and funding rate crowding.
   */
  public static calculateLiquidationMagnets(
    symbol: string,
    currentPrice: number,
    openInterestUsd: number,
    fundingRate8h: number = 0.0001,
    candles: Candle[] = [],
  ): LiquidationMagnetMap {
    const asset = symbol.toUpperCase().replace("USDT", "");
    const safePrice = currentPrice > 0 ? currentPrice : 76900;
    const safeOi = openInterestUsd > 0 ? openInterestUsd : 5_000_000_000;
    const decimals = safePrice < 10 ? 4 : 2;

    // Extract Volume Profile Point of Control (POC) & High-Volume Entry Nodes (HVN)
    let pocPrice = safePrice;
    let shortEntryAnchor = safePrice;
    let longEntryAnchor = safePrice;

    if (candles && candles.length >= 5) {
      let minP = Infinity;
      let maxP = -Infinity;
      for (const c of candles) {
        if (c.low < minP) minP = c.low;
        if (c.high > maxP) maxP = c.high;
      }
      if (maxP > minP && Number.isFinite(minP)) {
        const bins = 24;
        const step = (maxP - minP) / bins;
        const bucketVol = new Array<number>(bins).fill(0);
        for (const c of candles) {
          const typ = (c.high + c.low + c.close) / 3;
          const idx = Math.min(
            bins - 1,
            Math.max(0, Math.floor((typ - minP) / step)),
          );
          bucketVol[idx] = (bucketVol[idx] || 0) + (c.volume || 1);
        }

        let maxVol = -1;
        let pocIdx = 0;
        let upperHvnVol = -1;
        let upperHvnPrice = safePrice;
        let lowerHvnVol = -1;
        let lowerHvnPrice = safePrice;

        for (let i = 0; i < bins; i++) {
          const v = bucketVol[i] || 0;
          const center = minP + (i + 0.5) * step;
          if (v > maxVol) {
            maxVol = v;
            pocIdx = i;
          }
          // Recent short entries clustered near or slightly above current price (within 2.2%)
          if (
            center >= safePrice * 0.992 &&
            center <= safePrice * 1.022 &&
            v > upperHvnVol
          ) {
            upperHvnVol = v;
            upperHvnPrice = center;
          }
          // Recent long entries clustered near or slightly below current price (within 2.2%)
          if (
            center <= safePrice * 1.008 &&
            center >= safePrice * 0.978 &&
            v > lowerHvnVol
          ) {
            lowerHvnVol = v;
            lowerHvnPrice = center;
          }
        }
        pocPrice = Number((minP + (pocIdx + 0.5) * step).toFixed(decimals));
        shortEntryAnchor = Number(upperHvnPrice.toFixed(decimals));
        longEntryAnchor = Number(lowerHvnPrice.toFixed(decimals));
      }
    }

    // Funding skew: positive funding -> crowded longs -> lower long-flush pools are heavier
    // negative funding -> crowded shorts -> upper short-squeeze pools are heavier
    const fundingBias = Math.max(-0.35, Math.min(0.35, fundingRate8h * 1200));
    const longPoolMult = 1 + fundingBias;
    const shortPoolMult = 1 - fundingBias;

    const basePool = safeOi * 0.0045; // ~0.45% of total OI clustered per key leverage band

    const s100Price = Number(
      Math.max(safePrice * 1.006, shortEntryAnchor * 1.0095).toFixed(decimals),
    );
    const s50Price = Number(
      Math.max(safePrice * 1.014, shortEntryAnchor * 1.0192).toFixed(decimals),
    );
    const s25Price = Number(
      Math.max(safePrice * 1.028, shortEntryAnchor * 1.0385).toFixed(decimals),
    );

    const upperShortSqueezePools: LiquidationMagnetCluster[] = [
      {
        id: `${asset}-S100`,
        tier: "100x",
        side: "SHORT_LIQ_MAGNET",
        priceLevel: s100Price,
        hvnAnchorPrice: shortEntryAnchor,
        distancePercent: Number(
          (((s100Price - safePrice) / safePrice) * 100).toFixed(2),
        ),
        estimatedPoolUsd: Math.round(basePool * 0.65 * shortPoolMult),
        gravityScore: Math.round(78 * shortPoolMult),
        isPrimaryMagnet: false,
      },
      {
        id: `${asset}-S50`,
        tier: "50x",
        side: "SHORT_LIQ_MAGNET",
        priceLevel: s50Price,
        hvnAnchorPrice: shortEntryAnchor,
        distancePercent: Number(
          (((s50Price - safePrice) / safePrice) * 100).toFixed(2),
        ),
        estimatedPoolUsd: Math.round(basePool * 1.35 * shortPoolMult),
        gravityScore: Math.round(92 * shortPoolMult),
        isPrimaryMagnet: false,
      },
      {
        id: `${asset}-S25`,
        tier: "25x",
        side: "SHORT_LIQ_MAGNET",
        priceLevel: s25Price,
        hvnAnchorPrice: shortEntryAnchor,
        distancePercent: Number(
          (((s25Price - safePrice) / safePrice) * 100).toFixed(2),
        ),
        estimatedPoolUsd: Math.round(basePool * 1.85 * shortPoolMult),
        gravityScore: Math.round(74 * shortPoolMult),
        isPrimaryMagnet: false,
      },
    ];

    const l100Price = Number(
      Math.min(safePrice * 0.994, longEntryAnchor * 0.9905).toFixed(decimals),
    );
    const l50Price = Number(
      Math.min(safePrice * 0.986, longEntryAnchor * 0.9808).toFixed(decimals),
    );
    const l25Price = Number(
      Math.min(safePrice * 0.972, longEntryAnchor * 0.9615).toFixed(decimals),
    );

    const lowerLongFlushPools: LiquidationMagnetCluster[] = [
      {
        id: `${asset}-L100`,
        tier: "100x",
        side: "LONG_LIQ_MAGNET",
        priceLevel: l100Price,
        hvnAnchorPrice: longEntryAnchor,
        distancePercent: Number(
          (((l100Price - safePrice) / safePrice) * 100).toFixed(2),
        ),
        estimatedPoolUsd: Math.round(basePool * 0.7 * longPoolMult),
        gravityScore: Math.round(80 * longPoolMult),
        isPrimaryMagnet: false,
      },
      {
        id: `${asset}-L50`,
        tier: "50x",
        side: "LONG_LIQ_MAGNET",
        priceLevel: l50Price,
        hvnAnchorPrice: longEntryAnchor,
        distancePercent: Number(
          (((l50Price - safePrice) / safePrice) * 100).toFixed(2),
        ),
        estimatedPoolUsd: Math.round(basePool * 1.42 * longPoolMult),
        gravityScore: Math.round(94 * longPoolMult),
        isPrimaryMagnet: false,
      },
      {
        id: `${asset}-L25`,
        tier: "25x",
        side: "LONG_LIQ_MAGNET",
        priceLevel: l25Price,
        hvnAnchorPrice: longEntryAnchor,
        distancePercent: Number(
          (((l25Price - safePrice) / safePrice) * 100).toFixed(2),
        ),
        estimatedPoolUsd: Math.round(basePool * 1.95 * longPoolMult),
        gravityScore: Math.round(76 * longPoolMult),
        isPrimaryMagnet: false,
      },
    ];

    const allPools = [...upperShortSqueezePools, ...lowerLongFlushPools];
    allPools.forEach((p) => {
      p.gravityScore = Math.max(40, Math.min(99, p.gravityScore));
    });

    const primaryMagnet = [...allPools].sort(
      (a, b) => b.gravityScore - a.gravityScore,
    )[0]!;
    primaryMagnet.isPrimaryMagnet = true;

    return {
      symbol: symbol.toUpperCase(),
      asset,
      currentPrice: safePrice,
      pocPrice,
      openInterestUsd: safeOi,
      primaryMagnet,
      upperShortSqueezePools,
      lowerLongFlushPools,
    };
  }

  /**
   * Computes a Wall-Protected, ATR-Buffered Institutional Trade Setup with Half-Kelly sizing.
   */
  public static calculateTradeSetup(params: {
    symbol: string;
    direction: "LONG" | "SHORT";
    accountBalanceUsd: number;
    riskPercent: number;
    currentPrice: number;
    candles: Candle[];
    orderbook: L2OrderbookSnapshot | null;
    whaleCampaigns: WhaleTrancheCampaign[];
    winRatePercent?: number;
    magnetMap?: LiquidationMagnetMap;
  }): QuantTradeSetup {
    const asset = params.symbol.toUpperCase().replace("USDT", "");
    const safeBalance = Math.max(100, params.accountBalanceUsd || 10000);
    const safeRiskPct = Math.max(0.1, Math.min(10, params.riskPercent || 1.0));
    const maxRiskDollarUsd = safeBalance * (safeRiskPct / 100);
    const price = params.currentPrice > 0 ? params.currentPrice : 76900;

    // 1. Volatility (14-period ATR)
    const rawAtr = QuantExecutionCalculator.calculateATR(params.candles, 14);
    const atr14Usd = rawAtr > 0 ? rawAtr : price * 0.0085;
    const atr14Percent = (atr14Usd / price) * 100;

    // 2. Find L2 Liquidity Wall Anchor (Bid Wall for LONG, Ask Wall for SHORT)
    let anchorWallPrice =
      params.direction === "LONG" ? price * 0.997 : price * 1.003;
    if (
      params.orderbook &&
      params.orderbook.symbol.toUpperCase() === params.symbol.toUpperCase()
    ) {
      if (params.direction === "LONG" && params.orderbook.biggestBidWall) {
        anchorWallPrice = params.orderbook.biggestBidWall.price;
      } else if (
        params.direction === "SHORT" &&
        params.orderbook.biggestAskWall
      ) {
        anchorWallPrice = params.orderbook.biggestAskWall.price;
      }
    }

    // 3. Find Whale Campaign VWAP Anchor
    const matchingCamp = params.whaleCampaigns.find(
      (c) =>
        c.asset === asset &&
        c.side === (params.direction === "LONG" ? "BUY" : "SELL"),
    );
    const anchorWhaleVwap = matchingCamp ? matchingCamp.vwapPrice : price;

    // 4. Optimal Entry & Wall-Protected Stop-Loss (placed behind Wall + 0.6x ATR buffer)
    const optimalEntryPrice = price;
    let protectedStopLoss: number;
    if (params.direction === "LONG") {
      const supportBase = Math.min(price * 0.996, anchorWallPrice);
      protectedStopLoss = Math.min(
        price - atr14Usd * 1.1,
        supportBase - atr14Usd * 0.45,
      );
    } else {
      const resistanceBase = Math.max(price * 1.004, anchorWallPrice);
      protectedStopLoss = Math.max(
        price + atr14Usd * 1.1,
        resistanceBase + atr14Usd * 0.45,
      );
    }

    const stopDistanceUsd = Math.max(
      price * 0.0025,
      Math.abs(optimalEntryPrice - protectedStopLoss),
    );
    const stopDistancePercent = (stopDistanceUsd / optimalEntryPrice) * 100;

    // 5. Exact Position Sizing from Risk Budget
    // Loss at Stop = positionSizeCoins * stopDistanceUsd = maxRiskDollarUsd
    const positionSizeCoins = maxRiskDollarUsd / stopDistanceUsd;
    const positionNotionalUsd = positionSizeCoins * optimalEntryPrice;

    // Recommended safe leverage (capped so liquidation is far beyond stop-loss)
    const rawLeverage = positionNotionalUsd / safeBalance;
    const recommendedLeverage = Number(
      Math.max(1, Math.min(20, Math.ceil(rawLeverage * 10) / 10)).toFixed(1),
    );

    // 6. Take-Profit Targets (1.5R, 2.5R, and 50x Opposing Liquidation Magnet)
    const dirSign = params.direction === "LONG" ? 1 : -1;
    const takeProfit1_15R = optimalEntryPrice + dirSign * stopDistanceUsd * 1.5;
    const takeProfit2_25R = optimalEntryPrice + dirSign * stopDistanceUsd * 2.5;

    let takeProfit3_Magnet =
      optimalEntryPrice + dirSign * stopDistanceUsd * 3.8;
    if (params.magnetMap) {
      if (
        params.direction === "LONG" &&
        params.magnetMap.upperShortSqueezePools[1]
      ) {
        takeProfit3_Magnet = Math.max(
          takeProfit2_25R * 1.003,
          params.magnetMap.upperShortSqueezePools[1].priceLevel,
        );
      } else if (
        params.direction === "SHORT" &&
        params.magnetMap.lowerLongFlushPools[1]
      ) {
        takeProfit3_Magnet = Math.min(
          takeProfit2_25R * 0.997,
          params.magnetMap.lowerLongFlushPools[1].priceLevel,
        );
      }
    }

    // 7. Half-Kelly Optimal Fraction: f* = p - (1 - p) / b
    const winProb = Math.max(
      0.48,
      Math.min(0.78, (params.winRatePercent || 64) / 100),
    );
    const rewardToRiskRatio = 2.5;
    const fullKelly = winProb - (1 - winProb) / rewardToRiskRatio;
    const kellyFractionPercent = Number(
      Math.max(2, Math.min(35, fullKelly * 0.5 * 100)).toFixed(1),
    );

    const decimals = price < 10 ? 4 : 2;
    const setupRationale =
      params.direction === "LONG"
        ? `Stop-Loss ($${protectedStopLoss.toFixed(decimals)}) is shielded below L2 Bid Wall ($${anchorWallPrice.toFixed(decimals)}) + 0.45x ATR noise buffer ($${atr14Usd.toFixed(decimals)}). TP3 targets the 50x Short Squeeze Liquidation Magnet at $${takeProfit3_Magnet.toFixed(decimals)}.`
        : `Stop-Loss ($${protectedStopLoss.toFixed(decimals)}) is shielded above L2 Ask Wall ($${anchorWallPrice.toFixed(decimals)}) + 0.45x ATR noise buffer ($${atr14Usd.toFixed(decimals)}). TP3 targets the 50x Long Flush Liquidation Magnet at $${takeProfit3_Magnet.toFixed(decimals)}.`;

    return {
      symbol: params.symbol.toUpperCase(),
      asset,
      direction: params.direction,
      accountBalanceUsd: safeBalance,
      riskPercent: safeRiskPct,
      maxRiskDollarUsd: Number(maxRiskDollarUsd.toFixed(2)),
      currentPrice: price,
      atr14Usd: Number(atr14Usd.toFixed(decimals)),
      atr14Percent: Number(atr14Percent.toFixed(2)),
      anchorWallPrice: Number(anchorWallPrice.toFixed(decimals)),
      anchorWhaleVwap: Number(anchorWhaleVwap.toFixed(decimals)),
      optimalEntryPrice: Number(optimalEntryPrice.toFixed(decimals)),
      protectedStopLoss: Number(protectedStopLoss.toFixed(decimals)),
      stopDistanceUsd: Number(stopDistanceUsd.toFixed(decimals)),
      stopDistancePercent: Number(stopDistancePercent.toFixed(2)),
      positionSizeCoins: Number(positionSizeCoins.toFixed(4)),
      positionNotionalUsd: Math.round(positionNotionalUsd),
      recommendedLeverage,
      kellyFractionPercent,
      takeProfit1_15R: Number(takeProfit1_15R.toFixed(decimals)),
      takeProfit2_25R: Number(takeProfit2_25R.toFixed(decimals)),
      takeProfit3_Magnet: Number(takeProfit3_Magnet.toFixed(decimals)),
      rewardToRiskRatio,
      setupRationale,
    };
  }
}
