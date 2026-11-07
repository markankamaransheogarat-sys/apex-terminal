/**
 * Apex Terminal - Institutional Real-Time Alert & Notification Subsystem
 * Tracks whale execution thresholds, liquidation spikes, and funding rate anomalies,
 * and delivers browser desktop notifications and acoustic cues.
 */

export type AlertType =
  "WHALE_BLOCK" | "LIQUIDATION_SPIKE" | "FUNDING_ANOMALY" | "VAR_BREACH";

export interface SystemAlert {
  id: string;
  type: AlertType;
  title: string;
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  timestamp: number;
}

export class AlertManager {
  private static instance: AlertManager | null = null;
  private alerts: SystemAlert[] = [];
  private notificationsEnabled: boolean = false;
  private whaleThresholdUsd: number = 500_000;
  private liqThresholdUsd: number = 250_000;
  private fundingThresholdApr: number = 50.0;
  private telegramBotToken: string = "";
  private telegramChatId: string = "";
  private listeners: Array<(alert: SystemAlert) => void> = [];

  public static getInstance(): AlertManager {
    if (!this.instance) {
      this.instance = new AlertManager();
    }
    return this.instance;
  }

  constructor() {
    this.loadSettings();
  }

  public getAlerts(): SystemAlert[] {
    return [...this.alerts];
  }

  public onAlert(listener: (alert: SystemAlert) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public async requestNotificationPermission(): Promise<boolean> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      this.notificationsEnabled = permission === "granted";
      this.saveSettings();
      return this.notificationsEnabled;
    } catch {
      return false;
    }
  }

  public isNotificationsEnabled(): boolean {
    return this.notificationsEnabled;
  }

  public setTelegramConfig(botToken: string, chatId: string): void {
    this.telegramBotToken = botToken.trim();
    this.telegramChatId = chatId.trim();
    this.saveSettings();
  }

  public getTelegramConfig(): {
    botToken: string;
    chatId: string;
    isConfigured: boolean;
  } {
    return {
      botToken: this.telegramBotToken,
      chatId: this.telegramChatId,
      isConfigured: Boolean(this.telegramBotToken && this.telegramChatId),
    };
  }

  public async sendTelegramMessage(
    title: string,
    message: string,
  ): Promise<boolean> {
    if (
      !this.telegramBotToken ||
      !this.telegramChatId ||
      typeof fetch === "undefined"
    ) {
      return false;
    }
    try {
      const text = `⚡ *APEX // QUANT TERMINAL*\n*${title}*\n${message}\n_${new Date().toISOString()}_`;
      const res = await fetch(
        `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.telegramChatId,
            text,
            parse_mode: "Markdown",
          }),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  public static formatTradeSetupTicket(setup: {
    symbol: string;
    asset: string;
    direction: "LONG" | "SHORT";
    optimalEntryPrice: number;
    protectedStopLoss: number;
    stopDistancePercent: number;
    setupRationale: string;
    positionSizeCoins: number;
    positionNotionalUsd: number;
    recommendedLeverage: number;
    kellyFractionPercent: number;
    maxRiskDollarUsd: number;
    takeProfit1_15R: number;
    takeProfit2_25R: number;
    takeProfit3_Magnet: number;
    rewardToRiskRatio: number;
  }): string {
    const fmt = (p: number) =>
      p < 1
        ? `$${p.toFixed(4)}`
        : p < 10
          ? `$${p.toFixed(3)}`
          : `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return [
      `🎯 INSTITUTIONAL QUANT TICKET: ${setup.direction} ${setup.asset} (${setup.symbol})`,
      `• Entry: ${fmt(setup.optimalEntryPrice)} | Wall-Protected SL: ${fmt(setup.protectedStopLoss)} (-${setup.stopDistancePercent.toFixed(2)}%)`,
      `• Sizing: ${setup.positionSizeCoins.toFixed(4)} ${setup.asset} ($${Math.round(setup.positionNotionalUsd).toLocaleString()} @ ${setup.recommendedLeverage}x | Half-Kelly ${setup.kellyFractionPercent.toFixed(1)}%)`,
      `• Targets: TP1 (1.5R -> BE) ${fmt(setup.takeProfit1_15R)} | TP2 (2.5R) ${fmt(setup.takeProfit2_25R)} | TP3 (50x Magnet) ${fmt(setup.takeProfit3_Magnet)}`,
      `• Edge: R:R ${setup.rewardToRiskRatio.toFixed(2)}x | Max Risk $${setup.maxRiskDollarUsd.toFixed(2)}`,
      `• Shield: ${setup.setupRationale}`,
    ].join("\n");
  }

  public async dispatchTradeSetupTicket(setup: {
    symbol: string;
    asset: string;
    direction: "LONG" | "SHORT";
    optimalEntryPrice: number;
    protectedStopLoss: number;
    stopDistancePercent: number;
    setupRationale: string;
    positionSizeCoins: number;
    positionNotionalUsd: number;
    recommendedLeverage: number;
    kellyFractionPercent: number;
    maxRiskDollarUsd: number;
    takeProfit1_15R: number;
    takeProfit2_25R: number;
    takeProfit3_Magnet: number;
    rewardToRiskRatio: number;
  }): Promise<{ telegramSent: boolean; ticketText: string }> {
    const ticketText = AlertManager.formatTradeSetupTicket(setup);
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(ticketText);
      }
    } catch {}

    const telegramSent = await this.sendTelegramMessage(
      `📤 QUANT ORDER TICKET: ${setup.direction} ${setup.asset}`,
      ticketText,
    );

    this.pushAlert({
      id: `alt-tkt-${Date.now()}`,
      type: "WHALE_BLOCK",
      title: `📤 QUANT TICKET DISPATCHED (${setup.direction} ${setup.asset})`,
      message: `${ticketText.replace(/\n/g, " · ")}${telegramSent ? " [SENT TO TELEGRAM]" : " [COPIED TO CLIPBOARD]"}`,
      severity: "INFO",
      timestamp: Date.now(),
    });

    return { telegramSent, ticketText };
  }

  public checkWhaleTrade(trade: {
    asset: string;
    side: string;
    valueUsd: number;
    price: number;
  }): void {
    if (trade.valueUsd >= this.whaleThresholdUsd) {
      const isMega = trade.valueUsd >= 1_000_000;
      this.pushAlert({
        id: `alt-wh-${Date.now()}`,
        type: "WHALE_BLOCK",
        title: isMega
          ? "🐋 KRAKEN EXECUTION DETECTED"
          : "🐋 INSTITUTIONAL WHALE BLOCK",
        message: `${trade.side} ${trade.asset} $${Math.round(trade.valueUsd).toLocaleString()} @ $${trade.price.toLocaleString()}`,
        severity: isMega ? "CRITICAL" : "WARNING",
        timestamp: Date.now(),
      });
    }
  }

  public checkLiquidation(liq: {
    asset: string;
    side: string;
    valueUsd: number;
    price: number;
  }): void {
    if (liq.valueUsd >= this.liqThresholdUsd) {
      const isMega = liq.valueUsd >= 1_000_000;
      this.pushAlert({
        id: `alt-lq-${Date.now()}`,
        type: "LIQUIDATION_SPIKE",
        title: "⚡ CASUALTY ALERT: LARGE LIQUIDATION",
        message: `${liq.side} REKT: $${Math.round(liq.valueUsd).toLocaleString()} of ${liq.asset} liquidated @ $${liq.price.toLocaleString()}`,
        severity: isMega ? "CRITICAL" : "WARNING",
        timestamp: Date.now(),
      });
    }
  }

  public checkFundingRate(funding: {
    symbol: string;
    annualizedAPR: number;
    fundingRate: number;
  }): void {
    if (Math.abs(funding.annualizedAPR) >= this.fundingThresholdApr) {
      this.pushAlert({
        id: `alt-fd-${funding.symbol}-${Date.now()}`,
        type: "FUNDING_ANOMALY",
        title: "🔥 FUNDING RATE SQUEEZE REGIME",
        message: `${funding.symbol} 8h Funding Rate at ${(funding.fundingRate * 100).toFixed(4)}% (${funding.annualizedAPR >= 0 ? "+" : ""}${funding.annualizedAPR.toFixed(1)}% APR)`,
        severity: "WARNING",
        timestamp: Date.now(),
      });
    }
  }

  private pushAlert(alert: SystemAlert): void {
    this.alerts.unshift(alert);
    if (this.alerts.length > 50) this.alerts.pop();

    // Trigger browser notification if enabled
    if (
      this.notificationsEnabled &&
      typeof window !== "undefined" &&
      "Notification" in window
    ) {
      if (Notification.permission === "granted") {
        try {
          new Notification(alert.title, {
            body: alert.message,
            icon: "./icon.svg",
          });
        } catch {}
      }
    }

    // Forward CRITICAL alerts to Telegram Quant Bridge if configured
    if (
      alert.severity === "CRITICAL" &&
      this.telegramBotToken &&
      this.telegramChatId
    ) {
      this.sendTelegramMessage(alert.title, alert.message).catch(() => {});
    }

    // Notify in-app subscribers
    this.listeners.forEach((fn) => {
      try {
        fn(alert);
      } catch {}
    });
  }

  public clearAlerts(): void {
    this.alerts = [];
  }

  private saveSettings(): void {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(
          "apex_alert_settings",
          JSON.stringify({
            notificationsEnabled: this.notificationsEnabled,
            whaleThresholdUsd: this.whaleThresholdUsd,
            liqThresholdUsd: this.liqThresholdUsd,
            fundingThresholdApr: this.fundingThresholdApr,
            telegramBotToken: this.telegramBotToken,
            telegramChatId: this.telegramChatId,
          }),
        );
      } catch {}
    }
  }

  private loadSettings(): void {
    if (typeof localStorage !== "undefined") {
      try {
        const item = localStorage.getItem("apex_alert_settings");
        if (item) {
          const parsed = JSON.parse(item);
          if (parsed) {
            this.notificationsEnabled = !!parsed.notificationsEnabled;
            if (parsed.whaleThresholdUsd)
              this.whaleThresholdUsd = parsed.whaleThresholdUsd;
            if (parsed.liqThresholdUsd)
              this.liqThresholdUsd = parsed.liqThresholdUsd;
            if (parsed.fundingThresholdApr)
              this.fundingThresholdApr = parsed.fundingThresholdApr;
            if (parsed.telegramBotToken)
              this.telegramBotToken = String(parsed.telegramBotToken);
            if (parsed.telegramChatId)
              this.telegramChatId = String(parsed.telegramChatId);
          }
        }
      } catch {}
    }
  }
}
