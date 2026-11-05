/**
 * Mathematical & Statistical Primitives for Aladdin Risk Engine
 * Zero external dependencies, high-performance numerical routines.
 */

export class RiskMath {
  /**
   * Compute arithmetic mean of an array of numbers.
   */
  public static mean(data: readonly number[]): number {
    if (data.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i]!;
    }
    return sum / data.length;
  }

  /**
   * Sample variance with Bessel's correction (N - 1).
   */
  public static variance(data: readonly number[]): number {
    if (data.length < 2) return 0;
    const avg = this.mean(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const diff = data[i]! - avg;
      sumSquares += diff * diff;
    }
    return sumSquares / (data.length - 1);
  }

  /**
   * Sample standard deviation.
   */
  public static stdDev(data: readonly number[]): number {
    return Math.sqrt(this.variance(data));
  }

  /**
   * Sample covariance between two sequences with Bessel's correction.
   */
  public static covariance(x: readonly number[], y: readonly number[]): number {
    const len = Math.min(x.length, y.length);
    if (len < 2) return 0;

    const meanX = this.mean(x.slice(0, len));
    const meanY = this.mean(y.slice(0, len));

    let sumProd = 0;
    for (let i = 0; i < len; i++) {
      sumProd += (x[i]! - meanX) * (y[i]! - meanY);
    }
    return sumProd / (len - 1);
  }

  /**
   * Pearson correlation coefficient rho in [-1.0, 1.0].
   */
  public static correlation(
    x: readonly number[],
    y: readonly number[],
  ): number {
    const cov = this.covariance(x, y);
    const sdX = this.stdDev(x);
    const sdY = this.stdDev(y);
    if (sdX === 0 || sdY === 0) return 0;
    const rho = cov / (sdX * sdY);
    // Clamp to [-1, 1] to avoid IEEE-754 precision drift
    return Math.max(-1, Math.min(1, rho));
  }

  /**
   * Build the sample covariance matrix for a dictionary of asset returns.
   */
  public static covarianceMatrix(
    returnsByAsset: Record<string, readonly number[]>,
    symbols: readonly string[],
  ): number[][] {
    const n = symbols.length;
    const matrix: number[][] = Array.from({ length: n }, () =>
      new Array<number>(n).fill(0),
    );

    for (let i = 0; i < n; i++) {
      const symI = symbols[i]!;
      const retI = returnsByAsset[symI] ?? [];
      for (let j = i; j < n; j++) {
        const symJ = symbols[j]!;
        const retJ = returnsByAsset[symJ] ?? [];
        const cov = this.covariance(retI, retJ);
        matrix[i]![j] = cov;
        matrix[j]![i] = cov; // Symmetric matrix
      }
    }
    return matrix;
  }

  /**
   * Matrix-vector product: result = M * v
   */
  public static matrixVectorMultiply(
    matrix: number[][],
    vector: number[],
  ): number[] {
    const rows = matrix.length;
    const cols = vector.length;
    const result = new Array<number>(rows).fill(0);

    for (let r = 0; r < rows; r++) {
      let sum = 0;
      const row = matrix[r]!;
      for (let c = 0; c < cols; c++) {
        sum += row[c]! * vector[c]!;
      }
      result[r] = sum;
    }
    return result;
  }

  /**
   * Quadratic form: w^T * Sigma * w (portfolio variance)
   */
  public static quadraticForm(weights: number[], matrix: number[][]): number {
    const sigmaW = this.matrixVectorMultiply(matrix, weights);
    let variance = 0;
    for (let i = 0; i < weights.length; i++) {
      variance += weights[i]! * sigmaW[i]!;
    }
    return Math.max(0, variance);
  }

  /**
   * Inverse Standard Normal Cumulative Distribution Function (Probit function).
   * High-precision rational approximation (Acklam's algorithm).
   * Accurate to 1.15 × 10^-9.
   */
  public static standardNormalInverseCdf(p: number): number {
    if (p <= 0 || p >= 1) {
      throw new RangeError(`Probability p must be in (0, 1), received: ${p}`);
    }

    // Common standard quantiles shortcut for fast paths
    if (Math.abs(p - 0.95) < 1e-6) return 1.6448536269514722;
    if (Math.abs(p - 0.99) < 1e-6) return 2.3263478740408408;
    if (Math.abs(p - 0.975) < 1e-6) return 1.959963984540054;
    if (Math.abs(p - 0.5) < 1e-6) return 0.0;

    // Coefficients in rational approximations
    const a = [
      -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
    ];

    const b = [
      -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1,
    ];

    const c = [
      -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783,
    ];

    const d = [
      7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
      3.754408661907416,
    ];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;

    let q: number;
    let r: number;

    if (p < pLow) {
      // Rational approximation for lower region
      q = Math.sqrt(-2 * Math.log(p));
      return (
        (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
          c[5]!) /
        ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
      );
    } else if (p <= pHigh) {
      // Rational approximation for central region
      q = p - 0.5;
      r = q * q;
      return (
        ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r +
          a[5]!) *
          q) /
        (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
      );
    } else {
      // Rational approximation for upper region
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(
        (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
          c[5]!) /
        ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
      );
    }
  }

  /**
   * Effective number of assets (Inverse Herfindahl-Hirschman Index).
   * N_eff = 1 / sum(w_i^2)
   */
  public static effectiveNumberOfAssets(weights: number[]): number {
    let sumSq = 0;
    for (let i = 0; i < weights.length; i++) {
      sumSq += weights[i]! * weights[i]!;
    }
    if (sumSq <= 0) return 0;
    return 1 / sumSq;
  }
}
