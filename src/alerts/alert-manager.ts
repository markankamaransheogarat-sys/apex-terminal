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
          }
        }
      } catch {}
    }
  }
}
