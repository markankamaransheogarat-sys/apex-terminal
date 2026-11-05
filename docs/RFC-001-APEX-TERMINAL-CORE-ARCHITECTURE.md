# RFC-001: Apex Terminal Core Architecture & Mathematical Specification
**Status**: APPROVED  
**Author**: Principal Systems Architect  
**Domain**: Institutional Quantitative Finance, Real-Time Market Infrastructure & Risk Analytics  
**Scope**: Bloomberg Terminal & BlackRock Aladdin Parity Engine for Global Digital Assets  

---

## 1. Executive Summary

Apex Terminal is an institutional-grade digital asset terminal and risk management engine modeled after the dual paradigms of the **Bloomberg Professional Service (Terminal)** and **BlackRock Aladdin Risk Engine**.

Apex Terminal addresses three core quantitative and systems architecture pillars:
1. **Zero-Latency Public Free Feeds Architecture**: Dual-redundant WebSocket ingestion from Binance & Bybit, resilient REST fallback cascades (Alternative.me, Binance 24hr, CoinGecko), and perpetual futures funding rate surface calculation.
2. **BlackRock Aladdin Risk Engine**: Multi-asset Parametric Value-at-Risk ($\text{VaR}_{95\%}$ and $\text{VaR}_{99\%}$), Benchmark Beta decomposition against BTC, Multi-factor Stress Scenario Shocks with non-linear liquidation proximity tracking, and an institutional Diversification & Correlation Index.
3. **Bloomberg Command & Keyboard Processing Subsystem**: Unambiguous grammar parser with `<GO>` syntax tokenization, interactive autocomplete matching engine, institutional ANSI render matrix, and terminal hotkey bindings.

```
                           +----------------------------------------+
                           |       Apex Terminal UI / CLI           |
                           |   (Bloomberg ANSI / Key Processor)     |
                           +-------------------+--------------------+
                                               |
                                     Commands & Queries
                                               |
                                               v
+-----------------------------------------------------------------------------------+
|                        APEX CORE ENGINE ORCHESTRATOR                              |
|                                                                                   |
|   +------------------------------------+  +-----------------------------------+   |
|   |   Public Market Feed Subsystem     |  |   BlackRock Aladdin Risk Engine   |   |
|   |                                    |  |                                   |   |
|   | * Binance WebSocket Manager        |  | * Covariance & Correlation Matrix |   |
|   | * Bybit V5 Public WS Manager       |  | * Parametric 1-Day VaR (95%/99%)  |   |
|   | * Global REST Fallback Engine      |  | * Portfolio Beta (vs BTC)         |   |
|   | * Funding Rate Heatmap Calculator  |  | * Multi-Factor Stress Testing     |   |
|   | * In-Memory L1 Ticker Book Cache   |  | * Liquidation Proximity & Health  |   |
|   | * Auto-Reconnection & Heartbeats   |  | * Normalized Diversification (0-100)| 
|   +------------------------------------+  +-----------------------------------+   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Public Free Feeds Architecture

### 2.1 WebSocket Transport Protocols
Crypto market feeds must maintain high availability without authenticated API keys by utilizing public endpoints:
- **Binance WebSocket**:
  - Combined stream URL: `wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker/...`
  - Array Mini-Ticker URL: `wss://stream.binance.com:9443/ws/!miniTicker@arr`
  - Ping/Pong: Responds to server pings with protocol-level pong frames to prevent connection termination.
- **Bybit V5 Linear / Spot WebSocket**:
  - Linear URL: `wss://stream.bybit.com/v5/public/linear`
  - Heartbeat: Client must send `{"op": "ping"}` every 20 seconds; server returns `{"op": "pong"}`.
  - Subscription framing: `{"op": "subscribe", "args": ["tickers.BTCUSDT", "tickers.ETHUSDT", ...]}`.

### 2.2 Reconnection & Failover State Machine
To guarantee continuous uptime:
1. **Exponential Backoff**: Jittered reconnect delay $t_{reconnect} = \min(t_{max}, t_{base} \times 2^{retry}) \pm \text{jitter}$.
2. **Staleness Threshold**: If no tick arrives within 15 seconds, the connection is marked `STALE` and an immediate reconnect cycle is initiated.
3. **REST Fallback Cascade**: When all WebSocket connections fail, the orchestrator triggers REST polling every 5 seconds:
   - Primary: Binance 24hr Ticker REST API (`https://api.binance.com/api/v3/ticker/24hr`).
   - Secondary: Alternative.me Fear & Greed API (`https://api.alternative.me/fng/?limit=10`).
   - Tertiary: CoinGecko Public Ping / Ticker API.

### 2.3 Funding Rate Heatmap Mathematical Model
Perpetual contracts trade with an 8-hour funding cycle. The annualized funding rate (APR) is calculated as:
$$\text{APR} = \text{FundingRate}_{8h} \times 3 \times 365 \times 100\%$$
$$\text{APY} = \left[\left(1 + \text{FundingRate}_{8h}\right)^{1095} - 1\right] \times 100\%$$

**Sentiment Classification**:
- $\text{APR} > +50\%$: Extreme Bullishness / Overleveraged Longs (High Long Carry Cost).
- $+10\% < \text{APR} \le +50\%$: Moderately Bullish / Organic Expansion.
- $-10\% \le \text{APR} \le +10\%$: Neutral / Balanced Open Interest.
- $-50\% \le \text{APR} < -10\%$: Moderately Bearish / Short Squeeze Susceptibility.
- $\text{APR} < -50\%$: Extreme Negative / Imminent Short Squeeze Liquidation Cascade.

---

## 3. BlackRock Aladdin Risk Engine Specification

### 3.1 Parametric Value-at-Risk (VaR)
Given a portfolio of $N$ assets with position values $v_i$, total portfolio value $V = \sum_{i=1}^N v_i$, and weights $w_i = \frac{v_i}{V}$:

1. **Asset Return Covariance Matrix $\mathbf{\Sigma}$**:
   $$\Sigma_{ij} = \text{Cov}(R_i, R_j) = \frac{1}{T-1} \sum_{t=1}^T (R_{i,t} - \bar{R}_i)(R_{j,t} - \bar{R}_j)$$
2. **Portfolio Variance $\sigma_p^2$ and Volatility $\sigma_p$**:
   $$\sigma_p^2 = \mathbf{w}^T \mathbf{\Sigma} \mathbf{w} = \sum_{i=1}^N \sum_{j=1}^N w_i w_j \Sigma_{ij}$$
   $$\sigma_p = \sqrt{\sigma_p^2}$$
3. **1-Day Parametric VaR at Confidence Level $1 - \alpha$**:
   $$\text{VaR}_{1-\alpha} = V \times Z_{1-\alpha} \times \sigma_p$$
   where for $\alpha = 0.05$ (95% confidence), $Z_{0.95} \approx 1.6448536$.  
   For $\alpha = 0.01$ (99% confidence), $Z_{0.99} \approx 2.3263479$.

4. **Component VaR ($\text{CVaR}_i$) & Marginal VaR ($\text{MVaR}_i$)**:
   $$\text{MVaR}_i = \frac{\partial \text{VaR}}{\partial w_i} = V \times Z_{1-\alpha} \times \frac{(\mathbf{\Sigma} \mathbf{w})_i}{\sigma_p}$$
   $$\text{CVaR}_i = w_i \times \text{MVaR}_i, \quad \text{such that } \sum_{i=1}^N \text{CVaR}_i = \text{VaR}$$

### 3.2 Portfolio Beta Relative to Bitcoin Benchmark
The systemic risk sensitivity of the portfolio relative to Bitcoin ($R_{\text{btc}}$) is:
$$\beta_i = \frac{\text{Cov}(R_i, R_{\text{btc}})}{\text{Var}(R_{\text{btc}})}$$
$$\beta_p = \sum_{i=1}^N w_i \beta_i = \frac{\text{Cov}(R_p, R_{\text{btc}})}{\text{Var}(R_{\text{btc}})}$$

- $\beta_p = 1.0$: Portfolio volatility moves in 1:1 lockstep with Bitcoin.
- $\beta_p > 1.0$: Aggressive high-beta exposure (amplified downside during market drawdowns).
- $0 < \beta_p < 1.0$: Defensive / sub-linear sensitivity.
- $\beta_p \le 0$: Market-neutral or inverse hedge.

### 3.3 Multi-Factor Stress Testing Scenario Engine
Stress testing applies correlated macro shocks to the portfolio state:
1. **Scenario Definitions**:
   - `CRYPTO_CRASH_20`: BTC $-20\%$, ETH $-25\%$, Altcoins $-20\% \times \max(1.0, \beta_i)$.
   - `BLACK_SWAN_35`: BTC $-35\%$, ETH $-42\%$, Altcoins $-50\%$, Funding Surge $+0.08\%$ / 8h.
   - `FUNDING_BLEED`: Spot neutral, Funding Rate skyrockets to $+0.10\%$ / 8h across all perps, bleeding long carry by $-1.095\%$ per 7-day period.
   - `DEPEG_ALT_COLLAPSE`: BTC flat, ETH $-10\%$, all altcoins $-45\%$.
2. **Projected PnL Drawdown**:
   $$\Delta P = \sum_{i=1}^N v_i \times \Delta S_i - \text{FundingCostShock}$$
3. **Liquidation Proximity & Health Factor $H$**:
   For leveraged futures/margin positions with collateral $C$, entry price $P_0$, position size $Q$, and maintenance margin rate $\text{MMR}$:
   $$\text{Liquidation Price } P_{liq} = P_0 - \frac{C - \text{MMR} \times P_0 Q}{Q \times (1 - \text{MMR})} \quad (\text{for Long})$$
   $$\text{Health Factor } H = \frac{\text{Equity}}{\text{Maintenance Margin Requirement}} = \frac{C + \text{PnL}}{\sum_i |Q_i| \cdot P_i \cdot \text{MMR}_i}$$
   When $H \le 1.0$, forced institutional liquidation triggers. Proximity is reported as percentage buffer to liquidation.

### 3.4 Diversification / Correlation Score (0 to 100)
To assess risk concentration, the engine computes:
1. **Weighted Asset Volatility vs Portfolio Volatility (Diversification Ratio $DR$)**:
   $$DR = \frac{\sum_{i=1}^N w_i \sigma_i}{\sigma_p}$$
   For a single asset or perfectly correlated basket, $DR = 1.0$. For uncorrelated assets, $DR > 1.0$.
2. **Average Off-Diagonal Correlation $\bar{\rho}$**:
   $$\bar{\rho} = \frac{2}{N(N-1)} \sum_{i=1}^N \sum_{j > i}^N \rho_{ij}$$
3. **Normalized Institutional Score $S_{div} \in [0, 100]$**:
   $$S_{div} = \text{clamp}\left( 100 \times \left[ 0.6 \times (1 - \bar{\rho}) + 0.4 \times \left(1 - \frac{1}{DR}\right) \right], 0, 100 \right)$$
   - Score $0 - 25$: High Concentration / Single Factor Risk.
   - Score $26 - 55$: Typical Crypto Basket (Correlated Beta).
   - Score $56 - 80$: Multi-Sector Diversified (DeFi, L1, Memes, Stablecoins).
   - Score $81 - 100$: Institutional All-Weather Hedge (Negative correlation / Market neutral).

---

## 4. Bloomberg Command Grammar & Dispatch Specification

### 4.1 Command Grammar
The command line recognizes standard Bloomberg token patterns:
```
[COMMAND]     ::= [TICKER] [ACTION]? <GO> | [GLOBAL_ACTION] <GO>
[TICKER]      ::= "BTC" | "ETH" | "SOL" | "BNB" | "XRP" | "DOGE" | "TON" | "AVAX" | "SUI" | "PEPE" | string
[ACTION]      ::= "DES" | "RISK" | "VOL" | "FUND" | "CHART"
[GLOBAL_ACTION]::= "RISK" | "FUND" | "NEWS" | "PORT" | "HELP" | "CLEAR" | "EXIT"
<GO>          ::= "<GO>" | "<go>" | "\n" (Enter key)
```

### 4.2 Keyboard Shortcuts
- `Enter` / `<GO>`: Execute current line buffer.
- `Tab`: Autocomplete token to the closest match.
- `F1`: `HELP <GO>`.
- `F2`: Monitor / Market Overview (`BTC <GO>`).
- `F3`: Aladdin Risk Matrix (`RISK <GO>`).
- `F4`: Funding Heatmap (`FUND <GO>`).
- `F5`: News & Sentiment (`NEWS <GO>`).
- `F8`: Portfolio Holdings (`PORT <GO>`).
- `Up` / `Down`: History traversal.
- `Esc`: Clear input buffer.

---

## 5. Implementation Roadmap
1. `src/types/index.ts`: Strict mathematical and feed data interfaces.
2. `src/feeds/`: WebSocket managers (Binance, Bybit), REST fallback, funding heatmap calculator.
3. `src/risk/`: Covariance, Parametric VaR, Beta, Multi-scenario stress engine, Diversification scoring.
4. `src/terminal/`: Lexer, command grammar parser, autocomplete engine, ANSI screen renderer.
5. `tests/`: 100% rigorous unit and edge-case verification.
