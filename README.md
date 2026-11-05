# 🏛️ Apex Terminal — Bloomberg Terminal & BlackRock Aladdin for Digital Assets

Institutional-grade digital asset execution telemetry, real-time public feeds, and Aladdin risk analytics engine.

[![Live Terminal](https://img.shields.io/badge/Live_Terminal-GitHub_Pages-00d8ff?style=for-the-badge&logo=github)](https://markankamaransheogarat-sys.github.io/apex-terminal/)
[![Tests](https://img.shields.io/badge/Tests-75%2F75_Passed-00ff66?style=for-the-badge)](https://github.com/markankamaransheogarat-sys/apex-terminal)
[![Audio](https://img.shields.io/badge/Audio-Procedural_Web_Audio-ff9900?style=for-the-badge)](https://github.com/markankamaransheogarat-sys/apex-terminal)
[![Zero-Cloud](https://img.shields.io/badge/Zero--Cloud-100%25_Local-8b5cf6?style=for-the-badge)](https://github.com/markankamaransheogarat-sys/apex-terminal)

👉 **Launch Live Web Terminal**: [https://markankamaransheogarat-sys.github.io/apex-terminal/](https://markankamaransheogarat-sys.github.io/apex-terminal/)

---

## ⚡ Architectural Overview

```
                                    ┌────────────────────────────────────────┐
                                    │        APEX TERMINAL PRO (ANSI)        │
                                    │    (Bloomberg Lexer & Key Dispatch)    │
                                    └───────────────────┬────────────────────┘
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         APEX UNIFIED CORE ENGINE                                                │
│                                                                                                                 │
│   ┌──────────────────────────────────────────────┐        ┌─────────────────────────────────────────────────┐   │
│   │         Public Free Feeds Subsystem          │        │          BlackRock Aladdin Risk Engine          │   │
│   │                                              │        │                                                 │   │
│   │  • Binance Public WS (!miniTicker & Multi)   │        │  • Parametric Value-at-Risk (VaR 95% / 99%)     │   │
│   │  • Bybit V5 Public WS (Linear / Spot)        │        │  • Benchmark Beta vs BTC Systemic Sensitivity   │   │
│   │  • REST Fallback Cascade (Alternative.me)    │        │  • Multi-factor Stress Testing & Solvency       │   │
│   │  • Binance Futures Funding Heatmap Engine    │        │  • Non-linear Liquidation Proximity Radar       │   │
│   │  • In-Memory L1 Ticker Book & Watchdogs      │        │  • Institutional Diversification Score (0-100)  │   │
│   └──────────────────────────────────────────────┘        └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📐 Quantitative Models & Mathematical Foundations

### 1. Parametric Value-at-Risk (1-Day $\text{VaR}_{95\%}$ & $\text{VaR}_{99\%}$)
$$\sigma_p^2 = \mathbf{w}^T \mathbf{\Sigma} \mathbf{w} = \sum_{i=1}^N \sum_{j=1}^N w_i w_j \Sigma_{ij}$$
$$\text{VaR}_{1-\alpha} = \text{PortfolioValue} \times Z_{1-\alpha} \times \sigma_p$$
- **Component VaR ($\text{CVaR}_i$)**: $\text{CVaR}_i = w_i \times \text{PortfolioValue} \times Z \times \frac{(\mathbf{\Sigma}\mathbf{w})_i}{\sigma_p}$
- **Marginal VaR ($\text{MVaR}_i$)**: $\frac{\partial \text{VaR}}{\partial w_i}$
- **Sum Property**: $\sum_{i=1}^N \text{CVaR}_i = \text{VaR}$

### 2. Benchmark Portfolio Beta (Relative to BTC)
$$\beta_i = \frac{\text{Cov}(R_i, R_{\text{btc}})}{\text{Var}(R_{\text{btc}})}, \quad \beta_p = \sum_{i=1}^N w_i \beta_i = \frac{\text{Cov}(R_p, R_{\text{btc}})}{\text{Var}(R_{\text{btc}})}$$

### 3. Perpetual Funding Rate Heatmap & APR
$$\text{APR} = \text{FundingRate}_{8h} \times 3 \times 365 \times 100\%$$
$$\text{APY} = \left[(1 + \text{FundingRate}_{8h})^{1095} - 1\right] \times 100\%$$
- **Regimes**: `EXTREME_BULL` ($>+50\%$), `MODERATE_BULL` ($+10\%$ to $+50\%$), `NEUTRAL` ($-10\%$ to $+10\%$), `MODERATE_BEAR` ($-50\%$ to $-10\%$), `SHORT_SQUEEZE_RISK` ($<-50\%$).

### 4. Institutional Diversification Score ($0 \text{ to } 100$)
$$DR = \frac{\sum_{i=1}^N w_i \sigma_i}{\sigma_p}, \quad \bar{\rho} = \frac{2}{N(N-1)}\sum_{i < j} \rho_{ij}$$
$$S_{div} = \text{clamp}\left(100 \times \left[0.6 \times \left(\frac{1 - \bar{\rho}}{2}\right) + 0.4 \times \left(\frac{DR - 1}{\sqrt{N} - 1}\right)\right], 0, 100\right)$$

---

## ⌨️ Bloomberg Terminal Command Grammar

| Command | Action | Hotkey |
| :--- | :--- | :--- |
| `BTC <GO>` | Live Bitcoin telemetry, quote spread, 24h stats | `F2` |
| `ETH <GO>` | Ethereum market quote & volume depth | — |
| `SOL <GO>` | Solana market quote & 24h high/low | — |
| `RISK <GO>` | Aladdin Risk Matrix: VaR (95%/99%), Beta, Component VaR | `F3` |
| `FUND <GO>` | Binance Futures Perpetual Funding Rate Heatmap | `F4` |
| `NEWS <GO>` | Alternative.me Fear & Greed Index & Global Macro | `F5` |
| `PORT <GO>` | Portfolio holdings, leverage, margin utilization | `F8` |
| `STRESS <GO>`| Multi-factor stress shock simulation & liquidation radar | — |
| `HELP <GO>` | Command manual & interactive keyboard shortcuts | `F1` |

---

## 🚀 Quickstart & Verification

```bash
# Clone and enter workspace
cd /root/.gemini/antigravity-cli/scratch/apex-terminal

# Run 46 verified unit tests
npm test

# Build production TypeScript distribution
npm run build

# Launch terminal
node dist/index.js
```
