/**
 * Steve - Ender Dragon Speedrun Bot
 *
 * This bot autonomously plays Minecraft from spawn to killing the Ender Dragon.
 * It uses a priority-based state machine to determine what to do next.
 */

import { createBot as createMcBot, ping } from "typecraft";
import type { Bot } from "typecraft";

import { getPhase, isDragonDead, syncFromBot } from "./state.ts";
import { getNextStep, getProgress, type Step } from "./steps.ts";
import { initLogger, startTickLogger, stopLogger, logEvent } from "./lib/logger.ts";

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  host: "localhost",
  port: 25565,
  username: "Steve",
  tickInterval: 5000, // Check state every 5 seconds
};

// ============================================
// LOGGING
// ============================================

const log = (message: string) => {
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`[${timestamp}] ${message}`);
};

const logPhase = (
  phase: string,
  step: Step | null,
  progress: { completed: number; total: number; percent: number },
) => {
  const stepInfo = step ? `→ ${step.name}` : "→ (no available step)";
  console.log("");
  console.log("═".repeat(60));
  console.log(`  [${phase}] ${stepInfo}`);
  console.log(
    `  Progress: ${progress.completed}/${progress.total} steps (${progress.percent}%)`,
  );
  console.log("═".repeat(60));
};

// ============================================
// MAIN ORCHESTRATOR
// ============================================

let currentStep: Step | null = null;
let isExecuting = false;

const runTick = async (bot: Bot): Promise<void> => {
  // Don't start new task if one is running
  if (isExecuting) {
    return;
  }

  // Sync state from bot
  const state = syncFromBot(bot);

  // Check victory condition
  if (isDragonDead(state)) {
    log("🎉 VICTORY! The Ender Dragon has been defeated!");
    log("Steve's journey is complete.");
    bot.chat("I have slain the Ender Dragon!");
    return;
  }

  // Get current phase and progress
  const phase = getPhase(state);
  const progress = getProgress(state);

  // Determine next step
  const nextStep = getNextStep(state);

  // Log if step changed
  if (nextStep?.id !== currentStep?.id) {
    currentStep = nextStep;
    logPhase(phase, currentStep, progress);
  }

  // Execute step if available
  if (currentStep && !isExecuting) {
    isExecuting = true;
    log(`Starting: ${currentStep.name}`);
    logEvent("step", "start", currentStep.name, bot.entity?.position);

    try {
      const result = await currentStep.execute(bot, state);

      if (result.success) {
        log(`✓ ${result.message}`);
        logEvent("step", "success", `${currentStep.name}: ${result.message}`, bot.entity?.position);
      } else {
        log(`✗ ${result.message}`);
        logEvent("step", "fail", `${currentStep.name}: ${result.message}`, bot.entity?.position);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`FATAL: ${msg}`);
      logEvent("step", "fatal", msg, bot.entity?.position);
      if (err instanceof Error) console.error(err.stack);
      process.exit(1);
    }

    isExecuting = false;

    // Immediately check for next step after completion
    // State may have changed during execution
    const newState = syncFromBot(bot);
    const newStep = getNextStep(newState);

    if (newStep?.id !== currentStep?.id) {
      currentStep = newStep;
      const newPhase = getPhase(newState);
      const newProgress = getProgress(newState);
      logPhase(newPhase, currentStep, newProgress);
    }
  }
};

// ============================================
// BOT INITIALIZATION
// ============================================

const createBot = async (): Promise<Bot> => {
  log("Creating bot...");

  // Ping server to get exact version
  const info = await ping({ host: CONFIG.host, port: CONFIG.port });
  log(`Server version: ${info.version.name} (protocol ${info.version.protocol})`);

  const bot = createMcBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: info.version.name,
    auth: "offline",
  });

  return bot;
};

const startBot = async (): Promise<void> => {
  const bot = await createBot();

  bot.once("spawn", async () => {
    log("Steve spawned into the world");
    logEvent("lifecycle", "spawn", `pos=${Math.floor(bot.entity.position.x)},${Math.floor(bot.entity.position.y)},${Math.floor(bot.entity.position.z)}`, bot.entity.position);

    // Start SQLite tick logger
    startTickLogger(bot);

    // Wait for chunks to load before doing anything
    await bot.waitForChunksToLoad();
    log("Chunks loaded");
    logEvent("lifecycle", "chunks_loaded");

    log(
      `Position: ${Math.floor(bot.entity.position.x)}, ${
        Math.floor(bot.entity.position.y)
      }, ${Math.floor(bot.entity.position.z)}`,
    );

    // Initial state sync
    const state = syncFromBot(bot);
    const phase = getPhase(state);
    const progress = getProgress(state);
    const step = getNextStep(state);

    logPhase(phase, step, progress);

    // Start tick loop
    log(`Starting tick loop (every ${CONFIG.tickInterval / 1000}s)`);

    setInterval(() => {
      runTick(bot).catch((err) => {
        log(`Tick error: ${err instanceof Error ? err.message : "unknown"}`);
      });
    }, CONFIG.tickInterval);

    // Run first tick immediately
    runTick(bot).catch((err) => {
      log(
        `Initial tick error: ${err instanceof Error ? err.message : "unknown"}`,
      );
    });
  });

  bot.on("death", () => {
    log("Steve died! Respawning...");
    logEvent("lifecycle", "death", undefined, bot.entity?.position);
    isExecuting = false;
    currentStep = null;
  });

  bot.on("health", () => {
    if (bot.health < 5) {
      log(`⚠ Low health: ${bot.health}/20`);
      logEvent("health", "low_health", `${bot.health}/20`, bot.entity?.position);
    }
  });

  bot.on("end", () => {
    log("Steve disconnected");
    logEvent("lifecycle", "disconnected");
    stopLogger();
  });

  bot.on("kicked", (reason) => {
    log(`Kicked: ${reason}`);
    logEvent("lifecycle", "kicked", reason);
    stopLogger();
  });

  bot.on("error", (err) => {
    log(`Bot error: ${err.message}`);
    logEvent("error", "bot_error", err.message);
  });
};

// ============================================
// START
// ============================================

console.log("");
console.log("╔════════════════════════════════════════════════════════╗");
console.log("║          STEVE - Ender Dragon Speedrun Bot             ║");
console.log("║                                                        ║");
console.log("║  Goal: Beat Minecraft from spawn to Ender Dragon      ║");
console.log("║  Method: Pure autonomous gameplay, no human input     ║");
console.log("╚════════════════════════════════════════════════════════╝");
console.log("");

initLogger();

startBot();
