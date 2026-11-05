/**
 * Binance Public WebSocket Feed Manager
 * Handles zero-key public streaming, combined streams, array miniTicker streams,
 * exponential backoff reconnection, and tick aggregation.
 */

import { MarketTicker } from "../types/index.js";

export type BinanceWsState =
  "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "RECONNECTING" | "STALE";

export interface BinanceWsOptions {
  symbols?: string[]; // e.g. ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'TONUSDT', 'AVAXUSDT', 'SUIUSDT', 'PEPEUSDT']
  useMiniTickerArray?: boolean;
  maxReconnectAttempts?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  watchdogIntervalMs?: number;
  stalenessThresholdMs?: number;
  webSocketConstructor?: typeof WebSocket;
}

export class BinanceWsFeedManager {
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

  private readonly symbols: string[];
  private readonly useMiniTickerArray: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly stalenessThresholdMs: number;
  private readonly WebSocketClass: typeof WebSocket;

  private ws: WebSocket | null = null;
  private state: BinanceWsState = "DISCONNECTED";
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastTickTimestamp = 0;
  private isDestroyed = false;

  private tickerListeners: Array<(ticker: MarketTicker) => void> = [];
  private stateListeners: Array<(state: BinanceWsState) => void> = [];

  constructor(options: BinanceWsOptions = {}) {
    this.symbols = options.symbols
      ? options.symbols.map((s) => s.toUpperCase())
      : [...BinanceWsFeedManager.DEFAULT_SYMBOLS];
    this.useMiniTickerArray = options.useMiniTickerArray ?? false;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 20;
    this.initialReconnectDelayMs = options.initialReconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? 10000;
    this.stalenessThresholdMs = options.stalenessThresholdMs ?? 20000;
    this.WebSocketClass =
      options.webSocketConstructor ??
      (globalThis.WebSocket as typeof WebSocket);
  }

  public getState(): BinanceWsState {
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

  public onStateChange(listener: (state: BinanceWsState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  private setState(newState: BinanceWsState): void {
    if (this.state !== newState) {
      this.state = newState;
      for (const listener of this.stateListeners) {
        try {
          listener(newState);
        } catch (err) {
          console.error("[BinanceWS] State listener error:", err);
        }
      }
    }
  }

  public getStreamUrl(): string {
    if (this.useMiniTickerArray) {
      return "wss://stream.binance.com:9443/ws/!miniTicker@arr";
    }
    const streams = this.symbols
      .map((s) => `${s.toLowerCase()}@ticker`)
      .join("/");
    return `wss://stream.binance.com:9443/stream?streams=${streams}`;
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
        this.startWatchdog();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.lastTickTimestamp = Date.now();
        this.handleMessage(event.data);
      };

      this.ws.onerror = (err) => {
        console.error("[BinanceWS] WebSocket error:", err);
      };

      this.ws.onclose = () => {
        this.stopWatchdog();
        if (!this.isDestroyed) {
          this.setState("DISCONNECTED");
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error("[BinanceWS] Failed to instantiate WebSocket:", err);
      this.scheduleReconnect();
    }
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

      if (Array.isArray(parsed)) {
        // !miniTicker@arr format
        for (const item of parsed) {
          const ticker = this.parseMiniTickerItem(item);
          if (ticker) this.broadcastTicker(ticker);
        }
      } else if (parsed && typeof parsed === "object") {
        if ("stream" in parsed && "data" in parsed) {
          // Combined stream envelope
          const ticker = this.parse24hrTickerPayload(
            (parsed as { data: unknown }).data,
          );
          if (ticker) this.broadcastTicker(ticker);
        } else if (
          "e" in parsed &&
          (parsed as { e: string }).e === "24hrTicker"
        ) {
          // Direct 24hrTicker stream
          const ticker = this.parse24hrTickerPayload(parsed);
          if (ticker) this.broadcastTicker(ticker);
        }
      }
    } catch (err) {
      console.error("[BinanceWS] Failed to parse message:", err);
    }
  }

  private parse24hrTickerPayload(raw: any): MarketTicker | null {
    if (!raw || typeof raw !== "object" || !raw.s || !raw.c) return null;
    const symbol = String(raw.s).toUpperCase();

    // Only process whitelisted symbols if configured
    if (!this.symbols.includes(symbol)) return null;

    const price = parseFloat(raw.c) || 0;
    const priceChange = parseFloat(raw.p) || 0;
    const priceChangePercent = parseFloat(raw.P) || 0;
    const high = parseFloat(raw.h) || 0;
    const low = parseFloat(raw.l) || 0;
    const volume = parseFloat(raw.v) || 0;
    const quoteVolume = parseFloat(raw.q) || 0;
    const bidPrice = raw.b ? parseFloat(raw.b) : undefined;
    const askPrice = raw.a ? parseFloat(raw.a) : undefined;
    const bidQty = raw.B ? parseFloat(raw.B) : undefined;
    const askQty = raw.A ? parseFloat(raw.A) : undefined;
    const orderflowBuyRatio =
      bidQty !== undefined && askQty !== undefined && bidQty + askQty > 0
        ? (bidQty / (bidQty + askQty)) * 100
        : undefined;

    return {
      symbol,
      price,
      bidPrice,
      askPrice,
      bidQty,
      askQty,
      orderflowBuyRatio,
      high24h: high,
      low24h: low,
      volume24h: volume,
      quoteVolume24h: quoteVolume,
      priceChange24h: priceChange,
      priceChangePercent24h: priceChangePercent,
      timestamp: raw.E ?? Date.now(),
      source: "BINANCE_WS",
    };
  }

  private parseMiniTickerItem(raw: any): MarketTicker | null {
    if (!raw || typeof raw !== "object" || !raw.s || !raw.c) return null;
    const symbol = String(raw.s).toUpperCase();

    if (!this.symbols.includes(symbol)) return null;

    const price = parseFloat(raw.c) || 0;
    const high = parseFloat(raw.h) || 0;
    const low = parseFloat(raw.l) || 0;
    const volume = parseFloat(raw.v) || 0;
    const quoteVolume = parseFloat(raw.q) || 0;

    return {
      symbol,
      price,
      high24h: high,
      low24h: low,
      volume24h: volume,
      quoteVolume24h: quoteVolume,
      priceChange24h: 0,
      priceChangePercent24h: 0,
      timestamp: raw.E ?? Date.now(),
      source: "BINANCE_WS",
    };
  }

  private broadcastTicker(ticker: MarketTicker): void {
    for (const listener of this.tickerListeners) {
      try {
        listener(ticker);
      } catch (err) {
        console.error("[BinanceWS] Ticker listener error:", err);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectTimeout) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(
        `[BinanceWS] Max reconnect attempts (${this.maxReconnectAttempts}) reached.`,
      );
      this.setState("STALE");
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff with random jitter +/- 20%
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

  private startWatchdog(): void {
    this.stopWatchdog();
    this.lastTickTimestamp = Date.now();
    this.watchdogTimer = setInterval(() => {
      if (this.state === "CONNECTED") {
        const timeSinceLastTick = Date.now() - this.lastTickTimestamp;
        if (timeSinceLastTick > this.stalenessThresholdMs) {
          console.warn(
            `[BinanceWS] Feed staleness detected (${timeSinceLastTick}ms > ${this.stalenessThresholdMs}ms). Reconnecting...`,
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

  public disconnect(): void {
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
        // Ignore close errors during disconnect
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
