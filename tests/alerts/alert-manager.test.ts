import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AlertManager } from "../../src/alerts/alert-manager.js";

describe("AlertManager - Thresholds and Notifications", () => {
  it("captures whale blocks and generates alerts", () => {
    const manager = AlertManager.getInstance();
    manager.clearAlerts();

    // Small trade below threshold ($10k)
    manager.checkWhaleTrade({
      asset: "BTC",
      side: "BUY",
      valueUsd: 10_000,
      price: 77000,
    });
    assert.equal(manager.getAlerts().length, 0);

    // Large whale trade ($1.2M)
    manager.checkWhaleTrade({
      asset: "BTC",
      side: "BUY",
      valueUsd: 1_200_000,
      price: 77000,
    });
    assert.equal(manager.getAlerts().length, 1);
    assert.equal(manager.getAlerts()[0]!.severity, "CRITICAL");
  });

  it("captures casualty liquidations exceeding threshold", () => {
    const manager = AlertManager.getInstance();
    manager.clearAlerts();

    manager.checkLiquidation({
      asset: "ETH",
      side: "LONG",
      valueUsd: 350_000,
      price: 2300,
    });
    assert.equal(manager.getAlerts().length, 1);
    assert.equal(manager.getAlerts()[0]!.type, "LIQUIDATION_SPIKE");
  });

  it("formats and dispatches institutional Quant Trade Setup tickets for Telegram & clipboard", async () => {
    const manager = AlertManager.getInstance();
    manager.clearAlerts();

    const res = await manager.dispatchTradeSetupTicket({
      symbol: "BTCUSDT",
      asset: "BTC",
      direction: "LONG",
      optimalEntryPrice: 85000,
      protectedStopLoss: 84150,
      stopDistancePercent: 1.0,
      setupRationale:
        "Protected behind $2.4M L2 Bid Wall at $84,300 + 0.45x ATR",
      positionSizeCoins: 0.25,
      positionNotionalUsd: 21250,
      recommendedLeverage: 3,
      kellyFractionPercent: 18.5,
      maxRiskDollarUsd: 212.5,
      takeProfit1_15R: 86275,
      takeProfit2_25R: 87125,
      takeProfit3_Magnet: 88400,
      rewardToRiskRatio: 3.1,
    });

    assert.ok(res.ticketText.includes("INSTITUTIONAL QUANT TICKET: LONG BTC"));
    assert.ok(res.ticketText.includes("Half-Kelly 18.5%"));
    assert.equal(manager.getAlerts().length, 1);
  });
});
