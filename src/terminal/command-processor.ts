/**
 * Bloomberg Terminal Command Processor & Autocomplete Engine
 * Parses institutional commands with <GO> semantics, provides intelligent autocomplete,
 * handles keyboard hotkeys, and executes analytical queries.
 */

import {
  ParsedTerminalCommand,
  TerminalCommandType,
  AutocompleteItem,
} from "../types/index.js";

export class TerminalCommandProcessor {
  public static readonly VALID_GLOBAL_COMMANDS: Record<
    string,
    TerminalCommandType
  > = {
    RISK: "RISK_MATRIX",
    FUND: "FUNDING_HEATMAP",
    NEWS: "NEWS_SENTIMENT",
    PORT: "PORTFOLIO_VIEW",
    HELP: "HELP_VIEW",
    STRESS: "STRESS_VIEW",
    CLEAR: "CLEAR_SCREEN",
    CLS: "CLEAR_SCREEN",
    QUIT: "QUIT",
    EXIT: "QUIT",
  };

  public static readonly KNOWN_TICKERS = [
    "BTC",
    "ETH",
    "SOL",
    "BNB",
    "XRP",
    "DOGE",
    "TON",
    "AVAX",
    "SUI",
    "PEPE",
    "ADA",
    "LINK",
    "DOT",
    "NEAR",
    "APT",
  ];

  public static readonly AUTOCOMPLETE_CATALOG: AutocompleteItem[] = [
    {
      token: "BTC <GO>",
      description: "Bitcoin spot & perp market quotes, 24h stats",
      category: "TICKER",
      previewTemplate: "BTC <GO>",
    },
    {
      token: "ETH <GO>",
      description: "Ethereum market quotes & liquidity overview",
      category: "TICKER",
      previewTemplate: "ETH <GO>",
    },
    {
      token: "SOL <GO>",
      description: "Solana real-time price & volume breakdown",
      category: "TICKER",
      previewTemplate: "SOL <GO>",
    },
    {
      token: "BNB <GO>",
      description: "BNB Chain primary asset overview",
      category: "TICKER",
      previewTemplate: "BNB <GO>",
    },
    {
      token: "XRP <GO>",
      description: "XRP market quote & 24hr volume",
      category: "TICKER",
      previewTemplate: "XRP <GO>",
    },
    {
      token: "DOGE <GO>",
      description: "Dogecoin liquidity & high/low telemetry",
      category: "TICKER",
      previewTemplate: "DOGE <GO>",
    },
    {
      token: "TON <GO>",
      description: "Toncoin real-time terminal monitor",
      category: "TICKER",
      previewTemplate: "TON <GO>",
    },
    {
      token: "AVAX <GO>",
      description: "Avalanche market telemetry & 24hr depth",
      category: "TICKER",
      previewTemplate: "AVAX <GO>",
    },
    {
      token: "SUI <GO>",
      description: "Sui network asset pricing and stats",
      category: "TICKER",
      previewTemplate: "SUI <GO>",
    },
    {
      token: "PEPE <GO>",
      description: "Pepe high-beta meme token quotes",
      category: "TICKER",
      previewTemplate: "PEPE <GO>",
    },
    {
      token: "RISK <GO>",
      description: "BlackRock Aladdin Parametric VaR, Beta & Diversification",
      category: "COMMAND",
      previewTemplate: "RISK <GO>",
    },
    {
      token: "FUND <GO>",
      description: "Binance Futures Funding Rate Heatmap & Squeeze Radar",
      category: "COMMAND",
      previewTemplate: "FUND <GO>",
    },
    {
      token: "NEWS <GO>",
      description: "Alternative.me Fear & Greed Index & Global Sentiment",
      category: "COMMAND",
      previewTemplate: "NEWS <GO>",
    },
    {
      token: "PORT <GO>",
      description: "Institutional Portfolio holdings, margin & leverage",
      category: "COMMAND",
      previewTemplate: "PORT <GO>",
    },
    {
      token: "HELP <GO>",
      description: "Terminal manual, grammar syntax & keyboard shortcuts",
      category: "COMMAND",
      previewTemplate: "HELP <GO>",
    },
    {
      token: "STRESS <GO>",
      description: "Run multi-scenario stress test (BTC -20%, Black Swan)",
      category: "COMMAND",
      previewTemplate: "STRESS <GO>",
    },
    {
      token: "CLEAR <GO>",
      description: "Clear terminal screen buffer",
      category: "COMMAND",
      previewTemplate: "CLEAR <GO>",
    },
    {
      token: "EXIT <GO>",
      description: "Terminate terminal session",
      category: "COMMAND",
      previewTemplate: "EXIT <GO>",
    },
  ];

  private history: string[] = [];
  private historyIndex = -1;

  /**
   * Parse a raw user input command line into a structured ParsedTerminalCommand.
   */
  public parse(input: string): ParsedTerminalCommand {
    const raw = input.trim();
    if (!raw) {
      return {
        raw,
        commandType: "UNKNOWN",
        args: [],
        hasGoToken: false,
        isValid: false,
        errorMessage: "Empty command buffer",
      };
    }

    // Check for <GO> token (case-insensitive)
    const goRegex = /<go>$/i;
    const hasExplicitGo = goRegex.test(raw);
    const cleaned = raw.replace(goRegex, "").trim();

    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return {
        raw,
        commandType: "UNKNOWN",
        args: [],
        hasGoToken: hasExplicitGo,
        isValid: false,
        errorMessage: "Missing command target",
      };
    }

    const firstToken = parts[0]!.toUpperCase();
    const secondToken = parts[1] ? parts[1]!.toUpperCase() : undefined;
    const remainingArgs = parts.slice(2);

    // 1. Check Global Commands (e.g. RISK, FUND, NEWS, PORT, HELP, STRESS)
    if (firstToken in TerminalCommandProcessor.VALID_GLOBAL_COMMANDS) {
      const type = TerminalCommandProcessor.VALID_GLOBAL_COMMANDS[firstToken]!;
      return {
        raw,
        commandType: type,
        subCommand: secondToken,
        args: parts.slice(1),
        hasGoToken: hasExplicitGo,
        isValid: true,
      };
    }

    // 2. Check Ticker commands: e.g. BTC <GO>, ETH <GO>, SOL DES <GO>, BTC RISK <GO>
    const isTicker =
      TerminalCommandProcessor.KNOWN_TICKERS.includes(firstToken) ||
      firstToken.endsWith("USDT") ||
      firstToken.length <= 6;

    if (isTicker) {
      // Determine subcommand (e.g. DES, RISK, FUND)
      if (secondToken === "RISK") {
        return {
          raw,
          commandType: "RISK_MATRIX",
          ticker: firstToken,
          subCommand: secondToken,
          args: remainingArgs,
          hasGoToken: hasExplicitGo,
          isValid: true,
        };
      } else if (secondToken === "FUND") {
        return {
          raw,
          commandType: "FUNDING_HEATMAP",
          ticker: firstToken,
          subCommand: secondToken,
          args: remainingArgs,
          hasGoToken: hasExplicitGo,
          isValid: true,
        };
      }

      return {
        raw,
        commandType: "TICKER_VIEW",
        ticker: firstToken,
        subCommand: secondToken ?? "DES",
        args: remainingArgs,
        hasGoToken: hasExplicitGo,
        isValid: true,
      };
    }

    return {
      raw,
      commandType: "UNKNOWN",
      args: parts,
      hasGoToken: hasExplicitGo,
      isValid: false,
      errorMessage: `Unrecognized command or ticker: "${firstToken}". Type HELP <GO> for index.`,
    };
  }

  /**
   * Autocomplete engine with prefix & substring match
   */
  public autocomplete(prefix: string): AutocompleteItem[] {
    const query = prefix.trim().toUpperCase().replace(/<GO>/gi, "").trim();
    if (!query) {
      return [...TerminalCommandProcessor.AUTOCOMPLETE_CATALOG];
    }

    const exactPrefixMatches: AutocompleteItem[] = [];
    const containsMatches: AutocompleteItem[] = [];

    for (const item of TerminalCommandProcessor.AUTOCOMPLETE_CATALOG) {
      const tokenUpper = item.token.toUpperCase();
      if (tokenUpper.startsWith(query)) {
        exactPrefixMatches.push(item);
      } else if (
        tokenUpper.includes(query) ||
        item.description.toUpperCase().includes(query)
      ) {
        containsMatches.push(item);
      }
    }

    return [...exactPrefixMatches, ...containsMatches];
  }

  /**
   * Handle Terminal Hotkey (e.g. F1-F8, Esc)
   */
  public handleHotkey(keyName: string): ParsedTerminalCommand | null {
    const key = keyName.toUpperCase();
    switch (key) {
      case "F1":
        return this.parse("HELP <GO>");
      case "F2":
        return this.parse("BTC <GO>");
      case "F3":
        return this.parse("RISK <GO>");
      case "F4":
        return this.parse("FUND <GO>");
      case "F5":
        return this.parse("NEWS <GO>");
      case "F8":
        return this.parse("PORT <GO>");
      default:
        return null;
    }
  }

  /**
   * Push executed line to command history
   */
  public pushHistory(line: string): void {
    const trimmed = line.trim();
    if (trimmed && this.history[this.history.length - 1] !== trimmed) {
      this.history.push(trimmed);
    }
    this.historyIndex = this.history.length;
  }

  public historyPrevious(): string | null {
    if (this.history.length === 0) return null;
    if (this.historyIndex > 0) {
      this.historyIndex--;
      return this.history[this.historyIndex] ?? null;
    }
    return this.history[0] ?? null;
  }

  public historyNext(): string | null {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      return this.history[this.historyIndex] ?? null;
    }
    this.historyIndex = this.history.length;
    return "";
  }
}
