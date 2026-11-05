/**
 * Apex Terminal - Live Whale Flow & Liquidation Stream Subsystem
 * Streams high-frequency aggregated trades and real-time forced liquidation orders from public WebSocket endpoints.
 */

export interface WhaleTrade {
  id: string;
  symbol: string;
  asset: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  valueUsd: number;
  tier: "DOLPHIN" | "WHALE" | "MEGALODON" | "KRAKEN";
  timestamp: number;
}

export interface LiquidationEvent {
  id: string;
  symbol: string;
  asset: string;
  side: "LONG" | "SHORT"; // Long liquidated on sell order, Short liquidated on buy order
  price: number;
  quantity: number;
  valueUsd: number;
  timestamp: number;
}

export interface WhaleMetrics {
  totalWhaleBuyVolumeUsd: number;
  totalWhaleSellVolumeUsd: number;
  netWhaleDeltaUsd: number;
  totalLiquidationsLongUsd: number;
  totalLiquidationsShortUsd: number;
  totalLiquidationsCount: number;
}

export class WhaleStreamManager {
  private static readonly STREAMS = [
    "btcusdt@aggTrade",
    "ethusdt@aggTrade",
    "solusdt@aggTrade",
    "bnbusdt@aggTrade",
    "xrpusdt@aggTrade",
    "dogeusdt@aggTrade",
    "tonusdt@aggTrade",
    "suiusdt@aggTrade",
    "pepeusdt@aggTrade",
  ];

  private tradeWs: WebSocket | null = null;
  private liqWs: WebSocket | null = null;

  private whaleTrades: WhaleTrade[] = [];
  private liquidations: LiquidationEvent[] = [];

  private metrics: WhaleMetrics = {
    totalWhaleBuyVolumeUsd: 0,
    totalWhaleSellVolumeUsd: 0,
    netWhaleDeltaUsd: 0,
    totalLiquidationsLongUsd: 0,
    totalLiquidationsShortUsd: 0,
    totalLiquidationsCount: 0,
  };

  private whaleListeners: Array<(trade: WhaleTrade) => void> = [];
  private liqListeners: Array<(liq: LiquidationEvent) => void> = [];

  private isDestroyed = false;

  constructor(
    private readonly WebSocketClass: typeof WebSocket = typeof WebSocket !==
    "undefined"
      ? WebSocket
      : (null as any),
  ) {}

  public onWhaleTrade(fn: (trade: WhaleTrade) => void): () => void {
    this.whaleListeners.push(fn);
    return () => {
      this.whaleListeners = this.whaleListeners.filter((l) => l !== fn);
    };
  }

  public onLiquidation(fn: (liq: LiquidationEvent) => void): () => void {
    this.liqListeners.push(fn);
    return () => {
      this.liqListeners = this.liqListeners.filter((l) => l !== fn);
    };
  }

  public getWhaleTrades(): WhaleTrade[] {
    return [...this.whaleTrades];
  }

  public getLiquidations(): LiquidationEvent[] {
    return [...this.liquidations];
  }

  public getMetrics(): WhaleMetrics {
    return { ...this.metrics };
  }

  public connect(): void {
    if (!this.WebSocketClass) return;
    this.connectTradeStream();
    this.connectLiquidationStream();
  }

  private connectTradeStream(): void {
    if (this.isDestroyed || !this.WebSocketClass) return;

    const streamUrl = `wss://stream.binance.com:9443/stream?streams=${WhaleStreamManager.STREAMS.join("/")}`;

    try {
      this.tradeWs = new this.WebSocketClass(streamUrl);

      this.tradeWs.onmessage = (event) => {
        try {
          const raw = JSON.parse(
            typeof event.data === "string" ? event.data : event.data.toString(),
          );
          const d = raw.data;
          if (!d || !d.p || !d.q) return;

          const price = parseFloat(d.p);
          const quantity = parseFloat(d.q);
          const valueUsd = price * quantity;

          // Threshold: Log trades >= $50,000 as whale action
          if (valueUsd >= 50000) {
            const side: "BUY" | "SELL" = d.m ? "SELL" : "BUY"; // d.m = true means buyer was maker, so trade was taker sell
            const symbol = (d.s || "").toUpperCase();
            const asset = symbol.replace("USDT", "");

            let tier: "DOLPHIN" | "WHALE" | "MEGALODON" | "KRAKEN" = "DOLPHIN";
            if (valueUsd >= 1000000) tier = "KRAKEN";
            else if (valueUsd >= 500000) tier = "MEGALODON";
            else if (valueUsd >= 100000) tier = "WHALE";

            const trade: WhaleTrade = {
              id: `wh-${d.a || Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              symbol,
              asset,
              side,
              price,
              quantity,
              valueUsd,
              tier,
              timestamp: d.T || Date.now(),
            };

            this.whaleTrades.unshift(trade);
            if (this.whaleTrades.length > 100) this.whaleTrades.pop();

            // Update cumulative metrics
            if (side === "BUY") {
              this.metrics.totalWhaleBuyVolumeUsd += valueUsd;
            } else {
              this.metrics.totalWhaleSellVolumeUsd += valueUsd;
            }
            this.metrics.netWhaleDeltaUsd =
              this.metrics.totalWhaleBuyVolumeUsd -
              this.metrics.totalWhaleSellVolumeUsd;

            this.whaleListeners.forEach((fn) => {
              try {
                fn(trade);
              } catch {}
            });
          }
        } catch {}
      };

      this.tradeWs.onclose = () => {
        if (!this.isDestroyed) {
          setTimeout(() => this.connectTradeStream(), 3000);
        }
      };

      this.tradeWs.onerror = () => {
        try {
          this.tradeWs?.close();
        } catch {}
      };
    } catch (e) {
      console.warn("Trade stream error:", e);
    }
  }

  private connectLiquidationStream(): void {
    if (this.isDestroyed || !this.WebSocketClass) return;

    // Public forced liquidation orders stream on Binance Futures
    const streamUrl = "wss://fstream.binance.com/ws/!forceOrder@arr";

    try {
      this.liqWs = new this.WebSocketClass(streamUrl);

      this.liqWs.onmessage = (event) => {
        try {
          const raw = JSON.parse(
            typeof event.data === "string" ? event.data : event.data.toString(),
          );
          const o = raw.o;
          if (!o) return;

          const price = parseFloat(o.ap || o.p || "0");
          const quantity = parseFloat(o.q || "0");
          const valueUsd = price * quantity;
          const symbol = (o.s || "").toUpperCase();
          const asset = symbol.replace("USDT", "");
          // S = 'BUY' means forced buy to cover short -> Short was liquidated!
          // S = 'SELL' means forced sell of collateral -> Long was liquidated!
          const side: "LONG" | "SHORT" = o.S === "BUY" ? "SHORT" : "LONG";

          const liq: LiquidationEvent = {
            id: `liq-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            symbol,
            asset,
            side,
            price,
            quantity,
            valueUsd,
            timestamp: o.T || Date.now(),
          };

          this.liquidations.unshift(liq);
          if (this.liquidations.length > 100) this.liquidations.pop();

          if (side === "LONG") {
            this.metrics.totalLiquidationsLongUsd += valueUsd;
          } else {
            this.metrics.totalLiquidationsShortUsd += valueUsd;
          }
          this.metrics.totalLiquidationsCount++;

          this.liqListeners.forEach((fn) => {
            try {
              fn(liq);
            } catch {}
          });
        } catch {}
      };

      this.liqWs.onclose = () => {
        if (!this.isDestroyed) {
          setTimeout(() => this.connectLiquidationStream(), 4000);
        }
      };

      this.liqWs.onerror = () => {
        try {
          this.liqWs?.close();
        } catch {}
      };
    } catch (e) {
      console.warn("Liquidation stream error:", e);
    }
  }

  public disconnect(): void {
    this.isDestroyed = true;
    try {
      this.tradeWs?.close();
    } catch {}
    try {
      this.liqWs?.close();
    } catch {}
    this.tradeWs = null;
    this.liqWs = null;
  }
}
