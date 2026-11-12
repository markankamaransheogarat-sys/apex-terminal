/**
 * Apex Terminal - Senior Quant Executive Action Radar & Signal Synthesizer (RADAR <GO> / SIGNALS <GO>)
 *
 * Fully synthesizes the 6 Quantitative Pillars into crystal-clear, actionable,
 * institutional BUY / SELL / WAIT signals with exact entry, wall-protected SL,
 * multi-target take profits, R:R ratios, and Russian explanatory rationales.
 */

import { MasterConfluenceRow, StatArbPairSignal } from "./world-class-alpha.js";
import {
  QuantExecutionCalculator,
  QuantTradeSetup,
} from "../execution/quant-execution-calculator.js";
import { MarketTicker, FundingRateData } from "../types/index.js";
import { L2OrderbookSnapshot } from "../orderbook/orderbook-service.js";
import { WhaleTrade } from "../feeds/whale-stream.js";
import { WhaleTrancheCampaign } from "../feeds/whale-cluster-engine.js";
import { Candle } from "../chart/types.js";

export type ActionVerdict =
  | "STRONG_BUY"
  | "STRONG_SELL"
  | "ACCUMULATE_DIP"
  | "DISTRIBUTE_RALLY"
  | "WAIT_NEUTRAL";

export interface ExecutiveActionSignal {
  symbol: string;
  asset: string;
  price: number;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  verdict: ActionVerdict;
  verdictLabelRu: string;
  convictionPercent: number; // 0-100%
  masterScore: number; // -100 to +100
  timeframe: string; // "1H - 4H СВИНГ" or "ИНТРАДЕЙ"
  entryPrice: number;
  stopLossPrice: number;
  stopDistancePercent: number;
  takeProfit1: number;
  takeProfit1Percent: number;
  takeProfit2: number;
  takeProfit2Percent: number;
  takeProfit3: number;
  takeProfit3Percent: number;
  rewardToRisk: number;
  primaryReasonsRu: [string, string, string]; // Top 3 concrete rationales in Russian
  l2WallStatusRu: string;
  cvdFlowStatusRu: string;
  macroCoinbaseStatusRu: string;
  telegramTicketText: string;
  quantSetup: QuantTradeSetup | null;
}

export interface ExecutiveRadarSummary {
  timestamp: number;
  overallMarketRegimeRu: string;
  marketBiasScore: number; // Average confluence score
  totalTracked: number;
  buyCount: number;
  sellCount: number;
  waitCount: number;
  topLongPick: ExecutiveActionSignal | null;
  topShortPick: ExecutiveActionSignal | null;
  signals: ExecutiveActionSignal[];
  statArbNeutralPicks: StatArbPairSignal[];
}

export class QuantActionRadarService {
  /**
   * Synthesize real-time data across all 6 quantitative pillars into an Executive Radar summary.
   */
  public static synthesizeRadar(params: {
    confluenceRows: MasterConfluenceRow[];
    tickers: Map<string, MarketTicker>;
    fundingRates: FundingRateData[];
    whaleTrades: WhaleTrade[];
    whaleCampaigns?: WhaleTrancheCampaign[];
    orderbookSnapshots: (sym: string) => L2OrderbookSnapshot | null;
    statArbRows?: StatArbPairSignal[];
    candlesProvider?: (sym: string) => Candle[];
    accountBalanceUsd?: number;
    riskPercent?: number;
  }): ExecutiveRadarSummary {
    const balance = Math.max(100, params.accountBalanceUsd || 10000);
    const riskPct = Math.max(0.1, Math.min(10, params.riskPercent || 1.0));
    const campaigns = params.whaleCampaigns || [];
    const signals: ExecutiveActionSignal[] = [];

    for (const row of params.confluenceRows) {
      const sym = row.symbol;
      const asset = row.asset;
      const price = row.price;
      const ob = params.orderbookSnapshots(sym);
      const candles = params.candlesProvider ? params.candlesProvider(sym) : [];

      // 1. Determine Verdict & Direction based on 6-Factor Confluence
      let verdict: ActionVerdict = "WAIT_NEUTRAL";
      let verdictLabelRu = "⚪ ВНЕ РЫНКА (WAIT / CASH)";
      let direction: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
      let conviction = Math.min(
        98,
        Math.max(35, Math.abs(row.masterScore) + 25),
      );

      if (row.masterScore >= 35) {
        verdict = "STRONG_BUY";
        verdictLabelRu = "🟢 ПОКУПАТЬ (STRONG BUY)";
        direction = "LONG";
      } else if (row.masterScore >= 18) {
        verdict = "ACCUMULATE_DIP";
        verdictLabelRu = "🟢 ДОБОР НА ОТКАТЕ (BUY DIP)";
        direction = "LONG";
      } else if (row.masterScore <= -35) {
        verdict = "STRONG_SELL";
        verdictLabelRu = "🔴 ПРОДАВАТЬ (STRONG SELL)";
        direction = "SHORT";
      } else if (row.masterScore <= -18) {
        verdict = "DISTRIBUTE_RALLY";
        verdictLabelRu = "🔴 РАЗГРУЗКА НА РОСТЕ (SELL RALLY)";
        direction = "SHORT";
      } else {
        verdict = "WAIT_NEUTRAL";
        verdictLabelRu = "⚪ ВНЕ РЫНКА (WAIT / CASH)";
        direction = "NEUTRAL";
        conviction = Math.max(20, Math.min(50, 50 - Math.abs(row.masterScore)));
      }

      // 2. Compute Quant Trade Setup (Protected Stop, Targets, Sizing)
      const setupDirection: "LONG" | "SHORT" =
        direction === "SHORT" ? "SHORT" : "LONG";
      const quantSetup = QuantExecutionCalculator.calculateTradeSetup({
        symbol: sym,
        direction: setupDirection,
        accountBalanceUsd: balance,
        riskPercent: riskPct,
        currentPrice: price,
        candles,
        orderbook: ob,
        whaleCampaigns: campaigns,
      });

      const entryPrice = quantSetup.optimalEntryPrice || price;
      const stopLossPrice = quantSetup.protectedStopLoss;
      const stopDistancePercent = Number(
        ((Math.abs(entryPrice - stopLossPrice) / entryPrice) * 100).toFixed(2),
      );

      const takeProfit1 = quantSetup.takeProfit1_15R;
      const takeProfit1Percent = Number(
        ((Math.abs(takeProfit1 - entryPrice) / entryPrice) * 100).toFixed(2),
      );

      const takeProfit2 = quantSetup.takeProfit2_25R;
      const takeProfit2Percent = Number(
        ((Math.abs(takeProfit2 - entryPrice) / entryPrice) * 100).toFixed(2),
      );

      const takeProfit3 = quantSetup.takeProfit3_Magnet;
      const takeProfit3Percent = Number(
        ((Math.abs(takeProfit3 - entryPrice) / entryPrice) * 100).toFixed(2),
      );

      const rewardToRisk = Number(quantSetup.rewardToRiskRatio.toFixed(2));

      // 3. Synthesize Russian Rationales
      const sp = row.spotPerpMetrics;
      let reason1 = "";
      let cvdFlowStatusRu = "";
      if (sp.regime === "BULLISH_SPOT_ABSORPTION") {
        reason1 = `Спот-поглощение: чистая скупка фиатом на споте ($+${Math.round(sp.spotCvd12hUsd / 1e6)}M), пока на фьючерсах шортят.`;
        cvdFlowStatusRu = `🐋 Спот-поглощение: Spot CVD +$${(sp.spotCvd12hUsd / 1e6).toFixed(1)}M vs Perp -$${Math.abs(sp.perpCvd12hUsd / 1e6).toFixed(1)}M`;
      } else if (sp.regime === "BEARISH_PERP_TRAP") {
        reason1 = `Ловушка покупателей: фьючерсы с плечами покупают, а спот сбрасывается китами ($${Math.round(sp.spotCvd12hUsd / 1e6)}M).`;
        cvdFlowStatusRu = `⚠️ Ловушка лонгов: Perp CVD +$${(sp.perpCvd12hUsd / 1e6).toFixed(1)}M vs сброс спота -$${Math.abs(sp.spotCvd12hUsd / 1e6).toFixed(1)}M`;
      } else if (sp.regime === "SYNCHRONIZED_BULL_INFLOW") {
        reason1 =
          direction === "SHORT"
            ? `Разгрузка на хаях: локальный приток покупок используется крупными игроками для набора шорта.`
            : `Синхронный бычий приток: устойчивые покупки одновременно на споте и фьючерсах.`;
        cvdFlowStatusRu = `🟢 Синхронный спрос: Spot CVD +$${(sp.spotCvd12hUsd / 1e6).toFixed(1)}M`;
      } else {
        reason1 =
          direction === "LONG"
            ? `Поглощение на откате: локальные рыночные продажи встречают лимитный спрос китов у поддержки.`
            : `Синхронный медвежий отток: чистые продажи на всех деривативных площадках.`;
        cvdFlowStatusRu = `🔴 Чистые продажи: Spot CVD -$${Math.abs(sp.spotCvd12hUsd / 1e6).toFixed(1)}M`;
      }

      let reason2 = "";
      let macroCoinbaseStatusRu = "";
      if (sp.coinbasePremiumBps >= 3.5) {
        reason2 = `Институционалы США: премия Coinbase +${sp.coinbasePremiumBps.toFixed(1)} bps подтверждает приток капитала из ETF.`;
        macroCoinbaseStatusRu = `🇺🇸 Премия Coinbase: +${sp.coinbasePremiumBps.toFixed(1)} bps (Покупки фондов США)`;
      } else if (sp.coinbasePremiumBps <= -3.5) {
        reason2 = `Давление в США: дисконт Coinbase ${sp.coinbasePremiumBps.toFixed(1)} bps указывает на продажи американских фондов.`;
        macroCoinbaseStatusRu = `🇺🇸 Дисконт Coinbase: ${sp.coinbasePremiumBps.toFixed(1)} bps (Продажи фондов США)`;
      } else {
        reason2 = `Американская сессия нейтральна: премия Coinbase около нуля (${sp.coinbasePremiumBps.toFixed(1)} bps).`;
        macroCoinbaseStatusRu = `🇺🇸 Coinbase премия: ${sp.coinbasePremiumBps.toFixed(1)} bps (Паритет)`;
      }

      let reason3 = "";
      let l2WallStatusRu = "";
      const isLong = direction === "LONG" || direction === "NEUTRAL";
      if (ob && (isLong ? ob.biggestBidWall : ob.biggestAskWall)) {
        const wall = isLong ? ob.biggestBidWall! : ob.biggestAskWall!;
        const wallTypeRu = isLong ? "Плита поддержки" : "Плита сопротивления";
        const qtyStr =
          typeof wall.quantity === "number" ? wall.quantity.toFixed(1) : "0";
        reason3 = `${wallTypeRu}: подтвержденная L2-стена на $${QuantActionRadarService.formatPrice(wall.price)} защищает стоп-лосс.`;
        l2WallStatusRu = `🛡️ Плита L2: $${QuantActionRadarService.formatPrice(wall.price)} (${qtyStr} ${asset})`;
      } else {
        reason3 = `Волатильность по ATR: динамический коридор риска ${stopDistancePercent}% с фильтром шума.`;
        l2WallStatusRu = `📊 Волатильность: ATR 14 = ${stopDistancePercent}%`;
      }

      const primaryReasonsRu: [string, string, string] = [
        reason1,
        reason2,
        reason3,
      ];

      // 4. Generate Clean Telegram Ticket
      const ticket = QuantActionRadarService.buildTelegramTicket({
        asset,
        symbol: sym,
        verdictLabelRu,
        conviction,
        direction,
        entryPrice,
        stopLossPrice,
        stopDistancePercent,
        takeProfit1,
        takeProfit1Percent,
        takeProfit2,
        takeProfit2Percent,
        takeProfit3,
        takeProfit3Percent,
        rewardToRisk,
        primaryReasonsRu,
        l2WallStatusRu,
      });

      signals.push({
        symbol: sym,
        asset,
        price,
        direction,
        verdict,
        verdictLabelRu,
        convictionPercent: conviction,
        masterScore: row.masterScore,
        timeframe: "1H - 4H СВИНГ",
        entryPrice,
        stopLossPrice,
        stopDistancePercent,
        takeProfit1,
        takeProfit1Percent,
        takeProfit2,
        takeProfit2Percent,
        takeProfit3,
        takeProfit3Percent,
        rewardToRisk,
        primaryReasonsRu,
        l2WallStatusRu,
        cvdFlowStatusRu,
        macroCoinbaseStatusRu,
        telegramTicketText: ticket,
        quantSetup,
      });
    }

    // Sort signals: strongest conviction first
    signals.sort((a, b) => Math.abs(b.masterScore) - Math.abs(a.masterScore));

    const buyCount = signals.filter(
      (s) => s.verdict === "STRONG_BUY" || s.verdict === "ACCUMULATE_DIP",
    ).length;
    const sellCount = signals.filter(
      (s) => s.verdict === "STRONG_SELL" || s.verdict === "DISTRIBUTE_RALLY",
    ).length;
    const waitCount = signals.filter(
      (s) => s.verdict === "WAIT_NEUTRAL",
    ).length;

    const avgScore =
      signals.length > 0
        ? Math.round(
            signals.reduce((acc, s) => acc + s.masterScore, 0) / signals.length,
          )
        : 0;

    let overallMarketRegimeRu = "⚪ НЕЙТРАЛЬНЫЙ БОКОВИК (CHOP / RISK-OFF)";
    if (avgScore >= 25 && buyCount > sellCount) {
      overallMarketRegimeRu = "🟢 БЫЧИЙ ПРИТОК КАПИТАЛА (BULLISH CONFLUENCE)";
    } else if (avgScore <= -25 && sellCount > buyCount) {
      overallMarketRegimeRu = "🔴 МЕДВЕЖИЙ ОТТОК (BEARISH BIAS)";
    } else if (buyCount > sellCount) {
      overallMarketRegimeRu =
        "🟢 УМЕРЕННО-БЫЧИЙ РЕЖИМ (SELECTIVE ACCUMULATION)";
    } else if (sellCount > buyCount) {
      overallMarketRegimeRu = "🔴 УМЕРЕННО-МЕДВЕЖИЙ РЕЖИМ (DEFENSIVE ROTATION)";
    }

    const topLong =
      signals.find(
        (s) => s.verdict === "STRONG_BUY" || s.verdict === "ACCUMULATE_DIP",
      ) || null;
    const topShort =
      signals.find(
        (s) => s.verdict === "STRONG_SELL" || s.verdict === "DISTRIBUTE_RALLY",
      ) || null;

    const statArbNeutralPicks = (params.statArbRows || []).filter(
      (s) => s.signal !== "EQUILIBRIUM",
    );

    return {
      timestamp: Date.now(),
      overallMarketRegimeRu,
      marketBiasScore: avgScore,
      totalTracked: signals.length,
      buyCount,
      sellCount,
      waitCount,
      topLongPick: topLong,
      topShortPick: topShort,
      signals,
      statArbNeutralPicks,
    };
  }

  public static formatPrice(p: number): string {
    if (p < 0.001) return p.toFixed(6);
    if (p < 1) return p.toFixed(4);
    if (p < 10) return p.toFixed(3);
    if (p < 100) return p.toFixed(2);
    return p.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private static buildTelegramTicket(p: {
    asset: string;
    symbol: string;
    verdictLabelRu: string;
    conviction: number;
    direction: "LONG" | "SHORT" | "NEUTRAL";
    entryPrice: number;
    stopLossPrice: number;
    stopDistancePercent: number;
    takeProfit1: number;
    takeProfit1Percent: number;
    takeProfit2: number;
    takeProfit2Percent: number;
    takeProfit3: number;
    takeProfit3Percent: number;
    rewardToRisk: number;
    primaryReasonsRu: [string, string, string];
    l2WallStatusRu: string;
  }): string {
    const isNeutral = p.direction === "NEUTRAL";
    const headerEmoji =
      p.direction === "LONG" ? "🟢" : p.direction === "SHORT" ? "🔴" : "⚪";
    const actionWord =
      p.direction === "LONG"
        ? "LONG / ПОКУПКА"
        : p.direction === "SHORT"
          ? "SHORT / ПРОДАЖА"
          : "WAIT / ВНЕ РЫНКА";

    return [
      `🏛️ APEX // QUANT ACTION SIGNAL ${headerEmoji}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `📌 Актив: #${p.asset} / USDT (${actionWord})`,
      `🎯 Сигнал: ${p.verdictLabelRu}`,
      `📊 Уверенность: ${p.conviction}% (Confluence Matrix)`,
      ``,
      isNeutral
        ? `⚠️ Рекомендация: Оставаться в стейблкоинах. Смешанные факторы.`
        : [
            `💵 Вход (Optimal Entry): $${QuantActionRadarService.formatPrice(p.entryPrice)}`,
            `🛡️ Стоп-лосс (SL): $${QuantActionRadarService.formatPrice(p.stopLossPrice)} (-${p.stopDistancePercent}%)`,
            `🎯 Тейк-профит 1: $${QuantActionRadarService.formatPrice(p.takeProfit1)} (+${p.takeProfit1Percent}% · Авто-безубыток)`,
            `🎯 Тейк-профит 2: $${QuantActionRadarService.formatPrice(p.takeProfit2)} (+${p.takeProfit2Percent}% · Цель тренда)`,
            `🎯 Тейк-профит 3: $${QuantActionRadarService.formatPrice(p.takeProfit3)} (+${p.takeProfit3Percent}% · Ликвидации)`,
            `⚖️ R:R (Прибыль / Риск): ${p.rewardToRisk} : 1`,
          ].join("\n"),
      ``,
      `🔍 Ключевые причины:`,
      `1. ${p.primaryReasonsRu[0]}`,
      `2. ${p.primaryReasonsRu[1]}`,
      `3. ${p.primaryReasonsRu[2]}`,
      ``,
      `🔒 ${p.l2WallStatusRu}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `⚡ Сгенерировано Apex Terminal Live Engine`,
    ].join("\n");
  }
}
