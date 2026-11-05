import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TerminalCommandProcessor } from "../../src/terminal/command-processor.js";

describe("TerminalCommandProcessor", () => {
  const processor = new TerminalCommandProcessor();

  it("parses core Bloomberg commands with <GO> syntax", () => {
    // 1. Tickers
    const btcCmd = processor.parse("BTC <GO>");
    assert.equal(btcCmd.isValid, true);
    assert.equal(btcCmd.commandType, "TICKER_VIEW");
    assert.equal(btcCmd.ticker, "BTC");
    assert.equal(btcCmd.hasGoToken, true);

    const ethCmd = processor.parse("eth <go>");
    assert.equal(ethCmd.isValid, true);
    assert.equal(ethCmd.commandType, "TICKER_VIEW");
    assert.equal(ethCmd.ticker, "ETH");

    const solCmd = processor.parse("SOL <GO>");
    assert.equal(solCmd.isValid, true);
    assert.equal(solCmd.commandType, "TICKER_VIEW");
    assert.equal(solCmd.ticker, "SOL");

    // 2. Global Actions
    const riskCmd = processor.parse("RISK <GO>");
    assert.equal(riskCmd.isValid, true);
    assert.equal(riskCmd.commandType, "RISK_MATRIX");

    const fundCmd = processor.parse("FUND <GO>");
    assert.equal(fundCmd.isValid, true);
    assert.equal(fundCmd.commandType, "FUNDING_HEATMAP");

    const newsCmd = processor.parse("NEWS <GO>");
    assert.equal(newsCmd.isValid, true);
    assert.equal(newsCmd.commandType, "NEWS_SENTIMENT");

    const portCmd = processor.parse("PORT <GO>");
    assert.equal(portCmd.isValid, true);
    assert.equal(portCmd.commandType, "PORTFOLIO_VIEW");

    const helpCmd = processor.parse("HELP <GO>");
    assert.equal(helpCmd.isValid, true);
    assert.equal(helpCmd.commandType, "HELP_VIEW");
  });

  it("handles implicit <GO> on bare commands", () => {
    const riskBare = processor.parse("RISK");
    assert.equal(riskBare.isValid, true);
    assert.equal(riskBare.commandType, "RISK_MATRIX");
    assert.equal(riskBare.hasGoToken, false);

    const btcBare = processor.parse("BTC");
    assert.equal(btcBare.isValid, true);
    assert.equal(btcBare.commandType, "TICKER_VIEW");
    assert.equal(btcBare.ticker, "BTC");
  });

  it("handles compound subcommands (e.g. BTC RISK <GO>)", () => {
    const btcRisk = processor.parse("BTC RISK <GO>");
    assert.equal(btcRisk.isValid, true);
    assert.equal(btcRisk.commandType, "RISK_MATRIX");
    assert.equal(btcRisk.ticker, "BTC");
  });

  it("returns structured error for invalid commands", () => {
    const empty = processor.parse("");
    assert.equal(empty.isValid, false);

    const invalid = processor.parse("INVALID_UNKNOWN_COMMAND_999 <GO>");
    assert.equal(invalid.isValid, false);
    assert.ok(invalid.errorMessage?.includes("Unrecognized"));
  });

  it("provides autocomplete matching for prefixes and tokens", () => {
    const btcMatches = processor.autocomplete("BT");
    assert.ok(btcMatches.length > 0);
    assert.equal(btcMatches[0]!.token, "BTC <GO>");

    const riskMatches = processor.autocomplete("RIS");
    assert.ok(riskMatches.some((m) => m.token === "RISK <GO>"));

    const allMatches = processor.autocomplete("");
    assert.ok(allMatches.length >= 10);
  });

  it("processes terminal function keys (Hotkeys F1-F8)", () => {
    assert.equal(processor.handleHotkey("F1")?.commandType, "HELP_VIEW");
    assert.equal(processor.handleHotkey("F2")?.ticker, "BTC");
    assert.equal(processor.handleHotkey("F3")?.commandType, "RISK_MATRIX");
    assert.equal(processor.handleHotkey("F4")?.commandType, "FUNDING_HEATMAP");
    assert.equal(processor.handleHotkey("F5")?.commandType, "NEWS_SENTIMENT");
    assert.equal(processor.handleHotkey("F8")?.commandType, "PORTFOLIO_VIEW");
    assert.equal(processor.handleHotkey("F12"), null);
  });

  it("manages command history buffer traversal", () => {
    const p = new TerminalCommandProcessor();
    p.pushHistory("BTC <GO>");
    p.pushHistory("RISK <GO>");
    p.pushHistory("FUND <GO>");

    assert.equal(p.historyPrevious(), "FUND <GO>");
    assert.equal(p.historyPrevious(), "RISK <GO>");
    assert.equal(p.historyPrevious(), "BTC <GO>");
    assert.equal(p.historyNext(), "RISK <GO>");
  });
});
