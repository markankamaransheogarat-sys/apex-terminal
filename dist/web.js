// src/feeds/binance-ws.ts
class BinanceWsFeedManager {
  static DEFAULT_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "TONUSDT",
    "AVAXUSDT",
    "SUIUSDT",
    "PEPEUSDT"
  ];
  symbols;
  useMiniTickerArray;
  maxReconnectAttempts;
  initialReconnectDelayMs;
  maxReconnectDelayMs;
  watchdogIntervalMs;
  stalenessThresholdMs;
  WebSocketClass;
  ws = null;
  state = "DISCONNECTED";
  reconnectAttempts = 0;
  reconnectTimeout = null;
  watchdogTimer = null;
  lastTickTimestamp = 0;
  isDestroyed = false;
  tickerListeners = [];
  stateListeners = [];
  constructor(options = {}) {
    this.symbols = options.symbols ? options.symbols.map((s) => s.toUpperCase()) : [...BinanceWsFeedManager.DEFAULT_SYMBOLS];
    this.useMiniTickerArray = options.useMiniTickerArray ?? false;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 20;
    this.initialReconnectDelayMs = options.initialReconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? 1e4;
    this.stalenessThresholdMs = options.stalenessThresholdMs ?? 20000;
    this.WebSocketClass = options.webSocketConstructor ?? globalThis.WebSocket;
  }
  getState() {
    return this.state;
  }
  getLastTickTimestamp() {
    return this.lastTickTimestamp;
  }
  onTicker(listener) {
    this.tickerListeners.push(listener);
    return () => {
      this.tickerListeners = this.tickerListeners.filter((l) => l !== listener);
    };
  }
  onStateChange(listener) {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }
  setState(newState) {
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
  getStreamUrl() {
    if (this.useMiniTickerArray) {
      return "wss://stream.binance.com:9443/ws/!miniTicker@arr";
    }
    const streams = this.symbols.map((s) => `${s.toLowerCase()}@ticker`).join("/");
    return `wss://stream.binance.com:9443/stream?streams=${streams}`;
  }
  connect() {
    if (this.isDestroyed)
      return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
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
      this.ws.onmessage = (event) => {
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
  handleMessage(data) {
    try {
      const text = typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : String(data);
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const ticker = this.parseMiniTickerItem(item);
          if (ticker)
            this.broadcastTicker(ticker);
        }
      } else if (parsed && typeof parsed === "object") {
        if ("stream" in parsed && "data" in parsed) {
          const ticker = this.parse24hrTickerPayload(parsed.data);
          if (ticker)
            this.broadcastTicker(ticker);
        } else if ("e" in parsed && parsed.e === "24hrTicker") {
          const ticker = this.parse24hrTickerPayload(parsed);
          if (ticker)
            this.broadcastTicker(ticker);
        }
      }
    } catch (err) {
      console.error("[BinanceWS] Failed to parse message:", err);
    }
  }
  parse24hrTickerPayload(raw) {
    if (!raw || typeof raw !== "object" || !raw.s || !raw.c)
      return null;
    const symbol = String(raw.s).toUpperCase();
    if (!this.symbols.includes(symbol))
      return null;
    const price = parseFloat(raw.c) || 0;
    const priceChange = parseFloat(raw.p) || 0;
    const priceChangePercent = parseFloat(raw.P) || 0;
    const high = parseFloat(raw.h) || 0;
    const low = parseFloat(raw.l) || 0;
    const volume = parseFloat(raw.v) || 0;
    const quoteVolume = parseFloat(raw.q) || 0;
    const bidPrice = raw.b ? parseFloat(raw.b) : undefined;
    const askPrice = raw.a ? parseFloat(raw.a) : undefined;
    return {
      symbol,
      price,
      bidPrice,
      askPrice,
      high24h: high,
      low24h: low,
      volume24h: volume,
      quoteVolume24h: quoteVolume,
      priceChange24h: priceChange,
      priceChangePercent24h: priceChangePercent,
      timestamp: raw.E ?? Date.now(),
      source: "BINANCE_WS"
    };
  }
  parseMiniTickerItem(raw) {
    if (!raw || typeof raw !== "object" || !raw.s || !raw.c)
      return null;
    const symbol = String(raw.s).toUpperCase();
    if (!this.symbols.includes(symbol))
      return null;
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
      source: "BINANCE_WS"
    };
  }
  broadcastTicker(ticker) {
    for (const listener of this.tickerListeners) {
      try {
        listener(ticker);
      } catch (err) {
        console.error("[BinanceWS] Ticker listener error:", err);
      }
    }
  }
  scheduleReconnect() {
    if (this.isDestroyed || this.reconnectTimeout)
      return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`[BinanceWS] Max reconnect attempts (${this.maxReconnectAttempts}) reached.`);
      this.setState("STALE");
      return;
    }
    this.reconnectAttempts++;
    const baseDelay = Math.min(this.maxReconnectDelayMs, this.initialReconnectDelayMs * Math.pow(1.8, this.reconnectAttempts - 1));
    const jitter = baseDelay * (0.8 + Math.random() * 0.4);
    this.setState("RECONNECTING");
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, jitter);
  }
  startWatchdog() {
    this.stopWatchdog();
    this.lastTickTimestamp = Date.now();
    this.watchdogTimer = setInterval(() => {
      if (this.state === "CONNECTED") {
        const timeSinceLastTick = Date.now() - this.lastTickTimestamp;
        if (timeSinceLastTick > this.stalenessThresholdMs) {
          console.warn(`[BinanceWS] Feed staleness detected (${timeSinceLastTick}ms > ${this.stalenessThresholdMs}ms). Reconnecting...`);
          this.setState("STALE");
          this.disconnect();
          this.connect();
        }
      }
    }, this.watchdogIntervalMs);
  }
  stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
  disconnect() {
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
      } catch {}
      this.ws = null;
    }
    this.setState("DISCONNECTED");
  }
  destroy() {
    this.isDestroyed = true;
    this.disconnect();
    this.tickerListeners = [];
    this.stateListeners = [];
  }
}

// src/feeds/funding-calculator.ts
class FundingRateCalculator {
  static classifyRegime(annualizedAPR) {
    if (annualizedAPR > 50) {
      return "EXTREME_BULL";
    } else if (annualizedAPR > 10) {
      return "MODERATE_BULL";
    } else if (annualizedAPR >= -10) {
      return "NEUTRAL";
    } else if (annualizedAPR >= -50) {
      return "MODERATE_BEAR";
    } else {
      return "SHORT_SQUEEZE_RISK";
    }
  }
  static parseFundingItem(item) {
    const rate = parseFloat(item.lastFundingRate);
    const validRate = Number.isFinite(rate) ? rate : 0;
    const intervalsPerYear = 3 * 365;
    const annualizedAPR = validRate * intervalsPerYear * 100;
    let annualizedAPY = annualizedAPR;
    if (validRate > -1 && validRate < 0.2) {
      annualizedAPY = (Math.pow(1 + validRate, intervalsPerYear) - 1) * 100;
    }
    const regime = this.classifyRegime(annualizedAPR);
    return {
      symbol: item.symbol,
      markPrice: parseFloat(item.markPrice) || 0,
      indexPrice: parseFloat(item.indexPrice) || 0,
      fundingRate: validRate,
      nextFundingTime: item.nextFundingTime,
      annualizedAPR: Math.round(annualizedAPR * 100) / 100,
      annualizedAPY: Math.round(annualizedAPY * 100) / 100,
      regime,
      timestamp: item.time ?? Date.now()
    };
  }
  static parseFundingRates(rawItems, whitelistSymbols) {
    const parsed = rawItems.filter((item) => {
      if (!item.symbol.endsWith("USDT"))
        return false;
      if (whitelistSymbols && whitelistSymbols.length > 0) {
        const base = item.symbol.replace("USDT", "");
        return whitelistSymbols.includes(base) || whitelistSymbols.includes(item.symbol);
      }
      return true;
    }).map((item) => this.parseFundingItem(item));
    return parsed.sort((a, b) => Math.abs(b.annualizedAPR) - Math.abs(a.annualizedAPR));
  }
  static async fetchLiveFundingRates(fetchImpl = globalThis.fetch, whitelist) {
    const url = "https://fapi.binance.com/fapi/v1/premiumIndex";
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ApexTerminal/1.0.0 (Institutional Risk Platform)"
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch Binance Futures funding rates: HTTP ${response.status} ${response.statusText}`);
    }
    const rawData = await response.json();
    if (!Array.isArray(rawData)) {
      throw new Error("Unexpected Binance Futures payload structure");
    }
    return this.parseFundingRates(rawData, whitelist);
  }
}

// src/feeds/fallback-rest.ts
class RestFallbackService {
  fetchImpl;
  cacheTtlMs;
  circuitBreakerThreshold;
  circuitBreakerResetMs;
  consecutiveErrors = 0;
  circuitOpenUntil = 0;
  cachedFearAndGreed = null;
  cachedTickers = null;
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? 15000;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold ?? 5;
    this.circuitBreakerResetMs = options.circuitBreakerResetMs ?? 60000;
  }
  isCircuitOpen() {
    return Date.now() < this.circuitOpenUntil;
  }
  recordSuccess() {
    this.consecutiveErrors = 0;
  }
  recordFailure() {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= this.circuitBreakerThreshold) {
      this.circuitOpenUntil = Date.now() + this.circuitBreakerResetMs;
      console.warn(`[RestFallback] Circuit breaker tripped. Backing off until ${new Date(this.circuitOpenUntil).toISOString()}`);
    }
  }
  async fetchFearAndGreed() {
    const now = Date.now();
    if (this.cachedFearAndGreed && now < this.cachedFearAndGreed.expiresAt) {
      return this.cachedFearAndGreed.data;
    }
    if (this.isCircuitOpen()) {
      if (this.cachedFearAndGreed)
        return this.cachedFearAndGreed.data;
      return {
        value: 50,
        valueClassification: "Neutral (Cached Fallback)",
        timestamp: now
      };
    }
    try {
      const res = await this.fetchImpl("https://api.alternative.me/fng/?limit=1", {
        headers: { Accept: "application/json" }
      });
      if (!res.ok) {
        throw new Error(`Fear & Greed API error: HTTP ${res.status}`);
      }
      const json = await res.json();
      const item = json?.data?.[0];
      if (!item) {
        throw new Error("Invalid Fear & Greed payload");
      }
      const data = {
        value: parseInt(item.value, 10) || 50,
        valueClassification: item.value_classification || "Neutral",
        timestamp: (parseInt(item.timestamp, 10) || Math.floor(now / 1000)) * 1000
      };
      this.cachedFearAndGreed = {
        data,
        expiresAt: now + this.cacheTtlMs * 4
      };
      this.recordSuccess();
      return data;
    } catch (err) {
      this.recordFailure();
      console.error("[RestFallback] Failed to fetch Fear & Greed index:", err);
      if (this.cachedFearAndGreed) {
        return this.cachedFearAndGreed.data;
      }
      return {
        value: 50,
        valueClassification: "Neutral (Offline)",
        timestamp: now
      };
    }
  }
  async fetchBinance24hrTickers(symbols) {
    const now = Date.now();
    if (this.cachedTickers && now < this.cachedTickers.expiresAt) {
      const cached = Array.from(this.cachedTickers.data.values());
      if (symbols && symbols.length > 0) {
        const set = new Set(symbols.map((s) => s.toUpperCase()));
        return cached.filter((t) => set.has(t.symbol));
      }
      return cached;
    }
    if (this.isCircuitOpen()) {
      if (this.cachedTickers) {
        return Array.from(this.cachedTickers.data.values());
      }
      return [];
    }
    try {
      const res = await this.fetchImpl("https://api.binance.com/api/v3/ticker/24hr", {
        headers: { Accept: "application/json" }
      });
      if (!res.ok) {
        throw new Error(`Binance 24hr API error: HTTP ${res.status}`);
      }
      const rawList = await res.json();
      if (!Array.isArray(rawList)) {
        throw new Error("Expected array from Binance 24hr ticker");
      }
      const targetSymbols = symbols ? new Set(symbols.map((s) => s.toUpperCase())) : new Set([
        "BTCUSDT",
        "ETHUSDT",
        "SOLUSDT",
        "BNBUSDT",
        "XRPUSDT",
        "DOGEUSDT",
        "TONUSDT",
        "AVAXUSDT",
        "SUIUSDT",
        "PEPEUSDT"
      ]);
      const tickerMap = new Map;
      for (const raw of rawList) {
        const symbol = String(raw.symbol).toUpperCase();
        if (targetSymbols.has(symbol)) {
          const ticker = {
            symbol,
            price: parseFloat(raw.lastPrice) || 0,
            bidPrice: raw.bidPrice ? parseFloat(raw.bidPrice) : undefined,
            askPrice: raw.askPrice ? parseFloat(raw.askPrice) : undefined,
            high24h: parseFloat(raw.highPrice) || 0,
            low24h: parseFloat(raw.lowPrice) || 0,
            volume24h: parseFloat(raw.volume) || 0,
            quoteVolume24h: parseFloat(raw.quoteVolume) || 0,
            priceChange24h: parseFloat(raw.priceChange) || 0,
            priceChangePercent24h: parseFloat(raw.priceChangePercent) || 0,
            timestamp: raw.closeTime ?? now,
            source: "REST_FALLBACK"
          };
          tickerMap.set(symbol, ticker);
        }
      }
      this.cachedTickers = {
        data: tickerMap,
        expiresAt: now + this.cacheTtlMs
      };
      this.recordSuccess();
      return Array.from(tickerMap.values());
    } catch (err) {
      this.recordFailure();
      console.error("[RestFallback] Binance 24hr polling failed:", err);
      if (this.cachedTickers) {
        return Array.from(this.cachedTickers.data.values());
      }
      return [];
    }
  }
  async fetchGlobalMetrics() {
    const fng = await this.fetchFearAndGreed();
    return {
      fearAndGreed: fng,
      btcDominance: 58.4,
      totalMarketCapUsd: 3250000000000,
      volume24hUsd: 145000000000,
      lastUpdated: Date.now(),
      source: "Alternative.me + Apex Global Aggregator"
    };
  }
}

// src/risk/math.ts
class RiskMath {
  static mean(data) {
    if (data.length === 0)
      return 0;
    let sum = 0;
    for (let i = 0;i < data.length; i++) {
      sum += data[i];
    }
    return sum / data.length;
  }
  static variance(data) {
    if (data.length < 2)
      return 0;
    const avg = this.mean(data);
    let sumSquares = 0;
    for (let i = 0;i < data.length; i++) {
      const diff = data[i] - avg;
      sumSquares += diff * diff;
    }
    return sumSquares / (data.length - 1);
  }
  static stdDev(data) {
    return Math.sqrt(this.variance(data));
  }
  static covariance(x, y) {
    const len = Math.min(x.length, y.length);
    if (len < 2)
      return 0;
    const meanX = this.mean(x.slice(0, len));
    const meanY = this.mean(y.slice(0, len));
    let sumProd = 0;
    for (let i = 0;i < len; i++) {
      sumProd += (x[i] - meanX) * (y[i] - meanY);
    }
    return sumProd / (len - 1);
  }
  static correlation(x, y) {
    const cov = this.covariance(x, y);
    const sdX = this.stdDev(x);
    const sdY = this.stdDev(y);
    if (sdX === 0 || sdY === 0)
      return 0;
    const rho = cov / (sdX * sdY);
    return Math.max(-1, Math.min(1, rho));
  }
  static covarianceMatrix(returnsByAsset, symbols) {
    const n = symbols.length;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0;i < n; i++) {
      const symI = symbols[i];
      const retI = returnsByAsset[symI] ?? [];
      for (let j = i;j < n; j++) {
        const symJ = symbols[j];
        const retJ = returnsByAsset[symJ] ?? [];
        const cov = this.covariance(retI, retJ);
        matrix[i][j] = cov;
        matrix[j][i] = cov;
      }
    }
    return matrix;
  }
  static matrixVectorMultiply(matrix, vector) {
    const rows = matrix.length;
    const cols = vector.length;
    const result = new Array(rows).fill(0);
    for (let r = 0;r < rows; r++) {
      let sum = 0;
      const row = matrix[r];
      for (let c = 0;c < cols; c++) {
        sum += row[c] * vector[c];
      }
      result[r] = sum;
    }
    return result;
  }
  static quadraticForm(weights, matrix) {
    const sigmaW = this.matrixVectorMultiply(matrix, weights);
    let variance = 0;
    for (let i = 0;i < weights.length; i++) {
      variance += weights[i] * sigmaW[i];
    }
    return Math.max(0, variance);
  }
  static standardNormalInverseCdf(p) {
    if (p <= 0 || p >= 1) {
      throw new RangeError(`Probability p must be in (0, 1), received: ${p}`);
    }
    if (Math.abs(p - 0.95) < 0.000001)
      return 1.6448536269514722;
    if (Math.abs(p - 0.99) < 0.000001)
      return 2.3263478740408408;
    if (Math.abs(p - 0.975) < 0.000001)
      return 1.959963984540054;
    if (Math.abs(p - 0.5) < 0.000001)
      return 0;
    const a = [
      -39.69683028665376,
      220.9460984245205,
      -275.9285104469687,
      138.357751867269,
      -30.66479806614716,
      2.506628277459239
    ];
    const b = [
      -54.47609879822406,
      161.5858368580409,
      -155.6989798598866,
      66.80131188771972,
      -13.28068155288572
    ];
    const c = [
      -0.007784894002430293,
      -0.3223964580411365,
      -2.400758277161838,
      -2.549732539343734,
      4.374664141464968,
      2.938163982698783
    ];
    const d = [
      0.007784695709041462,
      0.3224671290700398,
      2.445134137142996,
      3.754408661907416
    ];
    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    let q;
    let r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -((((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1));
    }
  }
  static effectiveNumberOfAssets(weights) {
    let sumSq = 0;
    for (let i = 0;i < weights.length; i++) {
      sumSq += weights[i] * weights[i];
    }
    if (sumSq <= 0)
      return 0;
    return 1 / sumSq;
  }
}

// src/risk/aladdin-engine.ts
class AladdinRiskEngine {
  static DEFAULT_SCENARIOS = [
    {
      id: "BTC_FLASH_10",
      name: "BTC Flash Drop (-10%)",
      description: "Sudden liquidity drain with Bitcoin dropping 10% and altcoins adjusting via beta.",
      shocks: { BTC: -0.1, ETH: -0.12, SOL: -0.15 },
      defaultAltShock: -0.14,
      fundingRateSurge: 0.0002
    },
    {
      id: "CRYPTO_CRASH_20",
      name: "Crypto Crash 20% (Cascading Liquidations)",
      description: "System-wide market rout: BTC -20%, ETH -25%, major alts -30%, high perpetual funding volatility.",
      shocks: {
        BTC: -0.2,
        ETH: -0.25,
        SOL: -0.32,
        BNB: -0.22,
        XRP: -0.28,
        DOGE: -0.35,
        TON: -0.24,
        AVAX: -0.33,
        SUI: -0.35,
        PEPE: -0.4
      },
      defaultAltShock: -0.3,
      fundingRateSurge: 0.0005
    },
    {
      id: "BLACK_SWAN_35",
      name: "Black Swan Event (-35%)",
      description: "Extreme contagion shock: BTC down 35%, ETH down 42%, Altcoins collapsing up to 50%.",
      shocks: {
        BTC: -0.35,
        ETH: -0.42,
        SOL: -0.48,
        BNB: -0.38,
        XRP: -0.45,
        DOGE: -0.52,
        TON: -0.4,
        AVAX: -0.5,
        SUI: -0.5,
        PEPE: -0.6
      },
      defaultAltShock: -0.45,
      fundingRateSurge: 0.0008
    },
    {
      id: "FUNDING_SURGE_8BP",
      name: "Funding Rate Surge (+0.08% / 8h)",
      description: "Perpetual long funding spikes to +0.08% per 8h (87.6% APR), causing sustained carry bleed on leveraged positions.",
      shocks: { BTC: -0.02, ETH: -0.03 },
      defaultAltShock: -0.04,
      fundingRateSurge: 0.0008
    },
    {
      id: "ALT_SEASON_ROTATION",
      name: "Alt Season Rotation (BTC Flat, Alts +25%)",
      description: "Capital rotation from BTC into high-beta ecosystems (SOL, SUI, AVAX +25%).",
      shocks: {
        BTC: 0,
        ETH: 0.1,
        SOL: 0.25,
        SUI: 0.3,
        AVAX: 0.25,
        DOGE: 0.2,
        PEPE: 0.35
      },
      defaultAltShock: 0.15,
      fundingRateSurge: 0.0003
    }
  ];
  static calculateParametricVaR(portfolio, returnsByAsset, confidenceLevel = 0.95, horizonDays = 1) {
    const portfolioValueUsd = portfolio.totalValueUsd;
    if (portfolioValueUsd <= 0 || portfolio.positions.length === 0) {
      return {
        portfolioValueUsd: 0,
        confidenceLevel,
        horizonDays,
        zScore: RiskMath.standardNormalInverseCdf(confidenceLevel),
        dailyVolatility: 0,
        annualizedVolatility: 0,
        parametricVaRUsd: 0,
        parametricVaRPercent: 0,
        componentVaRUsd: {},
        componentVaRPercent: {},
        marginalVaR: {}
      };
    }
    const symbols = portfolio.positions.map((p) => p.symbol);
    const weights = portfolio.positions.map((p) => p.valueUsd / portfolioValueUsd);
    const covMatrix = RiskMath.covarianceMatrix(returnsByAsset, symbols);
    const dailyVariance = RiskMath.quadraticForm(weights, covMatrix);
    const dailyVolatility = Math.sqrt(dailyVariance);
    const annualizedVolatility = dailyVolatility * Math.sqrt(365);
    const zScore = RiskMath.standardNormalInverseCdf(confidenceLevel);
    const horizonFactor = Math.sqrt(horizonDays);
    const parametricVaRUsd = portfolioValueUsd * zScore * dailyVolatility * horizonFactor;
    const parametricVaRPercent = portfolioValueUsd > 0 ? parametricVaRUsd / portfolioValueUsd * 100 : 0;
    const sigmaW = RiskMath.matrixVectorMultiply(covMatrix, weights);
    const marginalVaR = {};
    const componentVaRUsd = {};
    const componentVaRPercent = {};
    for (let i = 0;i < symbols.length; i++) {
      const sym = symbols[i];
      const w_i = weights[i];
      let mVar_i = 0;
      if (dailyVolatility > 0) {
        mVar_i = zScore * horizonFactor * (sigmaW[i] ?? 0) / dailyVolatility;
      }
      marginalVaR[sym] = mVar_i;
      const cVarUsd = w_i * mVar_i * portfolioValueUsd;
      componentVaRUsd[sym] = cVarUsd;
      componentVaRPercent[sym] = parametricVaRUsd > 0 ? cVarUsd / parametricVaRUsd * 100 : 0;
    }
    return {
      portfolioValueUsd,
      confidenceLevel,
      horizonDays,
      zScore,
      dailyVolatility,
      annualizedVolatility,
      parametricVaRUsd,
      parametricVaRPercent,
      componentVaRUsd,
      componentVaRPercent,
      marginalVaR
    };
  }
  static calculateBeta(portfolio, returnsByAsset, benchmarkSymbol = "BTC") {
    const btcReturns = returnsByAsset[benchmarkSymbol] ?? [];
    const btcVariance = RiskMath.variance(btcReturns);
    if (btcVariance <= 0 || portfolio.positions.length === 0 || portfolio.totalValueUsd <= 0) {
      return {
        benchmarkSymbol,
        portfolioBeta: 1,
        assetBetas: {},
        covarianceWithBenchmark: 0,
        benchmarkVariance: btcVariance,
        systemicRiskClassification: "MARKET_TRACKING"
      };
    }
    const assetBetas = {};
    let weightedBetaSum = 0;
    let totalCovariance = 0;
    for (const pos of portfolio.positions) {
      const weight = pos.valueUsd / portfolio.totalValueUsd;
      const assetReturns = returnsByAsset[pos.symbol] ?? [];
      const cov = RiskMath.covariance(assetReturns, btcReturns);
      const beta = cov / btcVariance;
      assetBetas[pos.symbol] = beta;
      weightedBetaSum += weight * beta;
      totalCovariance += weight * cov;
    }
    let classification;
    if (weightedBetaSum > 1.2) {
      classification = "AGGRESSIVE";
    } else if (weightedBetaSum >= 0.8 && weightedBetaSum <= 1.2) {
      classification = "MARKET_TRACKING";
    } else if (weightedBetaSum >= 0 && weightedBetaSum < 0.8) {
      classification = "DEFENSIVE";
    } else {
      classification = "NEGATIVE_CORRELATED";
    }
    return {
      benchmarkSymbol,
      portfolioBeta: weightedBetaSum,
      assetBetas,
      covarianceWithBenchmark: totalCovariance,
      benchmarkVariance: btcVariance,
      systemicRiskClassification: classification
    };
  }
  static runStressTest(portfolio, scenario) {
    const baselinePortfolioValueUsd = portfolio.totalValueUsd;
    let stressedValueTotalUsd = portfolio.cashUsd;
    let totalDrawdownUsd = 0;
    let totalStressedMarginReqUsd = 0;
    let totalFundingSurgeCostUsd = 0;
    const positionImpacts = {};
    const liquidatedPositions = [];
    let minDistanceToLiq = Infinity;
    for (const pos of portfolio.positions) {
      const shockFactor = scenario.shocks[pos.symbol] ?? scenario.defaultAltShock ?? 0;
      const initialPrice = pos.currentPrice;
      const stressedPrice = Math.max(0, initialPrice * (1 + shockFactor));
      const leverage = pos.leverage ?? 1;
      const isLong = pos.isLong ?? true;
      const mmr = pos.maintenanceMarginRatio ?? 0.05;
      const nominalValue = pos.amount * initialPrice;
      let pnlUsd = 0;
      if (isLong) {
        pnlUsd = pos.amount * (stressedPrice - initialPrice);
      } else {
        pnlUsd = pos.amount * (initialPrice - stressedPrice);
      }
      let fundingCost = 0;
      if (scenario.fundingRateSurge && scenario.fundingRateSurge !== 0) {
        fundingCost = isLong ? nominalValue * scenario.fundingRateSurge : -nominalValue * scenario.fundingRateSurge;
        totalFundingSurgeCostUsd += fundingCost;
      }
      const netPnlUsd = pnlUsd - fundingCost;
      const initialEquity = pos.valueUsd;
      const stressedEquity = Math.max(0, initialEquity + netPnlUsd);
      stressedValueTotalUsd += stressedEquity;
      const posDrawdown = initialEquity - stressedEquity;
      totalDrawdownUsd += posDrawdown;
      const stressedNominal = pos.amount * stressedPrice;
      const stressedMmrReq = stressedNominal * mmr;
      totalStressedMarginReqUsd += stressedMmrReq;
      let liquidationPrice;
      let isLiquidated = false;
      let distanceToLiqPercent = 100;
      if (leverage > 1) {
        if (isLong) {
          liquidationPrice = Math.max(0, initialPrice * (1 - 1 / leverage + mmr));
          if (stressedPrice <= liquidationPrice) {
            isLiquidated = true;
          }
          if (initialPrice > 0) {
            distanceToLiqPercent = (stressedPrice - liquidationPrice) / initialPrice * 100;
          }
        } else {
          liquidationPrice = initialPrice * (1 + 1 / leverage - mmr);
          if (stressedPrice >= liquidationPrice) {
            isLiquidated = true;
          }
          if (initialPrice > 0) {
            distanceToLiqPercent = (liquidationPrice - stressedPrice) / initialPrice * 100;
          }
        }
        if (isLiquidated) {
          liquidatedPositions.push(pos.symbol);
          distanceToLiqPercent = 0;
        }
        minDistanceToLiq = Math.min(minDistanceToLiq, distanceToLiqPercent);
      } else {
        distanceToLiqPercent = 100 * (1 + shockFactor);
        minDistanceToLiq = Math.min(minDistanceToLiq, distanceToLiqPercent);
      }
      const initialMarginRatio = pos.valueUsd > 0 ? pos.amount * initialPrice * mmr / pos.valueUsd : 0;
      const stressedMarginRatio = stressedEquity > 0 ? stressedMmrReq / stressedEquity : 1;
      positionImpacts[pos.symbol] = {
        symbol: pos.symbol,
        initialValueUsd: initialEquity,
        stressedValueUsd: stressedEquity,
        pnlDrawdownUsd: posDrawdown,
        pnlDrawdownPercent: initialEquity > 0 ? posDrawdown / initialEquity * 100 : 0,
        initialMarginRatio,
        stressedMarginRatio,
        liquidationPrice,
        isLiquidated,
        distanceToLiquidationPercent: Math.max(0, distanceToLiqPercent)
      };
    }
    const baselineHealthFactor = portfolio.healthFactor;
    const stressedHealthFactor = totalStressedMarginReqUsd > 0 ? stressedValueTotalUsd / totalStressedMarginReqUsd : 99.9;
    const totalDrawdownPercent = baselinePortfolioValueUsd > 0 ? totalDrawdownUsd / baselinePortfolioValueUsd * 100 : 0;
    const isPortfolioSolvent = stressedValueTotalUsd > 0 && stressedHealthFactor >= 1;
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      baselinePortfolioValueUsd,
      stressedPortfolioValueUsd: Math.max(0, stressedValueTotalUsd),
      totalDrawdownUsd,
      totalDrawdownPercent,
      fundingCostSurgeUsd: totalFundingSurgeCostUsd,
      baselineHealthFactor,
      stressedHealthFactor,
      liquidatedPositions,
      minimumLiquidationDistancePercent: minDistanceToLiq === Infinity ? 100 : Math.max(0, minDistanceToLiq),
      isPortfolioSolvent,
      positionImpacts
    };
  }
  static calculateDiversification(portfolio, returnsByAsset) {
    const positions = portfolio.positions;
    const n = positions.length;
    if (n <= 1 || portfolio.totalValueUsd <= 0) {
      return {
        score: 0,
        diversificationRatio: 1,
        averageCorrelation: 1,
        effectiveAssetsN: Math.min(1, n),
        regime: "CONCENTRATED",
        correlationMatrix: {},
        assetWeights: {}
      };
    }
    const symbols = positions.map((p) => p.symbol);
    const weights = positions.map((p) => p.valueUsd / portfolio.totalValueUsd);
    const assetWeightsMap = {};
    for (let i = 0;i < n; i++) {
      assetWeightsMap[symbols[i]] = weights[i];
    }
    const sigmas = [];
    let weightedVolSum = 0;
    for (let i = 0;i < n; i++) {
      const sym = symbols[i];
      const rets = returnsByAsset[sym] ?? [];
      const s = RiskMath.stdDev(rets);
      sigmas.push(s);
      weightedVolSum += weights[i] * s;
    }
    const covMatrix = RiskMath.covarianceMatrix(returnsByAsset, symbols);
    const portVar = RiskMath.quadraticForm(weights, covMatrix);
    const portVol = Math.sqrt(portVar);
    const diversificationRatio = portVol > 0 ? weightedVolSum / portVol : 1;
    const correlationMatrix = {};
    let offDiagCorrSum = 0;
    let offDiagPairs = 0;
    for (let i = 0;i < n; i++) {
      const symI = symbols[i];
      correlationMatrix[symI] = {};
      const retsI = returnsByAsset[symI] ?? [];
      for (let j = 0;j < n; j++) {
        const symJ = symbols[j];
        const retsJ = returnsByAsset[symJ] ?? [];
        const rho = RiskMath.correlation(retsI, retsJ);
        correlationMatrix[symI][symJ] = rho;
        if (i !== j) {
          offDiagCorrSum += rho;
          offDiagPairs++;
        }
      }
    }
    const avgCorrelation = offDiagPairs > 0 ? offDiagCorrSum / offDiagPairs : 1;
    const effectiveAssetsN = RiskMath.effectiveNumberOfAssets(weights);
    const corrComponent = Math.max(0, Math.min(1, (1 - avgCorrelation) / 2));
    const maxPossibleDr = Math.sqrt(n);
    const drComponent = maxPossibleDr > 1 ? Math.max(0, Math.min(1, (diversificationRatio - 1) / (maxPossibleDr - 1))) : 0;
    const rawScore = 100 * (0.6 * corrComponent + 0.4 * drComponent);
    const score = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));
    let regime;
    if (score >= 80) {
      regime = "OPTIMAL_HEDGE";
    } else if (score >= 55) {
      regime = "WELL_DIVERSIFIED";
    } else if (score >= 25) {
      regime = "MODERATE";
    } else {
      regime = "CONCENTRATED";
    }
    return {
      score,
      diversificationRatio,
      averageCorrelation: avgCorrelation,
      effectiveAssetsN,
      regime,
      correlationMatrix,
      assetWeights: assetWeightsMap
    };
  }
}

// src/risk/sample-data.ts
class ReferenceData {
  static getSamplePortfolio() {
    return {
      name: "Apex Digital Alpha Fund I (Institutional)",
      cashUsd: 1500000,
      totalCollateralUsd: 1e7,
      totalValueUsd: 1e7,
      totalMarginUsedUsd: 2450000,
      freeMarginUsd: 7550000,
      healthFactor: 4.08,
      positions: [
        {
          symbol: "BTC",
          amount: 45,
          currentPrice: 94000,
          valueUsd: 4230000,
          entryPrice: 88500,
          leverage: 1,
          isLong: true,
          maintenanceMarginRatio: 0.05
        },
        {
          symbol: "ETH",
          amount: 750,
          currentPrice: 3400,
          valueUsd: 2550000,
          entryPrice: 3150,
          leverage: 1,
          isLong: true,
          maintenanceMarginRatio: 0.05
        },
        {
          symbol: "SOL",
          amount: 7000,
          currentPrice: 195,
          valueUsd: 1365000,
          entryPrice: 172,
          leverage: 2,
          isLong: true,
          maintenanceMarginRatio: 0.07
        },
        {
          symbol: "BNB",
          amount: 1200,
          currentPrice: 650,
          valueUsd: 780000,
          entryPrice: 610,
          leverage: 1,
          isLong: true,
          maintenanceMarginRatio: 0.05
        },
        {
          symbol: "SUI",
          amount: 180000,
          currentPrice: 3.2,
          valueUsd: 576000,
          entryPrice: 2.85,
          leverage: 3,
          isLong: true,
          maintenanceMarginRatio: 0.1
        },
        {
          symbol: "PEPE",
          amount: 25000000000,
          currentPrice: 0.00001996,
          valueUsd: 499000,
          entryPrice: 0.0000175,
          leverage: 2,
          isLong: true,
          maintenanceMarginRatio: 0.12
        }
      ]
    };
  }
  static getCalibratedReturns() {
    const btc = [
      0.012,
      -0.018,
      0.025,
      0.004,
      -0.012,
      0.031,
      -0.022,
      0.015,
      -0.008,
      0.042,
      -0.035,
      0.019,
      0.005,
      -0.014,
      0.028,
      -0.009,
      0.016,
      -0.021,
      0.033,
      -0.015,
      0.008,
      -0.004,
      0.021,
      -0.029,
      0.038,
      -0.017,
      0.011,
      -0.025,
      0.018,
      -0.005,
      0.024,
      -0.031,
      0.017,
      0.009,
      -0.016,
      0.029,
      -0.011,
      0.014,
      -0.023,
      0.035,
      -0.019,
      0.022,
      -0.007,
      0.015,
      -0.027,
      0.032,
      -0.014,
      0.008,
      -0.018,
      0.026,
      -0.033,
      0.019,
      0.006,
      -0.012,
      0.027,
      -0.008,
      0.014,
      -0.022,
      0.031,
      -0.016
    ];
    const eth = btc.map((r, i) => r * 1.15 + (i % 2 === 0 ? 0.005 : -0.006));
    const sol = btc.map((r, i) => r * 1.45 + (i % 3 === 0 ? 0.012 : -0.011));
    const bnb = btc.map((r, i) => r * 0.85 + (i % 2 === 0 ? 0.002 : -0.003));
    const xrp = btc.map((r, i) => r * 1.2 + (i % 4 === 0 ? 0.018 : -0.015));
    const doge = btc.map((r, i) => r * 1.6 + (i % 3 === 0 ? 0.022 : -0.019));
    const ton = btc.map((r, i) => r * 0.95 + (i % 2 === 0 ? 0.008 : -0.009));
    const avax = btc.map((r, i) => r * 1.35 + (i % 3 === 0 ? 0.015 : -0.014));
    const sui = btc.map((r, i) => r * 1.7 + (i % 2 === 0 ? 0.025 : -0.022));
    const pepe = btc.map((r, i) => r * 2.1 + (i % 2 === 0 ? 0.038 : -0.035));
    return {
      BTC: btc,
      BTCUSDT: btc,
      ETH: eth,
      ETHUSDT: eth,
      SOL: sol,
      SOLUSDT: sol,
      BNB: bnb,
      BNBUSDT: bnb,
      XRP: xrp,
      XRPUSDT: xrp,
      DOGE: doge,
      DOGEUSDT: doge,
      TON: ton,
      TONUSDT: ton,
      AVAX: avax,
      AVAXUSDT: avax,
      SUI: sui,
      SUIUSDT: sui,
      PEPE: pepe,
      PEPEUSDT: pepe
    };
  }
}

// src/audio.js
var STORAGE_KEY = "apex_terminal_audio_muted";
var VOLUME_KEY = "apex_terminal_audio_volume";

class MemoryStorage {
  constructor() {
    this.store = new Map;
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}
function getSafeStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const testKey = "__apex_storage_probe__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    }
  } catch {}
  return new MemoryStorage;
}

class ApexSoundEngine {
  constructor(options = {}) {
    this.options = options;
    this.storage = options.storage || getSafeStorage();
    this.ctx = options.context || null;
    this.masterGain = null;
    this.limiterNode = null;
    this.noiseBuffer = null;
    this.lastTickTime = 0;
    let storedMute = null;
    let storedVol = null;
    try {
      storedMute = this.storage.getItem(STORAGE_KEY);
      storedVol = this.storage.getItem(VOLUME_KEY);
    } catch {}
    this.muted = storedMute === "true";
    const parsedVol = storedVol !== null ? parseFloat(storedVol) : options.defaultVolume ?? 0.7;
    this.masterVolume = Number.isFinite(parsedVol) ? Math.max(0, Math.min(1, parsedVol)) : 0.7;
    this.playTerminalKey = this.playTerminalKey.bind(this);
    this.playTickerTick = this.playTickerTick.bind(this);
    this.playCommandGo = this.playCommandGo.bind(this);
    this.playVolatilityAlert = this.playVolatilityAlert.bind(this);
    this.toggleMute = this.toggleMute.bind(this);
    this.isMuted = this.isMuted.bind(this);
    this.setMuted = this.setMuted.bind(this);
    this.setMasterVolume = this.setMasterVolume.bind(this);
    this.getMasterVolume = this.getMasterVolume.bind(this);
    if (this.ctx) {
      this.initNodes();
    }
  }
  getContext() {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && typeof this.ctx.resume === "function") {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }
    try {
      const AudioCtxClass = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext) || typeof globalThis !== "undefined" && (globalThis.AudioContext || globalThis.webkitAudioContext);
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass;
        this.initNodes();
        if (this.ctx.state === "suspended" && typeof this.ctx.resume === "function") {
          this.ctx.resume().catch(() => {});
        }
        return this.ctx;
      }
    } catch {}
    return null;
  }
  setContext(context) {
    this.ctx = context;
    this.noiseBuffer = null;
    this.initNodes();
  }
  initNodes() {
    if (!this.ctx)
      return;
    try {
      if (typeof this.ctx.createDynamicsCompressor === "function") {
        this.limiterNode = this.ctx.createDynamicsCompressor();
        this.limiterNode.threshold.setValueAtTime?.(-4, this.ctx.currentTime);
        this.limiterNode.knee.setValueAtTime?.(6, this.ctx.currentTime);
        this.limiterNode.ratio.setValueAtTime?.(12, this.ctx.currentTime);
        this.limiterNode.attack.setValueAtTime?.(0.002, this.ctx.currentTime);
        this.limiterNode.release.setValueAtTime?.(0.05, this.ctx.currentTime);
        this.limiterNode.connect(this.ctx.destination);
      }
      if (typeof this.ctx.createGain === "function") {
        this.masterGain = this.ctx.createGain();
        const initialGain = this.muted ? 0 : this.masterVolume;
        this.masterGain.gain.setValueAtTime?.(initialGain, this.ctx.currentTime);
        if (this.limiterNode) {
          this.masterGain.connect(this.limiterNode);
        } else if (this.ctx.destination) {
          this.masterGain.connect(this.ctx.destination);
        }
      }
      this.getOrCreateNoiseBuffer();
    } catch {}
  }
  getOrCreateNoiseBuffer() {
    if (this.noiseBuffer)
      return this.noiseBuffer;
    if (!this.ctx || typeof this.ctx.createBuffer !== "function")
      return null;
    try {
      const sampleRate = this.ctx.sampleRate || 44100;
      const buffer = this.ctx.createBuffer(1, sampleRate, sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0;i < sampleRate; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
      return this.noiseBuffer;
    } catch {
      return null;
    }
  }
  playTerminalKey(char = "") {
    if (this.muted)
      return;
    const ctx = this.getContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    const dest = this.masterGain || ctx.destination;
    const charStr = String(char);
    const isEnter = charStr === "Enter" || charStr === "\r" || charStr === `
` || charStr === "<GO>";
    const isSpace = charStr === " " || charStr === "Space";
    const isBackspace = charStr === "Backspace" || charStr === "Delete";
    const code = charStr.length > 0 ? charStr.charCodeAt(0) : 72;
    const hash = (code * 17 + 23) % 13 - 6;
    let snapFreq = 3400 + hash * 35;
    let thudFreq = 220 + hash * 5;
    let snapDecay = 0.008;
    let thudDecay = 0.022;
    let snapGainLevel = 0.22;
    let thudGainLevel = 0.35;
    if (isEnter) {
      snapFreq = 3100;
      thudFreq = 160;
      thudDecay = 0.038;
      snapDecay = 0.012;
      snapGainLevel = 0.28;
      thudGainLevel = 0.45;
    } else if (isSpace) {
      snapFreq = 2600;
      thudFreq = 135;
      thudDecay = 0.042;
      snapDecay = 0.014;
      snapGainLevel = 0.2;
      thudGainLevel = 0.42;
    } else if (isBackspace) {
      snapFreq = 4100;
      thudFreq = 290;
      thudDecay = 0.016;
      snapDecay = 0.007;
      snapGainLevel = 0.24;
      thudGainLevel = 0.28;
    }
    try {
      const noise = this.getOrCreateNoiseBuffer();
      if (noise && typeof ctx.createBufferSource === "function") {
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noise;
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = "bandpass";
        noiseFilter.frequency.setValueAtTime?.(snapFreq, now);
        noiseFilter.Q.setValueAtTime?.(5.5, now);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime?.(snapGainLevel, now);
        noiseGain.gain.exponentialRampToValueAtTime?.(0.0001, now + snapDecay);
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(dest);
        noiseSource.start(now);
        noiseSource.stop(now + snapDecay + 0.002);
      }
      if (typeof ctx.createOscillator === "function") {
        const thudOsc = ctx.createOscillator();
        thudOsc.type = "triangle";
        thudOsc.frequency.setValueAtTime?.(thudFreq, now);
        thudOsc.frequency.exponentialRampToValueAtTime?.(Math.max(30, thudFreq * 0.3), now + thudDecay);
        const thudGain = ctx.createGain();
        thudGain.gain.setValueAtTime?.(thudGainLevel, now);
        thudGain.gain.exponentialRampToValueAtTime?.(0.0001, now + thudDecay);
        thudOsc.connect(thudGain);
        thudGain.connect(dest);
        thudOsc.start(now);
        thudOsc.stop(now + thudDecay + 0.002);
      }
    } catch {}
  }
  playTickerTick(direction) {
    if (this.muted)
      return;
    const ctx = this.getContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    if (now - this.lastTickTime < 0.015) {
      return;
    }
    this.lastTickTime = now;
    const dest = this.masterGain || ctx.destination;
    let isUp = false;
    if (typeof direction === "boolean") {
      isUp = direction;
    } else if (typeof direction === "number") {
      isUp = direction > 0;
    } else if (typeof direction === "string") {
      const d = direction.toLowerCase().trim();
      isUp = d === "up" || d === "green" || d === "buy" || d === "+1" || d === "1" || d === "+";
    }
    const freqStart = isUp ? 2800 : 1800;
    const freqEnd = isUp ? 3300 : 1350;
    const tickDuration = 0.0018;
    try {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime?.(freqStart, now);
      osc.frequency.linearRampToValueAtTime?.(freqEnd, now + tickDuration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime?.(0.12, now);
      gain.gain.exponentialRampToValueAtTime?.(0.0001, now + tickDuration);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + tickDuration + 0.001);
    } catch {}
  }
  playCommandGo() {
    if (this.muted)
      return;
    const ctx = this.getContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    const dest = this.masterGain || ctx.destination;
    try {
      const noise = this.getOrCreateNoiseBuffer();
      if (noise && typeof ctx.createBufferSource === "function") {
        const snapSource = ctx.createBufferSource();
        snapSource.buffer = noise;
        const snapFilter = ctx.createBiquadFilter();
        snapFilter.type = "bandpass";
        snapFilter.frequency.setValueAtTime?.(3200, now);
        snapFilter.Q.setValueAtTime?.(6, now);
        const snapGain = ctx.createGain();
        snapGain.gain.setValueAtTime?.(0.32, now);
        snapGain.gain.exponentialRampToValueAtTime?.(0.0001, now + 0.015);
        snapSource.connect(snapFilter);
        snapFilter.connect(snapGain);
        snapGain.connect(dest);
        snapSource.start(now);
        snapSource.stop(now + 0.02);
        const reboundSource = ctx.createBufferSource();
        reboundSource.buffer = noise;
        const reboundFilter = ctx.createBiquadFilter();
        reboundFilter.type = "highpass";
        reboundFilter.frequency.setValueAtTime?.(4500, now + 0.012);
        const reboundGain = ctx.createGain();
        reboundGain.gain.setValueAtTime?.(0.0001, now);
        reboundGain.gain.setValueAtTime?.(0.18, now + 0.012);
        reboundGain.gain.exponentialRampToValueAtTime?.(0.0001, now + 0.026);
        reboundSource.connect(reboundFilter);
        reboundFilter.connect(reboundGain);
        reboundGain.connect(dest);
        reboundSource.start(now + 0.012);
        reboundSource.stop(now + 0.03);
      }
      if (typeof ctx.createOscillator === "function") {
        const latchOsc = ctx.createOscillator();
        latchOsc.type = "triangle";
        latchOsc.frequency.setValueAtTime?.(210, now);
        latchOsc.frequency.exponentialRampToValueAtTime?.(55, now + 0.035);
        const latchGain = ctx.createGain();
        latchGain.gain.setValueAtTime?.(0.4, now);
        latchGain.gain.exponentialRampToValueAtTime?.(0.0001, now + 0.035);
        latchOsc.connect(latchGain);
        latchGain.connect(dest);
        latchOsc.start(now);
        latchOsc.stop(now + 0.04);
      }
      if (typeof ctx.createOscillator === "function") {
        const chimeStartTime = now + 0.018;
        const tone1 = ctx.createOscillator();
        tone1.type = "sine";
        tone1.frequency.setValueAtTime?.(1318.51, chimeStartTime);
        const gain1 = ctx.createGain();
        gain1.gain.setValueAtTime?.(0.0001, chimeStartTime);
        gain1.gain.linearRampToValueAtTime?.(0.25, chimeStartTime + 0.004);
        gain1.gain.exponentialRampToValueAtTime?.(0.0001, chimeStartTime + 0.22);
        tone1.connect(gain1);
        gain1.connect(dest);
        tone1.start(chimeStartTime);
        tone1.stop(chimeStartTime + 0.23);
        const chime2StartTime = chimeStartTime + 0.045;
        const tone2 = ctx.createOscillator();
        tone2.type = "sine";
        tone2.frequency.setValueAtTime?.(1975.53, chime2StartTime);
        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime?.(0.0001, chime2StartTime);
        gain2.gain.linearRampToValueAtTime?.(0.32, chime2StartTime + 0.005);
        gain2.gain.exponentialRampToValueAtTime?.(0.0001, chime2StartTime + 0.48);
        tone2.connect(gain2);
        gain2.connect(dest);
        tone2.start(chime2StartTime);
        tone2.stop(chime2StartTime + 0.5);
        const overtone = ctx.createOscillator();
        overtone.type = "sine";
        overtone.frequency.setValueAtTime?.(1975.53 * 2.76, chime2StartTime);
        const overtoneGain = ctx.createGain();
        overtoneGain.gain.setValueAtTime?.(0.0001, chime2StartTime);
        overtoneGain.gain.linearRampToValueAtTime?.(0.06, chime2StartTime + 0.003);
        overtoneGain.gain.exponentialRampToValueAtTime?.(0.0001, chime2StartTime + 0.18);
        overtone.connect(overtoneGain);
        overtoneGain.connect(dest);
        overtone.start(chime2StartTime);
        overtone.stop(chime2StartTime + 0.2);
      }
    } catch {}
  }
  playVolatilityAlert(level = 1) {
    if (this.muted)
      return;
    const ctx = this.getContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    const dest = this.masterGain || ctx.destination;
    let isCritical = false;
    let isWarning = true;
    if (typeof level === "number") {
      if (level >= 5 || level >= 2) {
        isCritical = true;
      }
    } else if (typeof level === "string") {
      const l = level.toLowerCase().trim();
      if (l === "crit" || l === "critical" || l === "high" || l === "crash" || l === "flash") {
        isCritical = true;
      } else if (l === "low") {
        isWarning = false;
      }
    }
    try {
      if (typeof ctx.createOscillator !== "function")
        return;
      if (!isCritical) {
        const baseFreq = isWarning ? 940 : 820;
        const pingDuration = isWarning ? 0.75 : 0.5;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime?.(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime?.(baseFreq * 0.96, now + pingDuration);
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime?.(baseFreq, now);
        filter.Q.setValueAtTime?.(16, now);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime?.(0.0001, now);
        gain.gain.linearRampToValueAtTime?.(0.3, now + 0.006);
        gain.gain.exponentialRampToValueAtTime?.(0.0001, now + pingDuration);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(dest);
        osc.start(now);
        osc.stop(now + pingDuration + 0.01);
      } else {
        const pulse1Start = now;
        const pulse1Duration = 0.35;
        const pulse1Freq = 1180;
        const osc1 = ctx.createOscillator();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime?.(pulse1Freq, pulse1Start);
        osc1.frequency.exponentialRampToValueAtTime?.(pulse1Freq * 0.95, pulse1Start + pulse1Duration);
        const filter1 = ctx.createBiquadFilter();
        filter1.type = "bandpass";
        filter1.frequency.setValueAtTime?.(pulse1Freq, pulse1Start);
        filter1.Q.setValueAtTime?.(18, pulse1Start);
        const gain1 = ctx.createGain();
        gain1.gain.setValueAtTime?.(0.0001, pulse1Start);
        gain1.gain.linearRampToValueAtTime?.(0.35, pulse1Start + 0.004);
        gain1.gain.exponentialRampToValueAtTime?.(0.0001, pulse1Start + pulse1Duration);
        osc1.connect(filter1);
        filter1.connect(gain1);
        gain1.connect(dest);
        osc1.start(pulse1Start);
        osc1.stop(pulse1Start + pulse1Duration + 0.01);
        const pulse2Start = now + 0.14;
        const pulse2Duration = 0.6;
        const pulse2Freq = 1440;
        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime?.(pulse2Freq, pulse2Start);
        osc2.frequency.exponentialRampToValueAtTime?.(pulse2Freq * 0.95, pulse2Start + pulse2Duration);
        const filter2 = ctx.createBiquadFilter();
        filter2.type = "bandpass";
        filter2.frequency.setValueAtTime?.(pulse2Freq, pulse2Start);
        filter2.Q.setValueAtTime?.(20, pulse2Start);
        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime?.(0.0001, pulse2Start);
        gain2.gain.linearRampToValueAtTime?.(0.4, pulse2Start + 0.004);
        gain2.gain.exponentialRampToValueAtTime?.(0.0001, pulse2Start + pulse2Duration);
        osc2.connect(filter2);
        filter2.connect(gain2);
        gain2.connect(dest);
        osc2.start(pulse2Start);
        osc2.stop(pulse2Start + pulse2Duration + 0.01);
      }
    } catch {}
  }
  toggleMute() {
    return this.setMuted(!this.muted);
  }
  isMuted() {
    return this.muted;
  }
  setMuted(shouldMute) {
    this.muted = Boolean(shouldMute);
    try {
      this.storage.setItem(STORAGE_KEY, String(this.muted));
    } catch {}
    if (this.masterGain && this.ctx) {
      try {
        const targetGain = this.muted ? 0 : this.masterVolume;
        const now = this.ctx.currentTime || 0;
        if (typeof this.masterGain.gain.setValueAtTime === "function") {
          this.masterGain.gain.setValueAtTime(this.masterGain.gain.value ?? targetGain, now);
          this.masterGain.gain.linearRampToValueAtTime?.(targetGain, now + 0.015);
        } else {
          this.masterGain.gain.value = targetGain;
        }
      } catch {}
    }
    return this.muted;
  }
  setMasterVolume(vol) {
    const clamped = Math.max(0, Math.min(1, Number(vol) || 0));
    this.masterVolume = clamped;
    try {
      this.storage.setItem(VOLUME_KEY, String(clamped));
    } catch {}
    if (this.masterGain && this.ctx && !this.muted) {
      try {
        const now = this.ctx.currentTime || 0;
        if (typeof this.masterGain.gain.setValueAtTime === "function") {
          this.masterGain.gain.setValueAtTime(this.masterGain.gain.value ?? clamped, now);
          this.masterGain.gain.linearRampToValueAtTime?.(clamped, now + 0.015);
        } else {
          this.masterGain.gain.value = clamped;
        }
      } catch {}
    }
    return this.masterVolume;
  }
  getMasterVolume() {
    return this.masterVolume;
  }
  getState() {
    return {
      muted: this.muted,
      masterVolume: this.masterVolume,
      isInitialized: Boolean(this.ctx),
      state: this.ctx ? this.ctx.state || "running" : "uninitialized"
    };
  }
  async close() {
    if (this.ctx && typeof this.ctx.close === "function") {
      try {
        await this.ctx.close();
      } catch {}
    }
    this.ctx = null;
    this.masterGain = null;
    this.limiterNode = null;
    this.noiseBuffer = null;
  }
}
var soundEngine = new ApexSoundEngine;
var playTerminalKey = (char) => soundEngine.playTerminalKey(char);
var playTickerTick = (direction) => soundEngine.playTickerTick(direction);
var playCommandGo = () => soundEngine.playCommandGo();
var toggleMute = () => soundEngine.toggleMute();
var isMuted = () => soundEngine.isMuted();

// src/web/app.ts
var DEFAULT_PORTFOLIO = ReferenceData.getSamplePortfolio();
var CALIBRATED_RETURNS = ReferenceData.getCalibratedReturns();

class ApexWebTerminal {
  binanceWs;
  restService;
  tickers = new Map;
  prevPrices = new Map;
  fundingRates = [];
  fearGreed = null;
  portfolio = DEFAULT_PORTFOLIO;
  activeScreen = "MARKET";
  selectedStressId = "CRYPTO_CRASH_20";
  constructor() {
    this.binanceWs = new BinanceWsFeedManager({
      webSocketConstructor: typeof WebSocket !== "undefined" ? WebSocket : undefined
    });
    this.restService = new RestFallbackService;
    this.initDOM();
    this.bindEvents();
    this.startFeeds();
    this.startClock();
  }
  initDOM() {
    const root = document.getElementById("terminal-root");
    if (!root)
      return;
    root.innerHTML = `
      <div class="terminal-container">
        <!-- Top Bloomberg Header -->
        <header class="terminal-header">
          <div class="header-left">
            <span class="terminal-brand">APEX // TERMINAL</span>
            <span class="terminal-tag">BLACKROCK ALADDIN × BLOOMBERG CORE</span>
            <span class="system-time" id="system-clock">UTC 00:00:00</span>
          </div>
          <div class="header-right">
            <div class="feed-status" id="ws-status">
              <span class="status-dot"></span>
              <span id="ws-status-text">CONNECTING</span>
            </div>
            <button id="btn-audio-toggle" class="terminal-btn-sm" title="Toggle Sound">
              ${isMuted() ? "\uD83D\uDD07 SOUND: OFF" : "\uD83D\uDD0A SOUND: ON"}
            </button>
          </div>
        </header>

        <!-- Ticker Tape -->
        <div class="ticker-tape-container">
          <div class="ticker-tape" id="ticker-tape">
            <span class="tape-item">INITIALIZING FEEDS...</span>
          </div>
        </div>

        <!-- Bloomberg Command Bar -->
        <section class="command-bar-section">
          <div class="command-prompt-box">
            <span class="command-prefix">APEX:&gt;</span>
            <input type="text" id="cmd-input" class="command-input" placeholder="Enter command (e.g. BTC &lt;GO&gt;, RISK &lt;GO&gt;, FUND &lt;GO&gt;)..." autocomplete="off" spellcheck="false" />
            <button id="btn-go" class="btn-go">&lt;GO&gt;</button>
          </div>
          <div class="quick-commands">
            <button class="cmd-chip active" data-cmd="MARKET">MARKET &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="RISK">RISK &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="FUND">FUND &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="PORT">PORT &lt;GO&gt;</button>
            <button class="cmd-chip" data-cmd="HELP">HELP &lt;GO&gt;</button>
          </div>
        </section>

        <!-- Main Terminal Dashboard Area -->
        <main class="terminal-body" id="terminal-body"></main>

        <!-- Terminal Footer Status Bar -->
        <footer class="terminal-footer">
          <div class="footer-left">
            <span>[F1: HELP]</span>
            <span>[F2: MARKET]</span>
            <span>[F3: RISK]</span>
            <span>[F4: FUND]</span>
            <span>[F8: PORT]</span>
          </div>
          <div class="footer-right">
            <span>ZERO-CLOUD · 100% LOCAL ALADDIN RISK ENGINE · PUBLIC WEBSOCKETS</span>
          </div>
        </footer>
      </div>
    `;
  }
  bindEvents() {
    const cmdInput = document.getElementById("cmd-input");
    const btnGo = document.getElementById("btn-go");
    const audioToggle = document.getElementById("btn-audio-toggle");
    audioToggle?.addEventListener("click", () => {
      const muted = toggleMute();
      audioToggle.textContent = muted ? "\uD83D\uDD07 SOUND: OFF" : "\uD83D\uDD0A SOUND: ON";
      if (!muted)
        playCommandGo();
    });
    cmdInput?.addEventListener("keydown", (e) => {
      playTerminalKey(e.key);
      if (e.key === "Enter") {
        this.executeCommand(cmdInput.value);
        cmdInput.value = "";
      }
    });
    btnGo?.addEventListener("click", () => {
      this.executeCommand(cmdInput.value);
      cmdInput.value = "";
    });
    document.querySelectorAll(".cmd-chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        const cmd = e.currentTarget.getAttribute("data-cmd");
        if (cmd) {
          playCommandGo();
          this.executeCommand(`${cmd} <GO>`);
        }
      });
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "F1") {
        e.preventDefault();
        this.executeCommand("HELP <GO>");
      } else if (e.key === "F2") {
        e.preventDefault();
        this.executeCommand("MARKET <GO>");
      } else if (e.key === "F3") {
        e.preventDefault();
        this.executeCommand("RISK <GO>");
      } else if (e.key === "F4") {
        e.preventDefault();
        this.executeCommand("FUND <GO>");
      } else if (e.key === "F8") {
        e.preventDefault();
        this.executeCommand("PORT <GO>");
      }
    });
  }
  executeCommand(raw) {
    const cleaned = raw.toUpperCase().replace(/<GO>/g, "").trim();
    if (!cleaned)
      return;
    playCommandGo();
    if (cleaned === "MARKET" || cleaned === "MKT") {
      this.activeScreen = "MARKET";
    } else if (cleaned === "RISK" || cleaned === "ALADDIN" || cleaned === "VAR") {
      this.activeScreen = "RISK";
    } else if (cleaned === "FUND" || cleaned === "FUNDING" || cleaned === "PERP") {
      this.activeScreen = "FUNDING";
    } else if (cleaned === "PORT" || cleaned === "PORTFOLIO" || cleaned === "POS") {
      this.activeScreen = "PORT";
    } else if (cleaned === "HELP" || cleaned === "INDEX") {
      this.activeScreen = "HELP";
    } else if ([
      "BTC",
      "ETH",
      "SOL",
      "BNB",
      "XRP",
      "DOGE",
      "TON",
      "AVAX",
      "SUI",
      "PEPE"
    ].includes(cleaned)) {
      this.activeScreen = "MARKET";
    } else {
      this.activeScreen = "HELP";
    }
    document.querySelectorAll(".cmd-chip").forEach((c) => {
      const match = c.getAttribute("data-cmd") === this.activeScreen;
      c.classList.toggle("active", match);
    });
    this.render();
  }
  startFeeds() {
    this.binanceWs.onTicker((ticker) => {
      const prev = this.prevPrices.get(ticker.symbol);
      const isUp = prev !== undefined && ticker.price > prev;
      const isDown = prev !== undefined && ticker.price < prev;
      if (isUp)
        playTickerTick(true);
      else if (isDown)
        playTickerTick(false);
      this.prevPrices.set(ticker.symbol, ticker.price);
      this.tickers.set(ticker.symbol, ticker);
      this.updateTickerTape();
      if (this.activeScreen === "MARKET") {
        this.updateMarketTableLive(ticker, isUp, isDown);
      }
    });
    this.binanceWs.onStateChange((state) => {
      this.updateWsStatus(state);
    });
    this.binanceWs.connect();
    FundingRateCalculator.fetchLiveFundingRates().then((rates) => {
      this.fundingRates = rates;
      if (this.activeScreen === "FUNDING")
        this.render();
    }).catch((e) => console.warn("Funding fetch notice:", e));
    this.restService.fetchFearAndGreed().then((data) => {
      this.fearGreed = data;
      if (this.activeScreen === "MARKET")
        this.render();
    }).catch((e) => console.warn("Fear & Greed notice:", e));
    setInterval(() => {
      FundingRateCalculator.fetchLiveFundingRates().then((r) => this.fundingRates = r);
    }, 60000);
  }
  updateWsStatus(state) {
    const el = document.getElementById("ws-status");
    const txt = document.getElementById("ws-status-text");
    if (!el || !txt)
      return;
    el.className = `feed-status status-${state.toLowerCase()}`;
    txt.textContent = `BINANCE WS: ${state}`;
  }
  startClock() {
    const clockEl = document.getElementById("system-clock");
    setInterval(() => {
      if (clockEl) {
        const now = new Date;
        clockEl.textContent = `UTC ${now.toISOString().substring(11, 19)} · NY ${now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })}`;
      }
    }, 1000);
  }
  updateTickerTape() {
    const tape = document.getElementById("ticker-tape");
    if (!tape)
      return;
    const items = [];
    const keys = [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
      "BNBUSDT",
      "XRPUSDT",
      "DOGEUSDT",
      "TONUSDT",
      "SUIUSDT"
    ];
    keys.forEach((k) => {
      const t = this.tickers.get(k);
      if (t) {
        const sym = k.replace("USDT", "");
        const changeClass = t.priceChangePercent24h >= 0 ? "text-green" : "text-red";
        const sign = t.priceChangePercent24h >= 0 ? "+" : "";
        items.push(`
          <span class="tape-tick">
            <strong>${sym}</strong>: $${t.price.toLocaleString(undefined, { minimumFractionDigits: t.price < 10 ? 4 : 2 })}
            <span class="${changeClass}">(${sign}${t.priceChangePercent24h.toFixed(2)}%)</span>
          </span>
        `);
      }
    });
    if (this.fearGreed) {
      items.unshift(`
        <span class="tape-tick tape-highlight">
          <strong>FEAR &amp; GREED</strong>: ${this.fearGreed.value} (${this.fearGreed.valueClassification.toUpperCase()})
        </span>
      `);
    }
    if (items.length > 0) {
      tape.innerHTML = items.join('<span class="tape-sep">│</span>');
    }
  }
  render() {
    const body = document.getElementById("terminal-body");
    if (!body)
      return;
    if (this.activeScreen === "MARKET") {
      this.renderMarketScreen(body);
    } else if (this.activeScreen === "RISK") {
      this.renderRiskScreen(body);
    } else if (this.activeScreen === "FUNDING") {
      this.renderFundingScreen(body);
    } else if (this.activeScreen === "PORT") {
      this.renderPortfolioScreen(body);
    } else if (this.activeScreen === "HELP") {
      this.renderHelpScreen(body);
    }
  }
  renderMarketScreen(container) {
    container.innerHTML = `
      <div class="terminal-screen screen-market">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">1. MARKET MATRIX &amp; ORDERFLOW DEPTH</h2>
            <span class="screen-subtitle">REAL-TIME MULTI-ASSET STREAMING VIA ZERO-KEY WEBSOCKETS</span>
          </div>
          <div class="header-stat-pills">
            ${this.fearGreed ? `
              <div class="stat-pill">
                <span class="pill-label">SENTIMENT</span>
                <span class="pill-val ${this.fearGreed.value >= 50 ? "text-green" : "text-red"}">
                  ${this.fearGreed.value}/100 [${this.fearGreed.valueClassification.toUpperCase()}]
                </span>
              </div>
            ` : ""}
          </div>
        </div>

        <div class="market-matrix-table-wrap">
          <table class="terminal-table" id="market-table">
            <thead>
              <tr>
                <th>SYMBOL</th>
                <th>LAST PRICE</th>
                <th>24H CHG</th>
                <th>24H HIGH</th>
                <th>24H LOW</th>
                <th>24H VOLUME</th>
                <th>ORDERFLOW BIAS</th>
              </tr>
            </thead>
            <tbody>
              ${BinanceWsFeedManager.DEFAULT_SYMBOLS.map((sym) => this.renderTableRow(sym)).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  renderTableRow(sym) {
    const t = this.tickers.get(sym);
    const asset = sym.replace("USDT", "");
    const price = t ? `$${t.price.toLocaleString(undefined, { minimumFractionDigits: t.price < 5 ? 4 : 2 })}` : "FETCHING...";
    const chg = t ? `${t.priceChangePercent24h >= 0 ? "+" : ""}${t.priceChangePercent24h.toFixed(2)}%` : "--";
    const chgClass = t ? t.priceChangePercent24h >= 0 ? "text-green" : "text-red" : "";
    const high = t ? `$${t.high24h.toLocaleString()}` : "--";
    const low = t ? `$${t.low24h.toLocaleString()}` : "--";
    const vol = t ? `$${Math.round(t.quoteVolume24h).toLocaleString()}` : "--";
    return `
      <tr id="row-${sym}">
        <td class="td-symbol"><strong>${asset}</strong>/USDT</td>
        <td class="td-price" id="price-${sym}">${price}</td>
        <td class="td-chg ${chgClass}" id="chg-${sym}">${chg}</td>
        <td class="td-high">${high}</td>
        <td class="td-low">${low}</td>
        <td class="td-vol">${vol}</td>
        <td class="td-bias">
          <div class="orderflow-bar">
            <div class="orderflow-buy" style="width: 54%;"></div>
            <div class="orderflow-sell" style="width: 46%;"></div>
          </div>
        </td>
      </tr>
    `;
  }
  updateMarketTableLive(ticker, isUp, isDown) {
    const priceCell = document.getElementById(`price-${ticker.symbol}`);
    const chgCell = document.getElementById(`chg-${ticker.symbol}`);
    if (!priceCell)
      return;
    priceCell.textContent = `$${ticker.price.toLocaleString(undefined, { minimumFractionDigits: ticker.price < 5 ? 4 : 2 })}`;
    priceCell.classList.remove("cell-flash-up", "cell-flash-down");
    priceCell.offsetWidth;
    priceCell.classList.add(isUp ? "cell-flash-up" : isDown ? "cell-flash-down" : "cell-neutral");
    if (chgCell) {
      chgCell.textContent = `${ticker.priceChangePercent24h >= 0 ? "+" : ""}${ticker.priceChangePercent24h.toFixed(2)}%`;
      chgCell.className = `td-chg ${ticker.priceChangePercent24h >= 0 ? "text-green" : "text-red"}`;
    }
  }
  renderRiskScreen(container) {
    let totalVal = 0;
    this.portfolio.positions.forEach((p) => {
      const live = this.tickers.get(`${p.symbol}USDT`);
      if (live) {
        p.currentPrice = live.price;
        p.valueUsd = p.amount * p.currentPrice;
      }
      totalVal += p.valueUsd;
    });
    this.portfolio.totalValueUsd = this.portfolio.cashUsd + totalVal;
    this.portfolio.totalCollateralUsd = this.portfolio.totalValueUsd;
    const varResult = AladdinRiskEngine.calculateParametricVaR(this.portfolio, CALIBRATED_RETURNS, 0.95, 1);
    const betaResult = AladdinRiskEngine.calculateBeta(this.portfolio, CALIBRATED_RETURNS, "BTC");
    const divResult = AladdinRiskEngine.calculateDiversification(this.portfolio, CALIBRATED_RETURNS);
    const scenario = AladdinRiskEngine.DEFAULT_SCENARIOS.find((s) => s.id === this.selectedStressId) || AladdinRiskEngine.DEFAULT_SCENARIOS[0];
    const stressResult = AladdinRiskEngine.runStressTest(this.portfolio, scenario);
    container.innerHTML = `
      <div class="terminal-screen screen-risk">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">2. BLACKROCK ALADDIN RISK ENGINE</h2>
            <span class="screen-subtitle">PARAMETRIC VALUE-AT-RISK (VaR 95%), BENCHMARK BETA &amp; STRESS SIMULATION</span>
          </div>
          <span class="terminal-badge badge-aladdin">ALADDIN CORE ACTIVE</span>
        </div>

        <!-- Aladdin High-Level Risk Metrics -->
        <div class="aladdin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">TOTAL PORTFOLIO VALUE</span>
            <span class="kpi-val text-cyan">$${Math.round(varResult.portfolioValueUsd).toLocaleString()}</span>
            <span class="kpi-sub">${this.portfolio.positions.length} ACTIVE POSITIONS</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">1-DAY VaR (95% CONFIDENCE)</span>
            <span class="kpi-val text-red">-$${Math.round(varResult.parametricVaRUsd).toLocaleString()}</span>
            <span class="kpi-sub">${varResult.parametricVaRPercent.toFixed(2)}% CAPITAL AT RISK</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">PORTFOLIO BETA TO BTC</span>
            <span class="kpi-val text-amber">${betaResult.portfolioBeta.toFixed(2)}</span>
            <span class="kpi-sub">${betaResult.systemicRiskClassification} EXPOSURE</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">DIVERSIFICATION SCORE</span>
            <span class="kpi-val text-green">${divResult.score.toFixed(0)}/100</span>
            <span class="kpi-sub">${divResult.regime} RISK SPREAD</span>
          </div>
        </div>

        <!-- Stress Testing Scenario Section -->
        <section class="terminal-section mt-4">
          <div class="section-header-flex">
            <div>
              <span class="section-title">MULTI-FACTOR STRESS TEST SCENARIO ENGINE</span>
              <p class="section-desc">Simulate non-linear market contagion, cascading liquidation buffers, and drawdown.</p>
            </div>
            <div class="scenario-buttons">
              ${AladdinRiskEngine.DEFAULT_SCENARIOS.map((s) => `
                <button class="scenario-btn ${s.id === this.selectedStressId ? "active" : ""}" data-id="${s.id}">
                  ${s.name}
                </button>
              `).join("")}
            </div>
          </div>

          <div class="stress-results-card">
            <div class="stress-summary-row">
              <div>
                <span class="stat-label">Stressed Portfolio Value</span>
                <span class="stat-val text-cyan">$${Math.round(stressResult.stressedPortfolioValueUsd).toLocaleString()}</span>
              </div>
              <div>
                <span class="stat-label">Projected Dollar Drawdown</span>
                <span class="stat-val text-red">-$${Math.round(stressResult.totalDrawdownUsd).toLocaleString()}</span>
              </div>
              <div>
                <span class="stat-label">Percentage Impact</span>
                <span class="stat-val text-red">-${stressResult.totalDrawdownPercent.toFixed(2)}%</span>
              </div>
              <div>
                <span class="stat-label">System Liquidation Alert</span>
                <span class="stat-val ${stressResult.liquidatedPositions.length > 0 ? "text-red" : "text-green"}">
                  ${stressResult.liquidatedPositions.length > 0 ? "⚠️ LIQUIDATION TRIGGERED" : "✓ LIQUIDATION SAFE"}
                </span>
              </div>
            </div>

            <!-- Position Stress Impact Table -->
            <table class="terminal-table mt-3">
              <thead>
                <tr>
                  <th>ASSET</th>
                  <th>STRESSED VALUE</th>
                  <th>DRAWDOWN PnL</th>
                  <th>DRAWDOWN %</th>
                  <th>DIST. TO LIQ</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${Object.values(stressResult.positionImpacts).map((p) => `
                  <tr>
                    <td><strong>${p.symbol}</strong></td>
                    <td>$${Math.round(p.stressedValueUsd).toLocaleString()}</td>
                    <td class="text-red">-$${Math.round(p.pnlDrawdownUsd).toLocaleString()}</td>
                    <td class="text-red">${p.pnlDrawdownPercent.toFixed(1)}%</td>
                    <td>${(p.distanceToLiquidationPercent * 100).toFixed(1)}%</td>
                    <td>
                      <span class="health-pill ${p.isLiquidated ? "health-critical" : p.distanceToLiquidationPercent < 0.15 ? "health-warning" : "health-safe"}">
                        ${p.isLiquidated ? "LIQUIDATED" : "SOLVENT"}
                      </span>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
    this.bindRiskEvents();
  }
  bindRiskEvents() {
    document.querySelectorAll(".scenario-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.getAttribute("data-id");
        if (id) {
          playCommandGo();
          this.selectedStressId = id;
          this.render();
        }
      });
    });
  }
  renderFundingScreen(container) {
    container.innerHTML = `
      <div class="terminal-screen screen-funding">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">3. PERPETUAL FUNDING RATE HEATMAP &amp; REGIME MATRIX</h2>
            <span class="screen-subtitle">BINANCE FUTURES PUBLIC 8-HOUR RATE, ANNUALIZED APR &amp; SQUEEZE DETECTOR</span>
          </div>
        </div>

        <div class="funding-table-wrap">
          <table class="terminal-table">
            <thead>
              <tr>
                <th>PERP SYMBOL</th>
                <th>INDEX PRICE</th>
                <th>MARK PRICE</th>
                <th>8H RATE</th>
                <th>ANNUALIZED APR</th>
                <th>COMPOUNDED APY</th>
                <th>MARKET REGIME</th>
              </tr>
            </thead>
            <tbody>
              ${this.fundingRates.length === 0 ? `<tr><td colspan="7" class="text-center">Awaiting Binance Futures Funding Rate Feed...</td></tr>` : this.fundingRates.map((f) => {
      const isExtreme = f.regime === "EXTREME_BULL" || f.regime === "SHORT_SQUEEZE_RISK";
      const isSqueeze = f.regime === "SHORT_SQUEEZE_RISK";
      const rateClass = f.annualizedAPR >= 0 ? "text-green" : "text-red";
      return `
                    <tr class="${isExtreme ? "row-highlight" : ""}">
                      <td><strong>${f.symbol}</strong></td>
                      <td>$${f.indexPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td>$${f.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td class="${rateClass}">${(f.fundingRate * 100).toFixed(4)}%</td>
                      <td class="${rateClass}">${f.annualizedAPR >= 0 ? "+" : ""}${f.annualizedAPR.toFixed(2)}%</td>
                      <td class="${rateClass}">${f.annualizedAPY.toFixed(2)}%</td>
                      <td>
                        <span class="regime-badge ${isSqueeze ? "regime-squeeze" : isExtreme ? "regime-extreme" : "regime-normal"}">
                          ${f.regime}
                        </span>
                      </td>
                    </tr>
                  `;
    }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  renderPortfolioScreen(container) {
    let totalNominal = 0;
    this.portfolio.positions.forEach((p) => {
      const live = this.tickers.get(`${p.symbol}USDT`);
      if (live) {
        p.currentPrice = live.price;
        p.valueUsd = p.amount * p.currentPrice;
      }
      totalNominal += p.valueUsd;
    });
    container.innerHTML = `
      <div class="terminal-screen screen-portfolio">
        <div class="screen-header">
          <div class="screen-title-group">
            <h2 class="screen-title">4. INSTITUTIONAL PORTFOLIO LEDGER</h2>
            <span class="screen-subtitle">TOTAL NAV: $${Math.round(totalNominal + this.portfolio.cashUsd).toLocaleString()} USD</span>
          </div>
        </div>

        <table class="terminal-table mt-3">
          <thead>
            <tr>
              <th>ASSET</th>
              <th>QUANTITY</th>
              <th>ENTRY PRICE</th>
              <th>CURRENT PRICE</th>
              <th>NOMINAL VALUE</th>
              <th>UNREALIZED PnL</th>
              <th>LEVERAGE</th>
            </tr>
          </thead>
          <tbody>
            ${this.portfolio.positions.map((pos) => {
      const entry = pos.entryPrice ?? pos.currentPrice;
      const pnl = (pos.currentPrice - entry) * pos.amount;
      const pnlPercent = entry > 0 ? (pos.currentPrice - entry) / entry * 100 : 0;
      const pnlClass = pnl >= 0 ? "text-green" : "text-red";
      return `
                <tr>
                  <td><strong>${pos.symbol}</strong></td>
                  <td>${pos.amount.toLocaleString()}</td>
                  <td>$${entry.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td>$${pos.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td>$${Math.round(pos.valueUsd).toLocaleString()}</td>
                  <td class="${pnlClass}">${pnl >= 0 ? "+" : ""}$${Math.round(pnl).toLocaleString()} (${pnlPercent.toFixed(2)}%)</td>
                  <td>${pos.leverage || 1}x</td>
                </tr>
              `;
    }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }
  renderHelpScreen(container) {
    container.innerHTML = `
      <div class="terminal-screen screen-help">
        <div class="screen-header">
          <h2 class="screen-title">APEX TERMINAL COMMAND INDEX &amp; GRAMMAR</h2>
        </div>

        <div class="help-grid">
          <div class="help-card">
            <span class="help-cmd">MARKET &lt;GO&gt; [F2]</span>
            <p>Live streaming multi-asset pricing matrix, orderflow depth imbalance, and Fear &amp; Greed gauge.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">RISK &lt;GO&gt; [F3]</span>
            <p>BlackRock Aladdin Parametric Value-at-Risk (VaR 95%), Portfolio Beta to Bitcoin, and Diversification score.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">FUND &lt;GO&gt; [F4]</span>
            <p>Perpetual futures funding rate heatmap, APR/APY compounding, and short-squeeze trigger detector.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">PORT &lt;GO&gt; [F8]</span>
            <p>Portfolio holdings ledger, unrealized PnL tracking, and leverage margins.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">BTC &lt;GO&gt; / ETH &lt;GO&gt;</span>
            <p>Direct symbol lookup and real-time execution monitor.</p>
          </div>

          <div class="help-card">
            <span class="help-cmd">HELP &lt;GO&gt; [F1]</span>
            <p>Display this syntax index and institutional architecture guide.</p>
          </div>
        </div>
      </div>
    `;
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    new ApexWebTerminal;
  });
}
