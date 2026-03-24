/**
 * Steve - Ender Dragon Speedrun Bot
 *
 * Usage:
 *   node src/main.ts           Run 1 bot (default)
 *   node src/main.ts 5         Run 5 bots racing
 *   node src/main.ts 5 180     Run 5 bots, 180s timeout
 *
 * When run as a child (STEVE_BOT_MODE=1), acts as a single bot instance.
 * Otherwise, acts as the orchestrator that spawns bot child processes.
 */

import { createBot as createMcBot, createWebViewer, createDashboard, addBotToDashboard } from "typecraft";
import type { Bot } from "typecraft";

import { getPhase, isDragonDead, syncFromBot } from "./state.ts";
import { getNextStep, getProgress, steps, type Step } from "./steps.ts";
import { initLogger, startTickLogger, stopLogger, logEvent } from "./lib/logger.ts";

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  host: process.env.MC_HOST ?? "localhost",
  port: parseInt(process.env.MC_PORT ?? "25565"),
  username: process.env.MC_USERNAME ?? "Steve",
  tickInterval: 5000,
};

// ============================================
// LOGGING
// ============================================

const log = (message: string) => {
  const timestamp = new Date().toISOString().split("T")[1]!.split(".")[0];
  console.log(`[${timestamp}] ${message}`);
};

const logPhase = (
  phase: string,
  step: Step | null,
  progress: { completed: number; total: number; percent: number },
) => {
  const stepInfo = step ? `→ ${step.name}` : "→ (no available step)";
  log(`[${phase}] ${stepInfo} (${progress.completed}/${progress.total})`);
};

// ============================================
// SINGLE BOT LOGIC
// ============================================

let currentStep: Step | null = null;
let isExecuting = false;
let consecutiveFailures = 0;
const completedSteps = new Set<string>();
const succeededSteps = new Set<string>(); // steps that returned success — never remove

const runTick = async (bot: Bot): Promise<void> => {
  if (isExecuting) return;

  const state = syncFromBot(bot);

  if (isDragonDead(state)) {
    log("VICTORY! The Ender Dragon has been defeated!");
    bot.chat("I have slain the Ender Dragon!");
    return;
  }

  // Sync completedSteps with actual state — add newly complete, remove regressed
  // BUT never remove steps that explicitly returned success
  for (const step of steps) {
    if (step.isComplete(state)) {
      completedSteps.add(step.id);
    } else if (completedSteps.has(step.id) && !succeededSteps.has(step.id)) {
      completedSteps.delete(step.id);
    }
  }

  const phase = getPhase(state);
  const progress = getProgress(state);
  const nextStep = getNextStep(state, completedSteps);

  if (nextStep?.id !== currentStep?.id) {
    currentStep = nextStep;
    logPhase(phase, currentStep, progress);
  }

  if (currentStep && !isExecuting) {
    isExecuting = true;
    log(`Starting: ${currentStep.name}`);
    logEvent("step", "start", currentStep.name, bot.entity?.position);

    try {
      // Timeout step execution at 120s to prevent hangs
      const timeout = new Promise<{ success: false; message: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, message: `${currentStep!.name} timed out (120s)` }), 120000),
      );
      const result = await Promise.race([currentStep.execute(bot, state), timeout]);

      // Close any stuck windows
      if (bot.currentWindow) {
        try { bot.closeWindow(bot.currentWindow); } catch {}
      }

      if (result.success) {
        consecutiveFailures = 0;
        log(`✓ ${result.message}`);
        logEvent("step", "success", `${currentStep.name}: ${result.message}`, bot.entity?.position);
        completedSteps.add(currentStep.id);
        succeededSteps.add(currentStep.id);
      } else {
        consecutiveFailures++;
        log(`✗ ${result.message} (fail #${consecutiveFailures})`);
        logEvent("step", "fail", `${currentStep.name}: ${result.message}`, bot.entity?.position);
        if (consecutiveFailures >= 5) {
          log(`ABORT: ${consecutiveFailures} consecutive failures on ${currentStep.name}`);
          logEvent("step", "abort", `${currentStep.name}: ${consecutiveFailures} failures`, bot.entity?.position);
          process.exit(1);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${msg}`);
      logEvent("step", "error", `${currentStep.name}: ${msg}`, bot.entity?.position);
      consecutiveFailures++;
      // Close any stuck windows
      if (bot.currentWindow) {
        try { bot.closeWindow(bot.currentWindow); } catch {}
      }
    }

    isExecuting = false;

    // Re-check completed steps after execution
    const newState = syncFromBot(bot);
    for (const step of steps) {
      if (step.isComplete(newState)) {
        completedSteps.add(step.id);
      } else if (completedSteps.has(step.id) && !succeededSteps.has(step.id)) {
        completedSteps.delete(step.id);
      }
    }

    const newStep = getNextStep(newState, completedSteps);

    if (newStep?.id !== currentStep?.id) {
      currentStep = newStep;
      const newPhase = getPhase(newState);
      const newProgress = getProgress(newState);
      logPhase(newPhase, currentStep, newProgress);
    }
  }
};

const startBot = async (): Promise<void> => {
  // Bot lifetime timeout — exit cleanly if we've been running too long
  const lifetimeMs = parseInt(process.env.STEVE_TIMEOUT ?? "120") * 1000;
  setTimeout(() => {
    log(`Lifetime timeout (${lifetimeMs / 1000}s) — exiting`);
    logEvent("lifecycle", "timeout", `${lifetimeMs / 1000}s`);
    process.exit(0);
  }, lifetimeMs);

  log("Creating bot...");
  const version = process.env.MC_VERSION ?? "1.21.11";
  log(`Connecting to ${CONFIG.host}:${CONFIG.port} (version ${version})`);

  const bot = createMcBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version,
    auth: "offline",
  });

  bot.on("debug", (category: string, detail: Record<string, unknown>) => {
    if (category === "packet_rx" || category === "packet_tx") return; // too noisy for SQLite
    logEvent(category, "debug", JSON.stringify(detail), bot.entity?.position);
  });

  bot.once("spawn", async () => {
    log("Spawned into the world");
    logEvent("lifecycle", "spawn", `pos=${Math.floor(bot.entity.position.x)},${Math.floor(bot.entity.position.y)},${Math.floor(bot.entity.position.z)}`, bot.entity.position);


    startTickLogger(bot);

    await bot.waitForChunksToLoad();
    log("Chunks loaded");
    logEvent("lifecycle", "chunks_loaded");

    log(`Position: ${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`);

    const state = syncFromBot(bot);
    logPhase(getPhase(state), getNextStep(state), getProgress(state));

    log(`Starting tick loop (every ${CONFIG.tickInterval / 1000}s)`);
    setInterval(() => {
      runTick(bot).catch((err) => {
        log(`Tick error: ${err instanceof Error ? err.message : "unknown"}`);
      });
    }, CONFIG.tickInterval);

    runTick(bot).catch((err) => {
      log(`Initial tick error: ${err instanceof Error ? err.message : "unknown"}`);
    });
  });

  bot.on("death", () => {
    log("Died! Respawning...");
    logEvent("lifecycle", "death", undefined, bot.entity?.position);
    isExecuting = false;
    currentStep = null;
    completedSteps.clear();
    succeededSteps.clear();
  });

  bot.on("health", () => {
    if (bot.health < 5) {
      log(`Low health: ${bot.health}/20`);
      logEvent("health", "low_health", `${bot.health}/20`, bot.entity?.position);
    }
  });

  bot.on("end", () => {
    log("Disconnected");
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
// MULTI-BOT ORCHESTRATOR
// ============================================

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

interface InstanceResult {
  idx: number;
  username: string;
  elapsed: number;
  won: boolean;
  inventory: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const runRace = async (count: number, timeoutMs: number) => {
  const ROOT = process.cwd();
  const SERVER_PORT = parseInt(process.env.MC_PORT ?? "25565");
  const RCON_PORT = parseInt(process.env.MC_RCON_PORT ?? "25575");
  const RCON_PASS = process.env.MC_RCON_PASS ?? "minecraft-test-rcon";
  const SPREAD_RADIUS = 50;

  const RACE_ID = new Date().toISOString().replace(/:/g, "-");
  const RACE_DIR = join(ROOT, "data", "races", RACE_ID);
  const RACE_DB = join(RACE_DIR, "race.db");
  mkdirSync(RACE_DIR, { recursive: true });

  const allProcs: ChildProcess[] = [];
  let winner: number | null = null;
  let raceDb: Database.Database | null = null;

  const viewerBots: Bot[] = [];
  const killAll = async () => {
    // Send SIGTERM first so bots disconnect gracefully
    for (const p of allProcs) p.kill("SIGTERM");
    for (const v of viewerBots) { try { v.end(); } catch {} }
    // Give bots time to disconnect before force-killing
    await sleep(500);
    for (const p of allProcs) { try { p.kill("SIGKILL"); } catch {} }
    if (raceDb) { raceDb.close(); raceDb = null; }
  };
  process.on("SIGINT", () => { killAll().then(() => process.exit(0)); });
  process.on("SIGTERM", () => { killAll().then(() => process.exit(0)); });
  const { connect: rconConnect } = await import("./lib/rcon.ts");
  const rconClient = await rconConnect({ port: RCON_PORT, password: RCON_PASS });
  const rcon = (cmd: string) => rconClient.command(cmd);
  process.on("exit", () => { try { rconClient.close(); } catch {} });

  const getRaceDb = (): Database.Database | null => {
    if (raceDb) return raceDb;
    if (!existsSync(RACE_DB)) return null;
    try {
      raceDb = new Database(RACE_DB);
      raceDb.pragma("journal_mode = WAL");
      raceDb.pragma("busy_timeout = 5000");
      return raceDb;
    } catch {
      return null;
    }
  };

  const GOAL = "furnace";

  const MILESTONES = [
    { name: "wood", query: "item_name LIKE '%_log'" },
    { name: "wooden pickaxe", query: "item_name = 'wooden_pickaxe'" },
    { name: "stone pickaxe", query: "item_name = 'stone_pickaxe'" },
    { name: "furnace", query: "item_name = 'furnace'" },
  ];
  const milestonesHit = new Set<string>();
  const raceStart = Date.now();

  const checkMilestones = (): void => {
    const db = getRaceDb();
    if (!db) return;
    for (const m of MILESTONES) {
      if (milestonesHit.has(m.name)) continue;
      try {
        const row = db.prepare(`SELECT bot_id FROM inventory_snapshots WHERE ${m.query} LIMIT 1`).get() as { bot_id: string } | undefined;
        if (row) {
          milestonesHit.add(m.name);
          const elapsed = Math.round((Date.now() - raceStart) / 1000);
          console.log(`  ${elapsed}s  ${row.bot_id} → ${m.name}`);
        }
      } catch {}
    }
  };

  const checkForGoal = (botId: string): boolean => {
    const db = getRaceDb();
    if (!db) return false;
    try {
      const inv = db.prepare("SELECT COUNT(*) as c FROM inventory_snapshots WHERE bot_id = ? AND item_name LIKE ?").get(botId, `%${GOAL}%`) as { c: number };
      if (inv.c > 0) return true;
      const evt = db.prepare("SELECT COUNT(*) as c FROM events WHERE bot_id = ? AND detail LIKE ?").get(botId, `%${GOAL}%`) as { c: number };
      return evt.c > 0;
    } catch {
      return false;
    }
  };

  const getInventory = (botId: string): string => {
    const db = getRaceDb();
    if (!db) return "no data";
    try {
      const rows = db.prepare("SELECT item_name || 'x' || MAX(count) as inv FROM inventory_snapshots WHERE bot_id = ? GROUP BY item_name ORDER BY MAX(count) DESC LIMIT 5").all(botId) as { inv: string }[];
      return rows.map((r) => r.inv).join(", ") || "empty";
    } catch {
      return "db error";
    }
  };

  const runBot = async (idx: number): Promise<InstanceResult> => {
    const username = `Steve${idx}`;

    const angle = (idx / count) * 2 * Math.PI;
    const spawnX = Math.floor(Math.cos(angle) * SPREAD_RADIUS);
    const spawnZ = Math.floor(Math.sin(angle) * SPREAD_RADIUS);

    await sleep(idx * 1000);

    const steveProc = spawn(process.execPath, [join(ROOT, "src/main.ts")], {
      cwd: ROOT,
      env: {
        ...process.env,
        MC_PORT: String(SERVER_PORT),
        MC_USERNAME: username,
        STEVE_DATA_DIR: RACE_DIR,
        STEVE_DB_PATH: RACE_DB,
        STEVE_BOT_MODE: "1",
        STEVE_TIMEOUT: String(timeoutMs / 1000),
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    allProcs.push(steveProc);

    // Resolve when bot exits or timeout
    let botExited = false;
    steveProc.on("exit", () => { botExited = true; });

    await sleep(3000);
    await rcon(`spreadplayers ${spawnX} ${spawnZ} 0 5 false ${username}`);

    const start = Date.now();

    while (Date.now() - start < timeoutMs && winner === null && !botExited) {
      await sleep(3000);
      checkMilestones();
      if (checkForGoal(username)) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        winner = idx;
        console.log(`\n${username} WINS — ${GOAL} in ${elapsed}s (db: ${RACE_DB})\n`);
        await rcon(`title ${username} title {"text":"WINNER!","color":"gold"}`);
        await sleep(10000);
        await killAll();
        return { idx, username, elapsed, won: true, inventory: GOAL };
      }
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    if (!botExited) steveProc.kill("SIGKILL");
    if (winner !== null && winner !== idx) {
      return { idx, username, elapsed, won: false, inventory: getInventory(username) };
    }
    return { idx, username, elapsed, won: false, inventory: getInventory(username) };
  };

  console.log(`Run ${RACE_ID} — ${count} bot${count > 1 ? "s" : ""} (timeout=${timeoutMs / 1000}s)\n`);

  // Op all bot usernames
  for (let i = 0; i < count; i++) {
    await rcon(`op Steve${i}`);
  }
  await sleep(1000);

  // Dashboard — single WebGL context, grid of camera bots with periodic tp
  const dashboard = createDashboard({ port: 3000, viewDistance: 4 });
  const NUM_VIEWERS = Math.min(count, 4);
  for (let i = 0; i < NUM_VIEWERS; i++) {
    const viewerName = `Cam${i}`;
    await rcon(`op ${viewerName}`);
    const viewer = createMcBot({
      host: "localhost",
      port: SERVER_PORT,
      username: viewerName,
      version: process.env.MC_VERSION ?? "1.21.11",
      auth: "offline",
    });
    viewer.on("error", () => {});
    viewer.once("spawn", async () => {
      await viewer.waitForChunksToLoad();
      addBotToDashboard(dashboard, viewer, `Steve${i}`);
      await rcon(`gamemode spectator ${viewerName}`);
      const doTp = async () => { try { await rcon(`tp ${viewerName} Steve${i}`); } catch {} };
      await doTp();
      const tpInterval = setInterval(doTp, 500);
      viewer.once("end", () => clearInterval(tpInterval));
    });
    viewerBots.push(viewer);
    await sleep(500);
  }

  const results = await Promise.all(
    Array.from({ length: count }, (_, i) => runBot(i))
  );

  console.log(`\n${"─".repeat(70)}`);
  console.log(`Run ${RACE_ID}`);
  console.log(`${"─".repeat(70)}`);
  console.log(`${"#".padEnd(4)} ${"bot".padEnd(10)} ${"time".padEnd(8)} ${"result".padEnd(10)} inventory`);
  console.log(`${"─".repeat(70)}`);
  const hasWinner = results.some((r) => r.won);
  for (const r of results) {
    const status = r.won ? GOAL.toUpperCase() : hasWinner ? "racing" : "timeout";
    console.log(`${String(r.idx).padEnd(4)} ${r.username.padEnd(10)} ${(r.elapsed + "s").padEnd(8)} ${status.padEnd(10)} ${r.inventory}`);
  }
  console.log(`${"─".repeat(70)}`);

  const winners = results.filter((r) => r.won);
  if (winners.length > 0) {
    console.log(`${winners.length}/${count} ${GOAL} — fastest: ${Math.min(...winners.map((r) => r.elapsed))}s`);
  } else {
    console.log(`0/${count} got ${GOAL}`);
  }
  process.exit(0);
};

// ============================================
// START
// ============================================

const isBotMode = process.env.STEVE_BOT_MODE === "1";

if (isBotMode) {
  // Child bot process — run single bot directly
  initLogger(process.env.STEVE_DB_PATH);
  startBot();
} else {
  // Orchestrator — parse args, spawn bot(s)
  const count = parseInt(process.argv[2] ?? "20");
  const timeout = parseInt(process.argv[3] ?? "240") * 1000;

  console.log("");
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║          STEVE - Ender Dragon Speedrun Bot             ║");
  console.log("╚════════════════════════════════════════════════════════╝");
  console.log("");

  runRace(count, timeout);
}
