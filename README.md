# 🏛️ Apex Terminal — Institutional Quant Execution, Orderflow & BlackRock Aladdin Risk Engine

Institutional digital asset execution cockpit, 24-hour multi-venue whale tranche clustering engine, L2 Stoikov micro-price orderbook analyzer, Deribit options gamma radar, and BlackRock Aladdin risk matrix.

[![Live Terminal](https://img.shields.io/badge/Live_Terminal-GitHub_Pages-8caa6b?style=for-the-badge&logo=github)](https://markankamaransheogarat-sys.github.io/apex-terminal/)
[![Tests](https://img.shields.io/badge/Tests-95%2F95_Passed-8caa6b?style=for-the-badge)](https://github.com/markankamaransheogarat-sys/apex-terminal)
[![Design System](https://img.shields.io/badge/Theme-Jarvis--Tech_Concrete_%26_Paper-d8b876?style=for-the-badge)](https://markankamaransheogarat-sys.github.io/apex-terminal/)
[![Zero-Key Feeds](https://img.shields.io/badge/Feeds-5_Direct_WebSockets_%2B_Deribit-5d909b?style=for-the-badge)](https://github.com/markankamaransheogarat-sys/apex-terminal)

👉 **Launch Live Web Terminal**: [https://markankamaransheogarat-sys.github.io/apex-terminal/](https://markankamaransheogarat-sys.github.io/apex-terminal/)

---

## ⚡ 14 Institutional `<GO>` Modules

| Screen Command | Module & Quantitative Capabilities |
| :--- | :--- |
| **`MARKET <GO>`** `[F2]` | Live multi-asset streaming matrix (`Binance WS`), 24h orderflow bid/ask imbalance, and Fear & Greed index. |
| **`📈 CHART <GO>`** `[F5]` | 60 FPS HTML5 Canvas candlestick chart with session VWAP, horizontal Volume Profile (POC), and overlaid **Whale Campaign VWAP lines & block trade footprints**. |
| **`🧱 BOOK <GO>`** | 100ms L2 Orderbook Depth (`@depth20@100ms`), **Stoikov (2018) Micro-Price & micro-alpha skew (bps)**, 20-level OBI, **Liquidity Wall Detector** ($\ge 2.2\times$ mean depth), and \$500K market sweep slippage estimator. |
| **`🧮 EXEC <GO>`** | **Quant Execution Calculator**: **Wall-Protected Stop-Loss** (shielded behind L2 Bid/Ask Wall + $0.45\times \text{ATR}_{14}$ noise buffer), **Half-Kelly Position Sizer**, `TP1 (1.5R)` / `TP2 (2.5R)` / `TP3 (50x Magnet)`, and **25x–100x Liquidation Magnet Cluster Heatmap**. |
| **`🦅 DERIV <GO>`** | **Deribit Live Options Gamma & Max Pain Matrix** (`BTC` & `ETH` Max Pain Strike, Call Wall, Put Wall, Put/Call Ratio, Mean IV %) + **4-Quadrant OI Regime Matrix** (`LONG_BUILDUP`, `SHORT_COVERING`, `SHORT_BUILDUP`, `LONG_CAPITULATION`), Smart Money vs Retail L/S, and **RVOL / Whale CVD Divergence Scanner**. |
| **`🐋 WHALE <GO>`** `[F6]` | **24-Hour IndexedDB Whale Persistence**, 5 live zero-key streams (`Binance Spot aggTrade` with exact `l - f + 1` swept orders, `Bybit V5`, `OKX V5`, `Binance !forceOrder`, `mempool.space`), **4-Factor Tranche Clustering Engine** (`ICEBERG_CLIP`, `CROSS_VENUE_SWEEP`, `TWAP_CAMPAIGN`, `ORDERBOOK_SWEEP`), **Hybrid Alpha Engine**, **Live Signal Attribution Tracker (bps, MFE, Win Rate, Profit Factor)**, and 1-click CSV/JSON export. |
| **`⚡ LIQ <GO>`** `[F7]` | Real-time multi-venue forced liquidations radar (`Binance Futures` + `Bybit V5` + `OKX V5`) with Long vs Short casualty ratio breakdown. |
| **`RISK <GO>`** `[F3]` | **BlackRock Aladdin Risk Engine**: 1-day Parametric $\text{VaR}_{95\%}$ & $\text{VaR}_{99\%}$ from real 60-day Binance daily return covariance, Portfolio Beta to BTC, Diversification Score ($0\text{–}100$), and multi-factor stress testing. |
| **`💰 ARB <GO>`** `[F9]` | Institutional Cash & Carry Basis Arbitrage Matrix: Spot vs Perpetual spread, annualized delta-neutral yield, and funding carry signals. |
| **`FUND <GO>`** `[F4]` | Perpetual futures funding rate heatmap, annualized APR/APY compounding, and crowded short-squeeze trigger detector. |
| **`📰 NEWS <GO>`** `[F10]` | Real-time crypto news wire with algorithmic NLP sentiment scoring (Bullish / Bearish / Neutral). |
| **`MACRO <GO>`** | Bitcoin Mempool `sat/vB` fee priority dynamics (`mempool.space`) & cross-asset Futures Open Interest (`fapi.binance.com`). |
| **`PORT <GO>`** `[F8]` | Verified institutional reserve presets (`MicroStrategy`, `BlackRock IBIT`, `Vitalik`, `Tether`) + custom personal portfolio ledger persisted in browser storage. |
| **`🔔 ALERT <GO>`** | Browser desktop notifications, procedural Web Audio synthesis, and **Direct Telegram Quant Bot Webhook Bridge** for automated alpha & whale alerts. |

---

## 📐 Core Quantitative Models

### 1. Stoikov (2018) Micro-Price & Order Book Imbalance (`BOOK <GO>`)
$$I = \frac{Q_{\text{bid}}}{Q_{\text{bid}} + Q_{\text{ask}}}, \quad P_{\text{micro}} = P_{\text{bid}} \cdot (1 - I) + P_{\text{ask}} \cdot I$$
$$\text{MicroSkew (bps)} = \frac{P_{\text{micro}} - P_{\text{mid}}}{P_{\text{mid}}} \times 10{,}000, \quad \text{OBI}_{20} = \frac{\sum_{i=1}^{20} V_{\text{bid},i} - \sum_{i=1}^{20} V_{\text{ask},i}}{\sum_{i=1}^{20} V_{\text{bid},i} + \sum_{i=1}^{20} V_{\text{ask},i}}$$

### 2. Wall-Protected Stop-Loss & Half-Kelly Sizing (`EXEC <GO>`)
$$\text{Stop}_{\text{LONG}} = \min\left(P_{\text{entry}} - 1.1\cdot\text{ATR}_{14}, \; P_{\text{BidWall}} - 0.45\cdot\text{ATR}_{14}\right)$$
$$Q_{\text{pos}} = \frac{\text{Equity} \times \text{Risk\%}}{|P_{\text{entry}} - \text{Stop}|}, \quad f^*_{\text{Half-Kelly}} = \frac{1}{2}\left(p - \frac{1 - p}{b}\right)$$

### 3. Option Max Pain Strike (`DERIV <GO>`)
$$S_{\text{MaxPain}} = \arg\min_{S} \left[ \sum_{K < S} (S - K)\cdot \text{OI}_{\text{Call}}(K) + \sum_{K > S} (K - S)\cdot \text{OI}_{\text{Put}}(K) \right]$$

### 4. Parametric Value-at-Risk (`RISK <GO>`)
$$\sigma_p^2 = \mathbf{w}^T \mathbf{\Sigma} \mathbf{w}, \quad \text{VaR}_{1-\alpha} = \text{PortfolioValue} \times Z_{1-\alpha} \times \sigma_p$$

---

## 🚀 Quickstart & Verification

```bash
# Run all 95 unit tests across 25 test suites
npm test

# Build TypeScript & bundle browser production build (dist/web.js)
npm run build
```
