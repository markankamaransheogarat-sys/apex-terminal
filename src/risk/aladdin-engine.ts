/**
 * BlackRock Aladdin Risk Engine for Digital Assets
 * Implements Parametric VaR, Benchmark Beta decomposition,
 * Multi-factor stress testing with non-linear liquidation tracking,
 * and Institutional Diversification scoring (0-100).
 */

import {
  InstitutionalPortfolio,
  VaRResult,
  BetaResult,
  StressScenario,
  StressTestResult,
  DiversificationResult,
  PositionStressImpact,
} from "../types/index.js";
import { RiskMath } from "./math.js";

export class AladdinRiskEngine {
  /**
   * Predefined Institutional Stress Scenarios
   */
  public static readonly DEFAULT_SCENARIOS: StressScenario[] = [
    {
      id: "BTC_FLASH_10",
      name: "BTC Flash Drop (-10%)",
      description:
        "Sudden liquidity drain with Bitcoin dropping 10% and altcoins adjusting via beta.",
      shocks: { BTC: -0.1, ETH: -0.12, SOL: -0.15 },
      defaultAltShock: -0.14,
      fundingRateSurge: 0.0002,
    },
    {
      id: "CRYPTO_CRASH_20",
      name: "Crypto Crash 20% (Cascading Liquidations)",
      description:
        "System-wide market rout: BTC -20%, ETH -25%, major alts -30%, high perpetual funding volatility.",
      shocks: {
        BTC: -0.2,
        ETH: -0.25,
        SOL: -0.32,
        BNB: -0.22,
        XRP: -0.28,
        DOGE: -0.35,
        TON: -0.24,
        AVAX: -0.33,
        SUI: -0.35,
        PEPE: -0.4,
      },
      defaultAltShock: -0.3,
      fundingRateSurge: 0.0005,
    },
    {
      id: "BLACK_SWAN_35",
      name: "Black Swan Event (-35%)",
      description:
        "Extreme contagion shock: BTC down 35%, ETH down 42%, Altcoins collapsing up to 50%.",
      shocks: {
        BTC: -0.35,
        ETH: -0.42,
        SOL: -0.48,
        BNB: -0.38,
        XRP: -0.45,
        DOGE: -0.52,
        TON: -0.4,
        AVAX: -0.5,
        SUI: -0.5,
        PEPE: -0.6,
      },
      defaultAltShock: -0.45,
      fundingRateSurge: 0.0008,
    },
    {
      id: "FUNDING_SURGE_8BP",
      name: "Funding Rate Surge (+0.08% / 8h)",
      description:
        "Perpetual long funding spikes to +0.08% per 8h (87.6% APR), causing sustained carry bleed on leveraged positions.",
      shocks: { BTC: -0.02, ETH: -0.03 },
      defaultAltShock: -0.04,
      fundingRateSurge: 0.0008,
    },
    {
      id: "ALT_SEASON_ROTATION",
      name: "Alt Season Rotation (BTC Flat, Alts +25%)",
      description:
        "Capital rotation from BTC into high-beta ecosystems (SOL, SUI, AVAX +25%).",
      shocks: {
        BTC: 0.0,
        ETH: +0.1,
        SOL: +0.25,
        SUI: +0.3,
        AVAX: +0.25,
        DOGE: +0.2,
        PEPE: +0.35,
      },
      defaultAltShock: +0.15,
      fundingRateSurge: 0.0003,
    },
  ];

  /**
   * 1. Parametric Value-at-Risk (VaR 95% & 99% 1-day)
   * Formula: VaR = PortfolioValue * Z_(1-alpha) * sigma_portfolio * sqrt(horizonDays)
   */
  public static calculateParametricVaR(
    portfolio: InstitutionalPortfolio,
    returnsByAsset: Record<string, readonly number[]>,
    confidenceLevel: 0.95 | 0.99 = 0.95,
    horizonDays = 1,
  ): VaRResult {
    const portfolioValueUsd = portfolio.totalValueUsd;
    if (portfolioValueUsd <= 0 || portfolio.positions.length === 0) {
      return {
        portfolioValueUsd: 0,
        confidenceLevel,
        horizonDays,
        zScore: RiskMath.standardNormalInverseCdf(confidenceLevel),
        dailyVolatility: 0,
        annualizedVolatility: 0,
        parametricVaRUsd: 0,
        parametricVaRPercent: 0,
        componentVaRUsd: {},
        componentVaRPercent: {},
        marginalVaR: {},
      };
    }

    const symbols = portfolio.positions.map((p) => p.symbol);
    const weights = portfolio.positions.map(
      (p) => p.valueUsd / portfolioValueUsd,
    );

    // Compute covariance matrix
    const covMatrix = RiskMath.covarianceMatrix(returnsByAsset, symbols);

    // Portfolio daily variance: w^T * Sigma * w
    const dailyVariance = RiskMath.quadraticForm(weights, covMatrix);
    const dailyVolatility = Math.sqrt(dailyVariance);
    // Annualized volatility assuming 365 trading days for crypto
    const annualizedVolatility = dailyVolatility * Math.sqrt(365);

    const zScore = RiskMath.standardNormalInverseCdf(confidenceLevel);
    const horizonFactor = Math.sqrt(horizonDays);

    const parametricVaRUsd =
      portfolioValueUsd * zScore * dailyVolatility * horizonFactor;
    const parametricVaRPercent =
      portfolioValueUsd > 0 ? (parametricVaRUsd / portfolioValueUsd) * 100 : 0;

    // Marginal VaR & Component VaR decomposition
    // Marginal VaR_i = Z * horizonFactor * (Sigma * w)_i / dailyVolatility
    const sigmaW = RiskMath.matrixVectorMultiply(covMatrix, weights);
    const marginalVaR: Record<string, number> = {};
    const componentVaRUsd: Record<string, number> = {};
    const componentVaRPercent: Record<string, number> = {};

    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]!;
      const w_i = weights[i]!;
      let mVar_i = 0;
      if (dailyVolatility > 0) {
        mVar_i = (zScore * horizonFactor * (sigmaW[i] ?? 0)) / dailyVolatility;
      }
      marginalVaR[sym] = mVar_i;
      // Component VaR = w_i * MVaR_i * PortfolioValue
      const cVarUsd = w_i * mVar_i * portfolioValueUsd;
      componentVaRUsd[sym] = cVarUsd;
      componentVaRPercent[sym] =
        parametricVaRUsd > 0 ? (cVarUsd / parametricVaRUsd) * 100 : 0;
    }

    return {
      portfolioValueUsd,
      confidenceLevel,
      horizonDays,
      zScore,
      dailyVolatility,
      annualizedVolatility,
      parametricVaRUsd,
      parametricVaRPercent,
      componentVaRUsd,
      componentVaRPercent,
      marginalVaR,
    };
  }

  /**
   * 2. Portfolio Beta Relative to Benchmark (Default: BTC)
   * Formula: Beta_p = Cov(R_p, R_btc) / Var(R_btc) = sum(w_i * Beta_i)
   */
  public static calculateBeta(
    portfolio: InstitutionalPortfolio,
    returnsByAsset: Record<string, readonly number[]>,
    benchmarkSymbol = "BTC",
  ): BetaResult {
    const btcReturns = returnsByAsset[benchmarkSymbol] ?? [];
    const btcVariance = RiskMath.variance(btcReturns);

    if (
      btcVariance <= 0 ||
      portfolio.positions.length === 0 ||
      portfolio.totalValueUsd <= 0
    ) {
      return {
        benchmarkSymbol,
        portfolioBeta: 1.0,
        assetBetas: {},
        covarianceWithBenchmark: 0,
        benchmarkVariance: btcVariance,
        systemicRiskClassification: "MARKET_TRACKING",
      };
    }

    const assetBetas: Record<string, number> = {};
    let weightedBetaSum = 0;
    let totalCovariance = 0;

    for (const pos of portfolio.positions) {
      const weight = pos.valueUsd / portfolio.totalValueUsd;
      const assetReturns = returnsByAsset[pos.symbol] ?? [];
      const cov = RiskMath.covariance(assetReturns, btcReturns);
      const beta = cov / btcVariance;

      assetBetas[pos.symbol] = beta;
      weightedBetaSum += weight * beta;
      totalCovariance += weight * cov;
    }

    let classification: BetaResult["systemicRiskClassification"];
    if (weightedBetaSum > 1.2) {
      classification = "AGGRESSIVE";
    } else if (weightedBetaSum >= 0.8 && weightedBetaSum <= 1.2) {
      classification = "MARKET_TRACKING";
    } else if (weightedBetaSum >= 0 && weightedBetaSum < 0.8) {
      classification = "DEFENSIVE";
    } else {
      classification = "NEGATIVE_CORRELATED";
    }

    return {
      benchmarkSymbol,
      portfolioBeta: weightedBetaSum,
      assetBetas,
      covarianceWithBenchmark: totalCovariance,
      benchmarkVariance: btcVariance,
      systemicRiskClassification: classification,
    };
  }

  /**
   * 3. Stress Testing Scenario Engine
   * Simulates multi-factor shocks, projected PnL drawdown, funding surge,
   * margin maintenance, and liquidation proximity.
   */
  public static runStressTest(
    portfolio: InstitutionalPortfolio,
    scenario: StressScenario,
  ): StressTestResult {
    const baselinePortfolioValueUsd = portfolio.totalValueUsd;
    let stressedValueTotalUsd = portfolio.cashUsd;
    let totalDrawdownUsd = 0;
    let totalStressedMarginReqUsd = 0;
    let totalFundingSurgeCostUsd = 0;

    const positionImpacts: Record<string, PositionStressImpact> = {};
    const liquidatedPositions: string[] = [];
    let minDistanceToLiq = Infinity;

    for (const pos of portfolio.positions) {
      // Find shock factor: asset specific shock, or default alt shock, or 0
      const shockFactor =
        scenario.shocks[pos.symbol] ?? scenario.defaultAltShock ?? 0;

      const initialPrice = pos.currentPrice;
      const stressedPrice = Math.max(0, initialPrice * (1 + shockFactor));
      const leverage = pos.leverage ?? 1;
      const isLong = pos.isLong ?? true;
      const mmr = pos.maintenanceMarginRatio ?? 0.05; // 5% default MMR

      // Nominal position value
      const nominalValue = pos.amount * initialPrice;
      // PnL calculation considering direction and leverage
      let pnlUsd = 0;
      if (isLong) {
        pnlUsd = pos.amount * (stressedPrice - initialPrice);
      } else {
        // Short position profits when price drops
        pnlUsd = pos.amount * (initialPrice - stressedPrice);
      }

      // Funding rate surge cost: fundingRateSurge * nominalValue for longs, negative for shorts
      let fundingCost = 0;
      if (scenario.fundingRateSurge && scenario.fundingRateSurge !== 0) {
        // Longs pay funding surge, shorts receive
        fundingCost = isLong
          ? nominalValue * scenario.fundingRateSurge
          : -nominalValue * scenario.fundingRateSurge;
        totalFundingSurgeCostUsd += fundingCost;
      }

      const netPnlUsd = pnlUsd - fundingCost;
      const initialEquity = pos.valueUsd;
      const stressedEquity = Math.max(0, initialEquity + netPnlUsd);

      stressedValueTotalUsd += stressedEquity;
      const posDrawdown = initialEquity - stressedEquity;
      totalDrawdownUsd += posDrawdown;

      // Stressed maintenance margin requirement
      const stressedNominal = pos.amount * stressedPrice;
      const stressedMmrReq = stressedNominal * mmr;
      totalStressedMarginReqUsd += stressedMmrReq;

      // Liquidation calculation for leveraged positions (leverage > 1)
      let liquidationPrice: number | undefined;
      let isLiquidated = false;
      let distanceToLiqPercent = 100;

      if (leverage > 1) {
        if (isLong) {
          // LiqPrice = P0 * (1 - 1/Leverage + MMR)
          liquidationPrice = Math.max(
            0,
            initialPrice * (1 - 1 / leverage + mmr),
          );
          if (stressedPrice <= liquidationPrice) {
            isLiquidated = true;
          }
          if (initialPrice > 0) {
            distanceToLiqPercent =
              ((stressedPrice - liquidationPrice) / initialPrice) * 100;
          }
        } else {
          // Short: LiqPrice = P0 * (1 + 1/Leverage - MMR)
          liquidationPrice = initialPrice * (1 + 1 / leverage - mmr);
          if (stressedPrice >= liquidationPrice) {
            isLiquidated = true;
          }
          if (initialPrice > 0) {
            distanceToLiqPercent =
              ((liquidationPrice - stressedPrice) / initialPrice) * 100;
          }
        }

        if (isLiquidated) {
          liquidatedPositions.push(pos.symbol);
          distanceToLiqPercent = 0;
        }

        minDistanceToLiq = Math.min(minDistanceToLiq, distanceToLiqPercent);
      } else {
        // Spot holding: no hard liquidation, liquidation is 100% loss (price = 0)
        distanceToLiqPercent = 100 * (1 + shockFactor);
        minDistanceToLiq = Math.min(minDistanceToLiq, distanceToLiqPercent);
      }

      const initialMarginRatio =
        pos.valueUsd > 0 ? (pos.amount * initialPrice * mmr) / pos.valueUsd : 0;
      const stressedMarginRatio =
        stressedEquity > 0 ? stressedMmrReq / stressedEquity : 1.0;

      positionImpacts[pos.symbol] = {
        symbol: pos.symbol,
        initialValueUsd: initialEquity,
        stressedValueUsd: stressedEquity,
        pnlDrawdownUsd: posDrawdown,
        pnlDrawdownPercent:
          initialEquity > 0 ? (posDrawdown / initialEquity) * 100 : 0,
        initialMarginRatio,
        stressedMarginRatio,
        liquidationPrice,
        isLiquidated,
        distanceToLiquidationPercent: Math.max(0, distanceToLiqPercent),
      };
    }

    const baselineHealthFactor = portfolio.healthFactor;
    const stressedHealthFactor =
      totalStressedMarginReqUsd > 0
        ? stressedValueTotalUsd / totalStressedMarginReqUsd
        : 99.9;

    const totalDrawdownPercent =
      baselinePortfolioValueUsd > 0
        ? (totalDrawdownUsd / baselinePortfolioValueUsd) * 100
        : 0;

    const isPortfolioSolvent =
      stressedValueTotalUsd > 0 && stressedHealthFactor >= 1.0;

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      baselinePortfolioValueUsd,
      stressedPortfolioValueUsd: Math.max(0, stressedValueTotalUsd),
      totalDrawdownUsd,
      totalDrawdownPercent,
      fundingCostSurgeUsd: totalFundingSurgeCostUsd,
      baselineHealthFactor,
      stressedHealthFactor,
      liquidatedPositions,
      minimumLiquidationDistancePercent:
        minDistanceToLiq === Infinity ? 100 : Math.max(0, minDistanceToLiq),
      isPortfolioSolvent,
      positionImpacts,
    };
  }

  /**
   * 4. Institutional Diversification & Correlation Score (0 to 100)
   * Where 100 = uncorrelated multi-asset hedge, 0 = single asset or collinear portfolio.
   * Based on Diversification Ratio DR = sum(w_i * sigma_i) / sigma_p
   * and average off-diagonal correlation rho_bar.
   */
  public static calculateDiversification(
    portfolio: InstitutionalPortfolio,
    returnsByAsset: Record<string, readonly number[]>,
  ): DiversificationResult {
    const positions = portfolio.positions;
    const n = positions.length;

    if (n <= 1 || portfolio.totalValueUsd <= 0) {
      return {
        score: 0,
        diversificationRatio: 1.0,
        averageCorrelation: 1.0,
        effectiveAssetsN: Math.min(1, n),
        regime: "CONCENTRATED",
        correlationMatrix: {},
        assetWeights: {},
      };
    }

    const symbols = positions.map((p) => p.symbol);
    const weights = positions.map((p) => p.valueUsd / portfolio.totalValueUsd);
    const assetWeightsMap: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      assetWeightsMap[symbols[i]!] = weights[i]!;
    }

    // Individual asset volatilities
    const sigmas: number[] = [];
    let weightedVolSum = 0;
    for (let i = 0; i < n; i++) {
      const sym = symbols[i]!;
      const rets = returnsByAsset[sym] ?? [];
      const s = RiskMath.stdDev(rets);
      sigmas.push(s);
      weightedVolSum += weights[i]! * s;
    }

    // Covariance and portfolio volatility
    const covMatrix = RiskMath.covarianceMatrix(returnsByAsset, symbols);
    const portVar = RiskMath.quadraticForm(weights, covMatrix);
    const portVol = Math.sqrt(portVar);

    // Diversification Ratio DR = sum(w_i * sigma_i) / sigma_p
    const diversificationRatio = portVol > 0 ? weightedVolSum / portVol : 1.0;

    // Full Correlation Matrix & Average off-diagonal correlation
    const correlationMatrix: Record<string, Record<string, number>> = {};
    let offDiagCorrSum = 0;
    let offDiagPairs = 0;

    for (let i = 0; i < n; i++) {
      const symI = symbols[i]!;
      correlationMatrix[symI] = {};
      const retsI = returnsByAsset[symI] ?? [];

      for (let j = 0; j < n; j++) {
        const symJ = symbols[j]!;
        const retsJ = returnsByAsset[symJ] ?? [];
        const rho = RiskMath.correlation(retsI, retsJ);
        correlationMatrix[symI]![symJ] = rho;

        if (i !== j) {
          offDiagCorrSum += rho;
          offDiagPairs++;
        }
      }
    }

    const avgCorrelation =
      offDiagPairs > 0 ? offDiagCorrSum / offDiagPairs : 1.0;
    const effectiveAssetsN = RiskMath.effectiveNumberOfAssets(weights);

    // Score formulation (0 to 100):
    // Part 1: Correlation penalty (1 - avgCorrelation) / 2 in [0, 1]
    // Part 2: Diversification ratio benefit: clamp((DR - 1) / (sqrt(N) - 1), 0, 1)
    const corrComponent = Math.max(0, Math.min(1, (1 - avgCorrelation) / 2));
    const maxPossibleDr = Math.sqrt(n);
    const drComponent =
      maxPossibleDr > 1
        ? Math.max(
            0,
            Math.min(1, (diversificationRatio - 1) / (maxPossibleDr - 1)),
          )
        : 0;

    // Combined score weighted 60% correlation structure, 40% volatility dispersion
    const rawScore = 100 * (0.6 * corrComponent + 0.4 * drComponent);
    const score = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));

    let regime: DiversificationResult["regime"];
    if (score >= 80) {
      regime = "OPTIMAL_HEDGE";
    } else if (score >= 55) {
      regime = "WELL_DIVERSIFIED";
    } else if (score >= 25) {
      regime = "MODERATE";
    } else {
      regime = "CONCENTRATED";
    }

    return {
      score,
      diversificationRatio,
      averageCorrelation: avgCorrelation,
      effectiveAssetsN,
      regime,
      correlationMatrix,
      assetWeights: assetWeightsMap,
    };
  }
}
