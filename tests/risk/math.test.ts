import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RiskMath } from "../../src/risk/math.js";

describe("RiskMath Primitives", () => {
  it("calculates mean correctly", () => {
    assert.equal(RiskMath.mean([]), 0);
    assert.equal(RiskMath.mean([10]), 10);
    assert.equal(RiskMath.mean([2, 4, 6, 8]), 5);
  });

  it("calculates sample variance and stdDev with Bessels correction", () => {
    const data = [2, 4, 4, 4, 5, 5, 7, 9];
    // mean = 5, sum of squared diffs = 9+1+1+1+0+0+4+16 = 32. N-1 = 7. Var = 32/7 = 4.5714
    const variance = RiskMath.variance(data);
    assert.ok(Math.abs(variance - 32 / 7) < 1e-6);
    assert.ok(Math.abs(RiskMath.stdDev(data) - Math.sqrt(32 / 7)) < 1e-6);
  });

  it("calculates covariance and correlation between two vectors", () => {
    const x = [0.01, 0.02, -0.01, 0.03, -0.02];
    const y = [0.015, 0.025, -0.008, 0.035, -0.025]; // Strongly positively correlated

    const cov = RiskMath.covariance(x, y);
    const corr = RiskMath.correlation(x, y);

    assert.ok(cov > 0);
    assert.ok(corr > 0.95 && corr <= 1.0);

    // Identical vector correlation must be exactly 1.0
    assert.ok(Math.abs(RiskMath.correlation(x, x) - 1.0) < 1e-6);

    // Inverted vector correlation must be exactly -1.0
    const inv = x.map((v) => -v);
    assert.ok(Math.abs(RiskMath.correlation(x, inv) - -1.0) < 1e-6);
  });

  it("computes symmetric covariance matrix", () => {
    const returns = {
      BTC: [0.01, -0.02, 0.03, -0.01],
      ETH: [0.012, -0.025, 0.035, -0.012],
    };
    const matrix = RiskMath.covarianceMatrix(returns, ["BTC", "ETH"]);
    assert.equal(matrix.length, 2);
    assert.equal(matrix[0]!.length, 2);
    // Symmetric check
    assert.ok(Math.abs(matrix[0]![1]! - matrix[1]![0]!) < 1e-10);
    // Diagonal must equal variance
    assert.ok(
      Math.abs(matrix[0]![0]! - RiskMath.variance(returns.BTC)) < 1e-10,
    );
  });

  it("computes matrix-vector product and quadratic form correctly", () => {
    // 2x2 identity matrix
    const I = [
      [1, 0],
      [0, 1],
    ];
    const v = [3, 4];
    const mv = RiskMath.matrixVectorMultiply(I, v);
    assert.deepEqual(mv, [3, 4]);

    // w^T * I * w = 3^2 + 4^2 = 25
    const qf = RiskMath.quadraticForm(v, I);
    assert.equal(qf, 25);
  });

  it("computes standard normal inverse CDF with high precision", () => {
    // Known Z values
    const z95 = RiskMath.standardNormalInverseCdf(0.95);
    const z99 = RiskMath.standardNormalInverseCdf(0.99);
    const z50 = RiskMath.standardNormalInverseCdf(0.5);

    assert.ok(Math.abs(z95 - 1.6448536) < 1e-4);
    assert.ok(Math.abs(z99 - 2.3263478) < 1e-4);
    assert.equal(z50, 0);

    // Bounds checking
    assert.throws(() => RiskMath.standardNormalInverseCdf(0), RangeError);
    assert.throws(() => RiskMath.standardNormalInverseCdf(1), RangeError);
  });

  it("computes effective number of assets (inverse HHI)", () => {
    // 4 equally weighted assets (w_i = 0.25): N_eff = 1 / (4 * 0.0625) = 4.0
    const equalWeights = [0.25, 0.25, 0.25, 0.25];
    assert.equal(RiskMath.effectiveNumberOfAssets(equalWeights), 4);

    // 1 dominant asset (w_1 = 1.0): N_eff = 1.0
    assert.equal(RiskMath.effectiveNumberOfAssets([1.0]), 1);
  });
});
