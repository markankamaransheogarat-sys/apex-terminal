#!/usr/bin/env node

/**
 * Interactive Bloomberg Apex Terminal CLI
 * REPL with <GO> command syntax, Tab autocomplete, and terminal hotkeys.
 */

import readline from "node:readline";
import { ApexTerminalApp } from "../dist/index.js";

const app = new ApexTerminalApp();
await app.start();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "\x1b[38;5;214mAPEX>\x1b[0m ",
  completer: (line) => {
    const hits = app.commandProcessor.autocomplete(line);
    const completions = hits.map((h) => h.token);
    return [completions, line];
  },
});

console.clear();
console.log(await app.executeCommand("HELP <GO>"));
rl.prompt();

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    rl.prompt();
    return;
  }

  if (
    trimmed.toUpperCase() === "EXIT" ||
    trimmed.toUpperCase() === "QUIT" ||
    trimmed.toUpperCase() === "EXIT <GO>"
  ) {
    console.log("\n\x1b[38;5;214mSession terminated. Goodbye.\x1b[0m");
    app.stop();
    process.exit(0);
  }

  try {
    const output = await app.executeCommand(trimmed);
    console.log(output);
  } catch (err) {
    console.error("\x1b[31mTerminal error:\x1b[0m", err);
  }
  rl.prompt();
});

rl.on("close", () => {
  app.stop();
  process.exit(0);
});
