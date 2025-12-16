/**
 * Multi-channel logging for Minecraft bots (console, chat, file)
 *
 * @example
 * ```typescript
 * import { initializeLogging, logProgress, logSuccess } from "$lib/server/steve/abilities/log";
 *
 * initializeLogging(); // Optional: creates logs/bot-{timestamp}.log
 *
 * logProgress(bot, 1, 5, "Validating...", { console: true, chat: true });
 * logSuccess(bot, "Done!", { console: true, chat: true, file: true });
 * ```
 */

import type { Bot } from "mineflayer";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "info" | "success" | "warning" | "error" | "state";

export interface LogOptions {
  console?: boolean;
  chat?: boolean;
  file?: boolean;
}

const DEFAULT_OPTIONS: LogOptions = {
  console: true,
  chat: true,
  file: true,
};

let logFilePath: string | null = null;

/**
 * Initialize logging with a file path
 */
export function initializeLogging(filePath?: string): void {
  if (filePath) {
    logFilePath = filePath;
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    logFilePath = join(process.cwd(), `logs/bot-${timestamp}.log`);
  }
}

/**
 * Format timestamp for log entries
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Format message for console output with color/symbols
 */
function formatConsole(level: LogLevel, message: string): string {
  const symbols = {
    info: "ℹ",
    success: "✓",
    warning: "⚠",
    error: "✗",
    state: "→",
  };
  return `${symbols[level]} ${message}`;
}

/**
 * Format message for chat output (simpler, no colors)
 */
function formatChat(level: LogLevel, message: string): string {
  const prefixes = {
    info: "",
    success: "✓",
    warning: "!",
    error: "✗",
    state: "",
  };
  const prefix = prefixes[level];
  return prefix ? `${prefix} ${message}` : message;
}

/**
 * Format message for file output
 */
function formatFile(level: LogLevel, message: string): string {
  return `[${getTimestamp()}] [${level.toUpperCase()}] ${message}\n`;
}

/**
 * Core logging function
 */
export function log(
  bot: Bot | null,
  level: LogLevel,
  message: string,
  options: LogOptions = DEFAULT_OPTIONS,
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Console output
  if (opts.console) {
    console.log(formatConsole(level, message));
  }

  // Chat output
  if (opts.chat && bot) {
    try {
      bot.chat(formatChat(level, message));
    } catch (err) {
      console.error("Failed to send chat message:", err);
    }
  }

  // File output
  if (opts.file && logFilePath) {
    try {
      appendFileSync(logFilePath, formatFile(level, message));
    } catch (err) {
      console.error("Failed to write to log file:", err);
    }
  }
}

/**
 * Convenience functions for different log levels
 */
export function logInfo(
  bot: Bot | null,
  message: string,
  options?: LogOptions,
): void {
  log(bot, "info", message, options);
}

export function logSuccess(
  bot: Bot | null,
  message: string,
  options?: LogOptions,
): void {
  log(bot, "success", message, options);
}

export function logWarning(
  bot: Bot | null,
  message: string,
  options?: LogOptions,
): void {
  log(bot, "warning", message, options);
}

export function logError(
  bot: Bot | null,
  message: string,
  options?: LogOptions,
): void {
  log(bot, "error", message, options);
}

export function logState(
  bot: Bot | null,
  message: string,
  options?: LogOptions,
): void {
  log(bot, "state", message, options);
}

/**
 * Log with progress indicator (e.g., [1/5])
 */
export function logProgress(
  bot: Bot | null,
  step: number,
  total: number,
  message: string,
  options?: LogOptions,
): void {
  const progressMessage = `[${step}/${total}] ${message}`;
  log(bot, "state", progressMessage, options);
}

/**
 * Log section header
 */
export function logSection(
  bot: Bot | null,
  title: string,
  options?: LogOptions,
): void {
  const separator = "=".repeat(60);
  if (options?.console !== false) {
    console.log("\n" + separator);
    console.log(title);
    console.log(separator);
  }
  if (options?.file && logFilePath) {
    appendFileSync(
      logFilePath,
      `\n${separator}\n${title}\n${separator}\n`,
    );
  }
}

/**
 * Log key-value data
 */
export function logData(
  bot: Bot | null,
  label: string,
  data: any,
  options?: LogOptions,
): void {
  const message = `${label}: ${JSON.stringify(data)}`;
  log(bot, "info", message, { ...options, chat: false }); // Don't spam chat with data
}
