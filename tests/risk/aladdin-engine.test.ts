import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AladdinRiskEngine } from "../../src/risk/aladdin-engine.js";
import { ReferenceData } from "../../src/risk/sample-data.js";
import { InstitutionalPortfolio } from "../../src/types/index.js";

describe("BlackRock Aladdin Risk Engine", () => {
  const portfolio = ReferenceData.getSamplePortfolio();
  const returns = ReferenceData.getCalibratedReturns();

  it("calculates 1-day Parametric VaR at 95% and 99% confidence", () => {
    const var95 = AladdinRiskEngine.calculateParametricVaR(
      portfolio,
      returns,
      0.95,
      1,
    );
    const var99 = AladdinRiskEngine.calculateParametricVaR(
      portfolio,
      returns,
      0.99,
      1,
    );

    assert.equal(var95.portfolioValueUsd, 10_000_000);
    assert.ok(var95.dailyVolatility > 0.02 && var95.dailyVolatility < 0.06);
    assert.ok(
      var95.annualizedVolatility > 0.4 && var95.annualizedVolatility < 1.0,
    );

    // VaR 99% must be strictly greater than VaR 95%
    assert.ok(var99.parametricVaRUsd > var95.parametricVaRUsd);
    assert.ok(var99.zScore > var95.zScore);

    // Verify mathematical formula: VaR = V * Z * sigma
    const expectedVaR95 =
      var95.portfolioValueUsd * var95.zScore * var95.dailyVolatility;
    assert.ok(Math.abs(var95.parametricVaRUsd - expectedVaR95) < 1e-4);

    // Component VaR additivity property: sum(CVaR_i) == total VaR
    let sumComponentVaR = 0;
    for (const cVar of Object.values(var95.componentVaRUsd)) {
      sumComponentVaR += cVar;
    }
    assert.ok(Math.abs(sumComponentVaR - var95.parametricVaRUsd) < 1.0); // Within $1 dollar due to floating point
  });

  it("handles empty or zero-value portfolio gracefully", () => {
    const emptyPort: InstitutionalPortfolio = {
      name: "Empty Portfolio",
      positions: [],
      cashUsd: 0,
      totalCollateralUsd: 0,
      totalValueUsd: 0,
      totalMarginUsedUsd: 0,
      freeMarginUsd: 0,
      healthFactor: 0,
    };

    const varRes = AladdinRiskEngine.calculateParametricVaR(
      emptyPort,
      returns,
      0.95,
    );
    assert.equal(varRes.parametricVaRUsd, 0);
    assert.equal(varRes.dailyVolatility, 0);
  });

  it("calculates Portfolio Beta relative to BTC benchmark", () => {
    const betaRes = AladdinRiskEngine.calculateBeta(portfolio, returns, "BTC");

    assert.equal(betaRes.benchmarkSymbol, "BTC");
    // BTC's own beta to BTC must be 1.0
    assert.ok(Math.abs((betaRes.assetBetas.BTC ?? 0) - 1.0) < 1e-4);

    // Altcoins (SOL, SUI, PEPE) should have higher beta than 1.0
    assert.ok((betaRes.assetBetas.SOL ?? 0) > 1.0);
    assert.ok((betaRes.assetBetas.PEPE ?? 0) > 1.5);

    // Weighted beta sum equality
    let weightedSum = 0;
    for (const pos of portfolio.positions) {
      const w = pos.valueUsd / portfolio.totalValueUsd;
      weightedSum += w * (betaRes.assetBetas[pos.symbol] ?? 0);
    }
    assert.ok(Math.abs(betaRes.portfolioBeta - weightedSum) < 1e-4);
    assert.ok(
      ["AGGRESSIVE", "MARKET_TRACKING", "DEFENSIVE"].includes(
        betaRes.systemicRiskClassification,
      ),
    );
  });

  it("runs multi-factor Stress Testing Scenario Engine", () => {
    const scenario = AladdinRiskEngine.DEFAULT_SCENARIOS.find(
      (s) => s.id === "CRYPTO_CRASH_20",
    )!;
    const stressResult = AladdinRiskEngine.runStressTest(portfolio, scenario);

    assert.equal(stressResult.scenarioId, "CRYPTO_CRASH_20");
    assert.ok(stressResult.totalDrawdownUsd > 0);
    assert.ok(stressResult.totalDrawdownPercent > 15);
    assert.ok(
      stressResult.stressedPortfolioValueUsd <
        stressResult.baselinePortfolioValueUsd,
    );

    // Check individual asset impacts (20% price shock + 0.05% funding surge = 20.05%)
    const btcImpact = stressResult.positionImpacts.BTC!;
    assert.ok(btcImpact);
    assert.ok(Math.abs(btcImpact.pnlDrawdownPercent - 20.05) < 0.01);
  });

  it("simulates leveraged position liquidation trigger in extreme crash", () => {
    // Construct a high-leverage portfolio
    const leveragedPort: InstitutionalPortfolio = {
      name: "High Leverage Long",
      cashUsd: 100_000,
      totalCollateralUsd: 100_000,
      totalValueUsd: 100_000,
      totalMarginUsedUsd: 100_000,
      freeMarginUsd: 0,
      healthFactor: 1.5,
      positions: [
        {
          symbol: "SOL",
          amount: 500, // 500 * $200 = $100,000 nominal
          currentPrice: 200,
          valueUsd: 100_000,
          leverage: 10.0, // 10x leverage
          isLong: true,
          maintenanceMarginRatio: 0.05, // 5% MMR
        },
      ],
    };

    // Extreme shock: SOL drops 30% (with 10x leverage, drop > 10% wipes out equity)
    const severeScenario = {
      id: "SEVERE_DUMP",
      name: "Severe 30% Dump",
      description: "SOL crashes 30%",
      shocks: { SOL: -0.3 },
    };

    const res = AladdinRiskEngine.runStressTest(leveragedPort, severeScenario);
    assert.ok(res.liquidatedPositions.includes("SOL"));
    assert.equal(res.positionImpacts.SOL!.isLiquidated, true);
    assert.equal(res.minimumLiquidationDistancePercent, 0);
  });

  it("calculates Institutional Diversification & Correlation Score (0 to 100)", () => {
    const divResult = AladdinRiskEngine.calculateDiversification(
      portfolio,
      returns,
    );

    // Score must be in [0, 100]
    assert.ok(divResult.score >= 0 && divResult.score <= 100);
    assert.ok(divResult.diversificationRatio >= 1.0);
    assert.ok(divResult.effectiveAssetsN > 1.0);
    assert.ok(
      [
        "CONCENTRATED",
        "MODERATE",
        "WELL_DIVERSIFIED",
        "OPTIMAL_HEDGE",
      ].includes(divResult.regime),
    );

    // Single asset portfolio must yield 0 diversification score
    const singlePort: InstitutionalPortfolio = {
      name: "Single Asset",
      cashUsd: 0,
      totalCollateralUsd: 1_000_000,
      totalValueUsd: 1_000_000,
      totalMarginUsedUsd: 0,
      freeMarginUsd: 1_000_000,
      healthFactor: 10.0,
      positions: [
        {
          symbol: "BTC",
          amount: 10,
          currentPrice: 100_000,
          valueUsd: 1_000_000,
        },
      ],
    };

    const singleDiv = AladdinRiskEngine.calculateDiversification(
      singlePort,
      returns,
    );
    assert.equal(singleDiv.score, 0);
    assert.equal(singleDiv.regime, "CONCENTRATED");
  });
});
