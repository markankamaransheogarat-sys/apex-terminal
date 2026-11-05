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
});
