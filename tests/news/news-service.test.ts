import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NewsService } from "../../src/news/news-service.js";

describe("NewsService - Lexicon Sentiment & Wire Snapshot", () => {
  const service = NewsService.getInstance();

  it("scores bullish and bearish headlines accurately", () => {
    const bullish = service.scoreSentiment(
      "BlackRock Spot Bitcoin ETF Records Massive Institutional Inflows",
    );
    assert.equal(bullish.label, "BULLISH");
    assert.ok(bullish.score > 0);

    const bearish = service.scoreSentiment(
      "DeFi Protocol Hacked for $40 Million in Major Exploit and Sell-Off",
    );
    assert.equal(bearish.label, "BEARISH");
    assert.ok(bearish.score < 0);

    const neutral = service.scoreSentiment(
      "Bitcoin Miner Difficulty Adjusts Automatically at Epoch Block",
    );
    assert.equal(neutral.label, "NEUTRAL");
  });

  it("builds a complete institutional news snapshot", () => {
    const snapshot = service.buildSnapshot();
    assert.ok(snapshot.articles.length > 0);
    assert.ok(
      snapshot.marketSentimentIndex >= 0 &&
        snapshot.marketSentimentIndex <= 100,
    );
    assert.ok(typeof snapshot.marketSentimentLabel === "string");
  });
});
