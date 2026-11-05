import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RestFallbackService } from "../../src/feeds/fallback-rest.js";

describe("RestFallbackService", () => {
  it("fetches and caches Alternative.me Fear & Greed data", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              value: "82",
              value_classification: "Extreme Greed",
              timestamp: "1731000000",
            },
          ],
        }),
      } as unknown as Response;
    };

    const service = new RestFallbackService({
      fetchImpl: mockFetch as unknown as typeof fetch,
      cacheTtlMs: 5000,
    });

    const res1 = await service.fetchFearAndGreed();
    assert.equal(res1.value, 82);
    assert.equal(res1.valueClassification, "Extreme Greed");
    assert.equal(callCount, 1);

    // Second call should return cached data without additional HTTP request
    const res2 = await service.fetchFearAndGreed();
    assert.equal(res2.value, 82);
    assert.equal(callCount, 1);
  });

  it("fetches and formats Binance 24hr tickers", async () => {
    const mockFetch = async () => {
      return {
        ok: true,
        json: async () => [
          {
            symbol: "BTCUSDT",
            lastPrice: "94120.00",
            bidPrice: "94119.00",
            askPrice: "94121.00",
            highPrice: "95200.00",
            lowPrice: "92800.00",
            volume: "31200.5",
            quoteVolume: "2936591040.0",
            priceChange: "1320.00",
            priceChangePercent: "1.42",
            closeTime: 1731000000000,
          },
          {
            symbol: "ETHUSDT",
            lastPrice: "3420.00",
            bidPrice: "3419.50",
            askPrice: "3420.50",
            highPrice: "3500.00",
            lowPrice: "3350.00",
            volume: "110000.0",
            quoteVolume: "376200000.0",
            priceChange: "-45.00",
            priceChangePercent: "-1.30",
            closeTime: 1731000000000,
          },
        ],
      } as unknown as Response;
    };

    const service = new RestFallbackService({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const tickers = await service.fetchBinance24hrTickers([
      "BTCUSDT",
      "ETHUSDT",
    ]);
    assert.equal(tickers.length, 2);

    const btc = tickers.find((t) => t.symbol === "BTCUSDT")!;
    assert.equal(btc.price, 94120);
    assert.equal(btc.bidPrice, 94119);
    assert.equal(btc.priceChangePercent24h, 1.42);
    assert.equal(btc.source, "REST_FALLBACK");
  });

  it("triggers circuit breaker upon consecutive HTTP errors", async () => {
    let failCount = 0;
    const failingFetch = async () => {
      failCount++;
      return {
        ok: false,
        status: 503,
      } as unknown as Response;
    };

    const service = new RestFallbackService({
      fetchImpl: failingFetch as unknown as typeof fetch,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 10000,
    });

    // Fire 3 failing requests
    await service.fetchFearAndGreed();
    await service.fetchFearAndGreed();
    await service.fetchFearAndGreed();

    assert.equal(failCount, 3);
    assert.equal(service.isCircuitOpen(), true);

    // 4th request must not trigger fetchImpl because circuit is open
    const fallbackData = await service.fetchFearAndGreed();
    assert.equal(failCount, 3); // Unchanged!
    assert.ok(
      fallbackData.valueClassification.includes("Fallback") ||
        fallbackData.valueClassification.includes("Offline"),
    );
  });
});
