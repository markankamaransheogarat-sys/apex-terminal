import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApexTerminalApp } from "../../src/index.js";

describe("ApexTerminalApp End-to-End Integration", () => {
  const app = new ApexTerminalApp();

  it("executes BTC <GO> command", async () => {
    const output = await app.executeCommand("BTC <GO>");
    assert.ok(output.includes("SECURITY DESCRIPTION: BTC"));
    assert.ok(output.includes("LAST PRICE"));
  });

  it("executes ETH <GO> and SOL <GO> commands", async () => {
    const ethOut = await app.executeCommand("ETH <GO>");
    assert.ok(ethOut.includes("SECURITY DESCRIPTION: ETH"));

    const solOut = await app.executeCommand("SOL <GO>");
    assert.ok(solOut.includes("SECURITY DESCRIPTION: SOL"));
  });

  it("executes RISK <GO> command", async () => {
    const riskOut = await app.executeCommand("RISK <GO>");
    assert.ok(riskOut.includes("BLACKROCK ALADDIN RISK ANALYTICS"));
    assert.ok(riskOut.includes("PARAMETRIC VALUE-AT-RISK"));
    assert.ok(riskOut.includes("BTC Benchmark Beta"));
  });

  it("executes FUND <GO> command", async () => {
    const fundOut = await app.executeCommand("FUND <GO>");
    assert.ok(fundOut.includes("BINANCE FUTURES FUNDING RATE HEATMAP"));
    assert.ok(fundOut.includes("BTCUSDT"));
  });

  it("executes NEWS <GO> command", async () => {
    const newsOut = await app.executeCommand("NEWS <GO>");
    assert.ok(newsOut.includes("FEAR & GREED INDEX"));
  });

  it("executes PORT <GO> command", async () => {
    const portOut = await app.executeCommand("PORT <GO>");
    assert.ok(portOut.includes("PORTFOLIO HOLDINGS"));
    assert.ok(portOut.includes("TOTAL NAV"));
  });

  it("executes STRESS <GO> command", async () => {
    const stressOut = await app.executeCommand("STRESS <GO>");
    assert.ok(stressOut.includes("BLACKROCK ALADDIN MULTI-FACTOR STRESS TEST"));
    assert.ok(stressOut.includes("Baseline NAV"));
    assert.ok(stressOut.includes("CRYPTO_CRASH_20"));
  });

  it("executes HELP <GO> command", async () => {
    const helpOut = await app.executeCommand("HELP <GO>");
    assert.ok(helpOut.includes("BLOOMBERG APEX TERMINAL USER MANUAL"));
  });

  it("handles invalid command gracefully with syntax guide", async () => {
    const errOut = await app.executeCommand("FOOBAR_NONSENSE <GO>");
    assert.ok(errOut.includes("SYNTAX ERROR"));
    assert.ok(errOut.includes("HELP <GO>"));
  });
});
