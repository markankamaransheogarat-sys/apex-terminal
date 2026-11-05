/**
 * Bybit V5 Public WebSocket Feed Manager
 * Supports linear & spot ticker subscriptions, periodic ping heartbeats,
 * automatic reconnect, and parsing into normalized MarketTicker format.
 */

import { MarketTicker } from "../types/index.js";

export type BybitCategory = "linear" | "spot";
export type BybitWsState =
  "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "RECONNECTING" | "STALE";

export interface BybitWsOptions {
  category?: BybitCategory;
  symbols?: string[]; // e.g. ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  pingIntervalMs?: number;
  maxReconnectAttempts?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  watchdogIntervalMs?: number;
  stalenessThresholdMs?: number;
  webSocketConstructor?: typeof WebSocket;
}

export class BybitWsFeedManager {
  public static readonly DEFAULT_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "TONUSDT",
    "AVAXUSDT",
    "SUIUSDT",
    "PEPEUSDT",
  ];

  private readonly category: BybitCategory;
  private readonly symbols: string[];
  private readonly pingIntervalMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly stalenessThresholdMs: number;
  private readonly WebSocketClass: typeof WebSocket;

  private ws: WebSocket | null = null;
  private state: BybitWsState = "DISCONNECTED";
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastTickTimestamp = 0;
  private isDestroyed = false;

  private tickerListeners: Array<(ticker: MarketTicker) => void> = [];
  private stateListeners: Array<(state: BybitWsState) => void> = [];

  constructor(options: BybitWsOptions = {}) {
    this.category = options.category ?? "linear";
    this.symbols = options.symbols
      ? options.symbols.map((s) => s.toUpperCase())
      : [...BybitWsFeedManager.DEFAULT_SYMBOLS];
    this.pingIntervalMs = options.pingIntervalMs ?? 20000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 20;
    this.initialReconnectDelayMs = options.initialReconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? 10000;
    this.stalenessThresholdMs = options.stalenessThresholdMs ?? 25000;
    this.WebSocketClass =
      options.webSocketConstructor ??
      (globalThis.WebSocket as typeof WebSocket);
  }

  public getState(): BybitWsState {
    return this.state;
  }

  public getLastTickTimestamp(): number {
    return this.lastTickTimestamp;
  }

  public onTicker(listener: (ticker: MarketTicker) => void): () => void {
    this.tickerListeners.push(listener);
    return () => {
      this.tickerListeners = this.tickerListeners.filter((l) => l !== listener);
    };
  }

  public onStateChange(listener: (state: BybitWsState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  private setState(newState: BybitWsState): void {
    if (this.state !== newState) {
      this.state = newState;
      for (const listener of this.stateListeners) {
        try {
          listener(newState);
        } catch (err) {
          console.error("[BybitWS] State listener error:", err);
        }
      }
    }
  }

  public getStreamUrl(): string {
    return `wss://stream.bybit.com/v5/public/${this.category}`;
  }

  public connect(): void {
    if (this.isDestroyed) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.setState(this.reconnectAttempts > 0 ? "RECONNECTING" : "CONNECTING");
    const url = this.getStreamUrl();

    try {
      this.ws = new this.WebSocketClass(url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setState("CONNECTED");
        this.sendSubscriptions();
        this.startPing();
        this.startWatchdog();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.lastTickTimestamp = Date.now();
        this.handleMessage(event.data);
      };

      this.ws.onerror = (err) => {
        console.error("[BybitWS] WebSocket error:", err);
      };

      this.ws.onclose = () => {
        this.stopPing();
        this.stopWatchdog();
        if (!this.isDestroyed) {
          this.setState("DISCONNECTED");
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error("[BybitWS] Failed to instantiate WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  private sendSubscriptions(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const args = this.symbols.map((sym) => `tickers.${sym}`);
    const payload = JSON.stringify({
      op: "subscribe",
      args,
    });
    this.ws.send(payload);
  }

  public handleMessage(data: unknown): void {
    try {
      const text =
        typeof data === "string"
          ? data
          : data instanceof ArrayBuffer
            ? new TextDecoder().decode(data)
            : String(data);
      const parsed = JSON.parse(text);

      if (parsed.op === "pong") {
        // Heartbeat confirmed
        return;
      }

      if (
        parsed.topic &&
        typeof parsed.topic === "string" &&
        parsed.topic.startsWith("tickers.")
      ) {
        const item = parsed.data;
        if (item && typeof item === "object") {
          const ticker = this.parseTickerData(item, parsed.ts);
          if (ticker) {
            for (const listener of this.tickerListeners) {
              try {
                listener(ticker);
              } catch (err) {
                console.error("[BybitWS] Ticker listener error:", err);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("[BybitWS] Failed to parse message:", err);
    }
  }

  private parseTickerData(
    data: any,
    serverTimestamp?: number,
  ): MarketTicker | null {
    if (!data.symbol) return null;
    const symbol = String(data.symbol).toUpperCase();
    if (!this.symbols.includes(symbol)) return null;

    const price = parseFloat(data.lastPrice) || 0;
    const high = parseFloat(data.highPrice24h) || 0;
    const low = parseFloat(data.lowPrice24h) || 0;
    const volume = parseFloat(data.volume24h) || 0;
    const quoteVolume = parseFloat(data.turnover24h) || 0;
    // price24hPcnt is fractional e.g. "0.0234" for 2.34%
    const priceChangePcnt = (parseFloat(data.price24hPcnt) || 0) * 100;
    const bidPrice = data.bid1Price ? parseFloat(data.bid1Price) : undefined;
    const askPrice = data.ask1Price ? parseFloat(data.ask1Price) : undefined;

    return {
      symbol,
      price,
      bidPrice,
      askPrice,
      high24h: high,
      low24h: low,
      volume24h: volume,
      quoteVolume24h: quoteVolume,
      priceChange24h: 0,
      priceChangePercent24h: Math.round(priceChangePcnt * 100) / 100,
      timestamp: serverTimestamp ?? Date.now(),
      source: "BYBIT_WS",
    };
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ op: "ping" }));
        } catch (err) {
          console.error("[BybitWS] Ping send failed:", err);
        }
      }
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.lastTickTimestamp = Date.now();
    this.watchdogTimer = setInterval(() => {
      if (this.state === "CONNECTED") {
        const elapsed = Date.now() - this.lastTickTimestamp;
        if (elapsed > this.stalenessThresholdMs) {
          console.warn(
            `[BybitWS] Staleness detected (${elapsed}ms > ${this.stalenessThresholdMs}ms). Reconnecting...`,
          );
          this.setState("STALE");
          this.disconnect();
          this.connect();
        }
      }
    }, this.watchdogIntervalMs);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectTimeout) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState("STALE");
      return;
    }

    this.reconnectAttempts++;
    const baseDelay = Math.min(
      this.maxReconnectDelayMs,
      this.initialReconnectDelayMs * Math.pow(1.8, this.reconnectAttempts - 1),
    );
    const jitter = baseDelay * (0.8 + Math.random() * 0.4);

    this.setState("RECONNECTING");
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, jitter);
  }

  public disconnect(): void {
    this.stopPing();
    this.stopWatchdog();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setState("DISCONNECTED");
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.disconnect();
    this.tickerListeners = [];
    this.stateListeners = [];
  }
}
