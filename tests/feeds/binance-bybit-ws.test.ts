import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BinanceWsFeedManager } from "../../src/feeds/binance-ws.js";
import { BybitWsFeedManager } from "../../src/feeds/bybit-ws.js";
import { MarketTicker } from "../../src/types/index.js";

describe("BinanceWsFeedManager", () => {
  it("generates correct stream URLs", () => {
    const mgr1 = new BinanceWsFeedManager({
      symbols: ["BTCUSDT", "ETHUSDT"],
      useMiniTickerArray: false,
    });
    assert.equal(
      mgr1.getStreamUrl(),
      "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker",
    );

    const mgr2 = new BinanceWsFeedManager({ useMiniTickerArray: true });
    assert.equal(
      mgr2.getStreamUrl(),
      "wss://stream.binance.com:9443/ws/!miniTicker@arr",
    );
  });

  it("parses combined stream 24hr ticker envelope", () => {
    const mgr = new BinanceWsFeedManager({ symbols: ["BTCUSDT"] });
    const received: MarketTicker[] = [];
    mgr.onTicker((t) => received.push(t));

    const sampleMessage = JSON.stringify({
      stream: "btcusdt@ticker",
      data: {
        e: "24hrTicker",
        E: 1731000000123,
        s: "BTCUSDT",
        p: "1500.00",
        P: "1.62",
        c: "94250.00",
        h: "95100.00",
        l: "92100.00",
        v: "25410.5",
        q: "2394871234.5",
        b: "94249.00",
        a: "94251.00",
      },
    });

    mgr.handleMessage(sampleMessage);

    assert.equal(received.length, 1);
    const tick = received[0]!;
    assert.equal(tick.symbol, "BTCUSDT");
    assert.equal(tick.price, 94250);
    assert.equal(tick.bidPrice, 94249);
    assert.equal(tick.askPrice, 94251);
    assert.equal(tick.high24h, 95100);
    assert.equal(tick.low24h, 92100);
    assert.equal(tick.priceChangePercent24h, 1.62);
    assert.equal(tick.source, "BINANCE_WS");
  });

  it("parses array miniTicker format", () => {
    const mgr = new BinanceWsFeedManager({
      symbols: ["ETHUSDT"],
      useMiniTickerArray: true,
    });
    const received: MarketTicker[] = [];
    mgr.onTicker((t) => received.push(t));

    const sampleArray = JSON.stringify([
      {
        e: "24hrMiniTicker",
        E: 1731000000000,
        s: "ETHUSDT",
        c: "3450.50",
        o: "3350.00",
        h: "3500.00",
        l: "3320.00",
        v: "85200.0",
        q: "293940000.0",
      },
      {
        e: "24hrMiniTicker",
        E: 1731000000000,
        s: "UNKNOWNUSDT", // Not whitelisted
        c: "1.00",
        h: "1.00",
        l: "1.00",
        v: "10.0",
        q: "10.0",
      },
    ]);

    mgr.handleMessage(sampleArray);

    assert.equal(received.length, 1);
    assert.equal(received[0]!.symbol, "ETHUSDT");
    assert.equal(received[0]!.price, 3450.5);
    assert.equal(received[0]!.high24h, 3500);
  });
});

describe("BybitWsFeedManager", () => {
  it("generates correct linear and spot stream URLs", () => {
    const linear = new BybitWsFeedManager({ category: "linear" });
    assert.equal(
      linear.getStreamUrl(),
      "wss://stream.bybit.com/v5/public/linear",
    );

    const spot = new BybitWsFeedManager({ category: "spot" });
    assert.equal(spot.getStreamUrl(), "wss://stream.bybit.com/v5/public/spot");
  });

  it("parses Bybit V5 ticker messages and responds to heartbeat", () => {
    const mgr = new BybitWsFeedManager({ symbols: ["SOLUSDT"] });
    const received: MarketTicker[] = [];
    mgr.onTicker((t) => received.push(t));

    // 1. Heartbeat pong
    mgr.handleMessage(JSON.stringify({ op: "pong" }));
    assert.equal(received.length, 0);

    // 2. Ticker payload
    const bybitPayload = JSON.stringify({
      topic: "tickers.SOLUSDT",
      type: "snapshot",
      ts: 1731000000456,
      data: {
        symbol: "SOLUSDT",
        lastPrice: "198.45",
        highPrice24h: "205.10",
        lowPrice24h: "190.20",
        volume24h: "1240000.5",
        turnover24h: "246083000.0",
        price24hPcnt: "0.0435", // 4.35%
        bid1Price: "198.40",
        ask1Price: "198.50",
      },
    });

    mgr.handleMessage(bybitPayload);

    assert.equal(received.length, 1);
    const tick = received[0]!;
    assert.equal(tick.symbol, "SOLUSDT");
    assert.equal(tick.price, 198.45);
    assert.equal(tick.high24h, 205.1);
    assert.equal(tick.priceChangePercent24h, 4.35);
    assert.equal(tick.bidPrice, 198.4);
    assert.equal(tick.askPrice, 198.5);
    assert.equal(tick.source, "BYBIT_WS");
  });
});
