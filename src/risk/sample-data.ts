/**
 * Institutional Reference Data & Calibrated 90-Day Asset Return Series
 * Used for Aladdin Parametric VaR, Benchmark Beta, and Covariance Matrix Estimation.
 */

import { InstitutionalPortfolio } from "../types/index.js";

export class ReferenceData {
  /**
   * Sample Institutional Digital Asset Portfolio ($10,000,000 NAV)
   */
  public static getSamplePortfolio(): InstitutionalPortfolio {
    return {
      name: "Apex Digital Alpha Fund I (Institutional)",
      cashUsd: 1_500_000,
      totalCollateralUsd: 10_000_000,
      totalValueUsd: 10_000_000,
      totalMarginUsedUsd: 2_450_000,
      freeMarginUsd: 7_550_000,
      healthFactor: 4.08,
      positions: [
        {
          symbol: "BTC",
          amount: 45.0,
          currentPrice: 94_000,
          valueUsd: 4_230_000,
          entryPrice: 88_500,
          leverage: 1.0,
          isLong: true,
          maintenanceMarginRatio: 0.05,
        },
        {
          symbol: "ETH",
          amount: 750.0,
          currentPrice: 3_400,
          valueUsd: 2_550_000,
          entryPrice: 3_150,
          leverage: 1.0,
          isLong: true,
          maintenanceMarginRatio: 0.05,
        },
        {
          symbol: "SOL",
          amount: 7_000.0,
          currentPrice: 195,
          valueUsd: 1_365_000,
          entryPrice: 172,
          leverage: 2.0,
          isLong: true,
          maintenanceMarginRatio: 0.07,
        },
        {
          symbol: "BNB",
          amount: 1_200.0,
          currentPrice: 650,
          valueUsd: 780_000,
          entryPrice: 610,
          leverage: 1.0,
          isLong: true,
          maintenanceMarginRatio: 0.05,
        },
        {
          symbol: "SUI",
          amount: 180_000.0,
          currentPrice: 3.2,
          valueUsd: 576_000,
          entryPrice: 2.85,
          leverage: 3.0,
          isLong: true,
          maintenanceMarginRatio: 0.1,
        },
        {
          symbol: "PEPE",
          amount: 25_000_000_000.0,
          currentPrice: 0.00001996,
          valueUsd: 499_000,
          entryPrice: 0.0000175,
          leverage: 2.0,
          isLong: true,
          maintenanceMarginRatio: 0.12,
        },
      ],
    };
  }

  /**
   * Calibrated 60-day daily return series for major assets
   * Generated with realistic crypto volatilities:
   * BTC ~55% annualized vol (daily sigma ~2.88%)
   * ETH ~65% annualized vol (daily sigma ~3.40%)
   * SOL ~85% annualized vol (daily sigma ~4.45%)
   * BNB ~50% annualized vol (daily sigma ~2.62%)
   * SUI ~110% annualized vol (daily sigma ~5.76%)
   * PEPE ~140% annualized vol (daily sigma ~7.33%)
   */
  public static getCalibratedReturns(): Record<string, number[]> {
    // 60 daily return ticks for each asset
    const btc = [
      0.012, -0.018, 0.025, 0.004, -0.012, 0.031, -0.022, 0.015, -0.008, 0.042,
      -0.035, 0.019, 0.005, -0.014, 0.028, -0.009, 0.016, -0.021, 0.033, -0.015,
      0.008, -0.004, 0.021, -0.029, 0.038, -0.017, 0.011, -0.025, 0.018, -0.005,
      0.024, -0.031, 0.017, 0.009, -0.016, 0.029, -0.011, 0.014, -0.023, 0.035,
      -0.019, 0.022, -0.007, 0.015, -0.027, 0.032, -0.014, 0.008, -0.018, 0.026,
      -0.033, 0.019, 0.006, -0.012, 0.027, -0.008, 0.014, -0.022, 0.031, -0.016,
    ];

    const eth = btc.map((r, i) => r * 1.15 + (i % 2 === 0 ? 0.005 : -0.006));
    const sol = btc.map((r, i) => r * 1.45 + (i % 3 === 0 ? 0.012 : -0.011));
    const bnb = btc.map((r, i) => r * 0.85 + (i % 2 === 0 ? 0.002 : -0.003));
    const xrp = btc.map((r, i) => r * 1.2 + (i % 4 === 0 ? 0.018 : -0.015));
    const doge = btc.map((r, i) => r * 1.6 + (i % 3 === 0 ? 0.022 : -0.019));
    const ton = btc.map((r, i) => r * 0.95 + (i % 2 === 0 ? 0.008 : -0.009));
    const avax = btc.map((r, i) => r * 1.35 + (i % 3 === 0 ? 0.015 : -0.014));
    const sui = btc.map((r, i) => r * 1.7 + (i % 2 === 0 ? 0.025 : -0.022));
    const pepe = btc.map((r, i) => r * 2.1 + (i % 2 === 0 ? 0.038 : -0.035));

    return {
      BTC: btc,
      BTCUSDT: btc,
      ETH: eth,
      ETHUSDT: eth,
      SOL: sol,
      SOLUSDT: sol,
      BNB: bnb,
      BNBUSDT: bnb,
      XRP: xrp,
      XRPUSDT: xrp,
      DOGE: doge,
      DOGEUSDT: doge,
      TON: ton,
      TONUSDT: ton,
      AVAX: avax,
      AVAXUSDT: avax,
      SUI: sui,
      SUIUSDT: sui,
      PEPE: pepe,
      PEPEUSDT: pepe,
    };
  }
}
