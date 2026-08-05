/**
 * Steve - Ender Dragon Speedrun Bot
 *
 * Usage:
 *   node src/main.ts                        Run 10 bots, 600s (default)
 *   node src/main.ts --bots 5 --timeout 180 Run 5 bots, 180s timeout
 *   node src/main.ts -b 1 -t 120            Run 1 bot, 120s timeout
 *
 * When run as a child (STEVE_BOT_MODE=1), acts as a single bot instance.
 * Otherwise, acts as the orchestrator that spawns bot child processes.
 */

import type { Bot } from "typecraft";
import { createBot as createMcBot, createWebViewer } from "typecraft";
import {
	attachSafety,
	equipBestTool,
	isInWaterTrap,
	registerBlockMemory,
} from "./lib/bot-utils.ts";
import { type Channel, createChannel } from "./lib/channel.ts";
import {
	attachDiagnostics,
	initLogger,
	logEvent,
	NOISY_DEBUG,
	registerRace,
} from "./lib/logger.ts";
import { type Event, runGoLoop } from "./lib/run-loop.ts";
import { syncFromBot } from "./state.ts";

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
	host: process.env.MC_HOST ?? "mc.bridgerb.com",
	port: parseInt(process.env.MC_PORT ?? "25565", 10),
	username: process.env.MC_USERNAME ?? "Steve",
};

// ============================================
// LOGGING
// ============================================

const log = (message: string) => {
	const timestamp = new Date().toISOString().split("T")[1]?.split(".")[0];
	console.log(`[${timestamp}] ${message}`);
};


export const startBot = async (): Promise<Bot> => {
	// Bot lifetime timeout — only when explicitly requested (CLI races). In-server
	// (SvelteKit) we omit STEVE_TIMEOUT so the bot runs until it disconnects and
	// never calls process.exit (which would kill the host Node server).
	if (process.env.STEVE_TIMEOUT) {
		const lifetimeMs = parseInt(process.env.STEVE_TIMEOUT, 10) * 1000;
		setTimeout(() => {
			log(`Lifetime timeout (${lifetimeMs / 1000}s) — exiting`);
			logEvent("lifecycle", "timeout", `${lifetimeMs / 1000}s`);
			process.exit(0);
		}, lifetimeMs);
	}

	// Per-bot channel + physics-tick handler, torn down on disconnect. Each startBot
	// invocation (the SvelteKit supervisor restarts it on reconnect) gets its OWN
	// channel and go-loop closure, so an old dead loop can never fight the new one
	// over shared state — the run state lives inside runGoLoop, not in module globals.
	let onPhysicsTick: (() => void) | null = null;
	let ch: Channel<Event> | null = null;

	log("Creating bot...");
	const version = process.env.MC_VERSION ?? "1.21.11";
	log(`Connecting to ${CONFIG.host}:${CONFIG.port} (version ${version})`);

	const bot = createMcBot({
		host: CONFIG.host,
		port: CONFIG.port,
		username: CONFIG.username,
		version,
		auth: "offline",
		// Match the server view-distance (6 chunks) instead of requesting "far" (16,
		// capped to 6 anyway) — keeps the bot's chunk view aligned with what's
		// actually loaded so findBlocks/pathfinding never reference unloaded chunks.
		viewDistance: 6,
	});

	// Never mine with a block in hand: equip the best tool (pickaxe for stone/ore,
	// axe for wood, shovel for soil) before EVERY dig, then dig. One wrap covers all
	// the scattered dig sites. Mirrors serve.ts's swingArm wrap; cheap because
	// equipBestTool no-ops when the correct tool is already held.
	const origDig = bot.dig.bind(bot);
	bot.dig = (async (...args: Parameters<typeof origDig>) => {
		try {
			await equipBestTool(bot, args[0] as Parameters<typeof equipBestTool>[1]);
		} catch {}
		return origDig(...args);
	}) as typeof bot.dig;

	// Start web viewer if port assigned (first 4 bots get viewers)
	const viewerPort = parseInt(process.env.STEVE_VIEWER_PORT ?? "0", 10);
	if (viewerPort > 0) {
		bot.once("spawn", () => {
			createWebViewer(bot, { port: viewerPort, viewDistance: 4 });
		});
	}

	bot.on("debug", (category: string, detail: Record<string, unknown>) => {
		if (NOISY_DEBUG.has(category)) return; // packet_rx/tx/entity too noisy for SQLite
		logEvent(category, "debug", JSON.stringify(detail), bot.entity?.position);
	});

	// Passive ore/log memory (blockSeen) — shared with the gym harness so both see the
	// same no-X-ray sightings. (Deliberately excludes "water"; see registerBlockMemory.)
	registerBlockMemory(bot);

	bot.once("spawn", async () => {
		log("Spawned into the world");
		logEvent(
			"lifecycle",
			"spawn",
			`pos=${Math.floor(bot.entity.position.x)},${Math.floor(
				bot.entity.position.y,
			)},${Math.floor(bot.entity.position.z)}`,
			bot.entity.position,
		);

		attachDiagnostics(bot);
		attachSafety(bot);

		await bot.waitForChunksToLoad();
		log("Chunks loaded");
		logEvent("lifecycle", "chunks_loaded");

		// In race mode, wait for orchestrator to teleport us before starting
		const targetX = parseInt(process.env.STEVE_SPAWN_X ?? "", 10);
		const targetZ = parseInt(process.env.STEVE_SPAWN_Z ?? "", 10);
		if (!isNaN(targetX)) {
			log(`Waiting for teleport to ${targetX}, ${targetZ}...`);
			await new Promise<void>((resolve) => {
				const timeout = setTimeout(resolve, 30000);
				const check = () => {
					const dx = Math.abs(bot.entity.position.x - targetX);
					const dz = Math.abs(bot.entity.position.z - targetZ);
					if (dx < 300 && dz < 300) {
						clearTimeout(timeout);
						bot.removeListener("forcedMove", check);
						resolve();
					}
				};
				bot.on("forcedMove", check);
				check();
			});
			await bot.waitForChunksToLoad();
			log(
				`Teleported to ${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.z)}`,
			);
		}

		log(
			`Position: ${Math.floor(bot.entity.position.x)}, ${Math.floor(
				bot.entity.position.y,
			)}, ${Math.floor(bot.entity.position.z)}`,
		);

		log("Starting reactive loop (CSP: a go-loop parked on the world's physics tick)");
		// Event-driven, core.async style. The go-loop PARKS on a channel; the bot's own
		// `physicsTick` (the world's ~20/s heartbeat) is the value that wakes it, carrying
		// a fresh immutable GameState. The reducer is pure + idempotent, so re-confirming
		// each tick is free; while a step runs the tick is a cheap no-op (status:"running"
		// gate). No timer of ours — the world drives us, and the run state is one value
		// living inside the loop, not module globals.
		ch = createChannel<Event>();
		const channel = ch;
		runGoLoop(bot, channel).catch((err) => {
			log(`Loop error: ${err instanceof Error ? err.message : "unknown"}`);
			channel.close();
		});

		onPhysicsTick = () => {
			let state: ReturnType<typeof syncFromBot> | null = null;
			let inWaterTrap = false;
			try {
				inWaterTrap = isInWaterTrap(bot);
				state = syncFromBot(bot);
			} catch {}
			if (!state) return;
			// Carry the surface-water-the-bot-is-wading-through onto the tick (FREE — the
			// cached isInWater flag, no scan); the reducer turns it into a remember command.
			const wp = bot.entity?.position;
			const rememberWaterPos =
				bot.entity?.isInWater && wp && wp.y >= 44
					? { x: wp.x, y: wp.y, z: wp.z }
					: undefined;
			channel.put({ type: "tick", state, inWaterTrap, rememberWaterPos });
		};
		bot.on("physicsTick", onPhysicsTick);

		// Prime the loop with one tick (it queues if the consumer hasn't parked yet).
		try {
			channel.put({
				type: "tick",
				state: syncFromBot(bot),
				inWaterTrap: isInWaterTrap(bot),
			});
		} catch {}
	});

	bot.on("death", () => {
		// Folded by the reducer: bumps epoch (strands any in-flight step result),
		// resets run state, and logs. Just hand the event to the loop.
		ch?.put({ type: "death" });
	});

	bot.on("health", () => {
		if (bot.health < 5) {
			log(`Low health: ${bot.health}/20`);
			logEvent(
				"health",
				"low_health",
				`${bot.health}/20`,
				bot.entity?.position,
			);
		}
	});

	// On disconnect/kick: stop feeding the channel and close it — the parked go-loop
	// takes CLOSED and exits, taking its run state with it. The logger stays alive;
	// the SvelteKit supervisor restarts startBot (a fresh channel + loop) to resume.
	const onGone = () => {
		if (onPhysicsTick) {
			bot.removeListener("physicsTick", onPhysicsTick);
			onPhysicsTick = null;
		}
		ch?.close();
		ch = null;
	};

	bot.on("end", () => {
		log("Disconnected");
		logEvent("lifecycle", "disconnected");
		onGone();
	});

	bot.on("kicked", (reason) => {
		const r = typeof reason === "string" ? reason : JSON.stringify(reason);
		log(`Kicked: ${r}`);
		logEvent("lifecycle", "kicked", r);
		onGone();
	});

	bot.on("error", (err) => {
		log(`Bot error: ${err.message}`);
		logEvent("error", "bot_error", err.message);
	});

	return bot;
};

// ============================================
// MULTI-BOT ORCHESTRATOR
// ============================================

import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectDb, type Sql } from "./lib/db.ts";

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
	// Persistent, monotonically-increasing bot serials — continue from the last
	// race so names never repeat. Stored in .race-serial at the repo root, which
	// survives world/DB resets (only data/steve.db* is cleared on reset).
	const serialFile = join(ROOT, ".race-serial");
	let serialStart = 1;
	try {
		const prev = JSON.parse(readFileSync(serialFile, "utf8"));
		if (typeof prev.next === "number" && prev.next > 0) serialStart = prev.next;
	} catch {}
	const names = Array.from({ length: count }, (_, i) =>
		`steve-race-${String(serialStart + i).padStart(3, "0")}`,
	);
	try {
		writeFileSync(serialFile, JSON.stringify({ next: serialStart + count }));
	} catch {}
	console.log(`  Bots: ${names.join(", ")}`);
	const SERVER_PORT = parseInt(process.env.MC_PORT ?? "25565", 10);
	const RCON_PORT = parseInt(process.env.MC_RCON_PORT ?? "25575", 10);
	const RCON_PASS = process.env.MC_RCON_PASS ?? "minecraft-test-rcon";

	const RACE_ID = new Date().toISOString().replace(/:/g, "-");

	const allProcs: ChildProcess[] = [];
	let winner: number | null = null;
	let raceDb: Sql | null = null;

	const viewerBots: Bot[] = [];
	const killAll = async () => {
		// Send SIGTERM first so bots disconnect gracefully
		for (const p of allProcs) p.kill("SIGTERM");
		for (const v of viewerBots) {
			try {
				v.end();
			} catch {}
		}
		// Give bots time to disconnect before force-killing
		await sleep(500);
		for (const p of allProcs) {
			try {
				p.kill("SIGKILL");
			} catch {}
		}
		if (raceDb) {
			const s = raceDb;
			raceDb = null;
			await s.end({ timeout: 2 }).catch(() => {});
		}
	};
	process.on("SIGINT", () => {
		killAll().then(() => process.exit(0));
	});
	process.on("SIGTERM", () => {
		killAll().then(() => process.exit(0));
	});
	const { connect: rconConnect } = await import("./lib/rcon.ts");
	const rconClient = await rconConnect({
		port: RCON_PORT,
		password: RCON_PASS,
	});
	const rcon = (cmd: string) => rconClient.command(cmd);
	process.on("exit", () => {
		try {
			rconClient.close();
		} catch {}
	});

	const getRaceDb = (): Sql | null => {
		if (raceDb) return raceDb;
		try {
			raceDb = connectDb();
			return raceDb;
		} catch {
			return null;
		}
	};

	const GOAL = "enter_nether";
	initLogger(RACE_ID);
	registerRace(RACE_ID, "race", count, timeoutMs / 1000, GOAL);

	const MILESTONES = [
		{ name: "wood", query: "item_name LIKE '%_log'" },
		{ name: "wooden pickaxe", query: "item_name = 'wooden_pickaxe'" },
		{ name: "cobblestone", query: "item_name = 'cobblestone'" },
		{ name: "stone pickaxe", query: "item_name = 'stone_pickaxe'" },
		{ name: "stone sword", query: "item_name = 'stone_sword'" },
		{
			name: "food",
			query:
				"item_name LIKE 'cooked_%' OR item_name IN ('beef','porkchop','mutton','chicken','rabbit','bread','apple')",
		},
		{ name: "furnace", query: "item_name = 'furnace'" },
		{ name: "coal", query: "item_name = 'coal'" },
		{ name: "iron ore", query: "item_name = 'raw_iron'" },
		{ name: "iron ingot", query: "item_name = 'iron_ingot'" },
		{ name: "iron pickaxe", query: "item_name = 'iron_pickaxe'" },
		{
			name: "bucket",
			query: "item_name = 'bucket' OR item_name = 'water_bucket'",
		},
		{ name: "flint & steel", query: "item_name = 'flint_and_steel'" },
		{ name: "blaze rod", query: "item_name = 'blaze_rod'" },
		{ name: "ender pearl", query: "item_name = 'ender_pearl'" },
		{ name: "eye of ender", query: "item_name = 'ender_eye'" },
	];
	const milestonesHit = new Set<string>();
	const raceStart = Date.now();

	const checkMilestones = async (): Promise<void> => {
		const db = getRaceDb();
		if (!db) return;
		for (const m of MILESTONES) {
			if (milestonesHit.has(m.name)) continue;
			try {
				const rows = (await db`SELECT bot_id FROM inventory_snapshots WHERE race_id = ${RACE_ID} AND (${db.unsafe(m.query)}) LIMIT 1`) as unknown as {
					bot_id: string;
				}[];
				const row = rows[0];
				if (row) {
					milestonesHit.add(m.name);
					const elapsed = Math.round((Date.now() - raceStart) / 1000);
					console.log(`  ${elapsed}s  ${row.bot_id} → ${m.name}`);
				}
			} catch {}
		}
	};

	const checkForGoal = async (botId: string): Promise<boolean> => {
		const db = getRaceDb();
		if (!db) return false;
		try {
			const rows = (await db`SELECT COUNT(*)::int AS c FROM events WHERE race_id = ${RACE_ID} AND bot_id = ${botId} AND event = 'success' AND detail LIKE 'Enter Nether:%'`) as unknown as {
				c: number;
			}[];
			return (rows[0]?.c ?? 0) > 0;
		} catch {
			return false;
		}
	};

	const getInventory = async (botId: string): Promise<string> => {
		const db = getRaceDb();
		if (!db) return "no data";
		try {
			const rows = (await db`SELECT item_name || 'x' || MAX(count)::text AS inv FROM inventory_snapshots WHERE race_id = ${RACE_ID} AND bot_id = ${botId} GROUP BY item_name ORDER BY MAX(count) DESC LIMIT 5`) as unknown as {
				inv: string;
			}[];
			return rows.map((r) => r.inv).join(", ") || "empty";
		} catch {
			return "db error";
		}
	};

	// Web viewer count — defaults to the bot count so the dashboard's 3D windows
	// always render; override with STEVE_NUM_VIEWERS (set 0 to disable / headless).
	const NUM_VIEWERS = process.env.STEVE_NUM_VIEWERS
		? parseInt(process.env.STEVE_NUM_VIEWERS, 10)
		: count;

	// Spawn in the DRY DENSE forest around (696,704). The near-spawn forest (-64,-128)
	// is a wet river valley (constant drownings), and its dry strip is too small and
	// sparse (bots strand at Gather Wood). (696,704) is a full forest on dry ground —
	// fast wood AND no spawn drownings. Standard grid.
	//
	// Small per-race jitter (±60, bounded) so consecutive relaunches don't chop the
	// EXACT same 20×22 grid and cumulatively bare the core — but stay well inside the
	// known forest (marching far NE overshot into a treeless biome). Bots that still
	// hit a locally-thin patch now explore out to reachable trees (gather-wood fix)
	// instead of fixating on unreachable remembered logs across a ravine.
	// Base moved to a PRISTINE forest at (-3936, 3968): the original (696,704) region
	// was worked out after a full session of races (~30+ bots), starving fresh bots at
	// Gather Wood. This spot is a dense forest biome (771 leaves in a probe) far from any
	// area a bot has visited, so it's untouched. If it too gets chopped over many races,
	// re-locate a fresh forest via RCON `locate biome minecraft:forest` from a far point.
	const raceNum = Math.floor((serialStart - 1) / Math.max(1, count));
	// Spread successive races across a LARGE fresh area. The old ±60 jitter kept every race
	// in the same ~120x120 zone around (-3936,3968), which 90+ cumulative bot runs have
	// DEFORESTED — so recent races start tree-starved and loop Gather Wood on far trees. Step
	// 512 blocks per race in a 7x7 grid (~3500x3500 spread) so each race lands in essentially
	// virgin forest with its own trees/ore, escaping the clear-cut core.
	const GRID = 7;
	const STEP = 512;
	const FX = -3936 + ((raceNum % GRID) - Math.floor(GRID / 2)) * STEP;
	const FZ =
		3968 + ((Math.floor(raceNum / GRID) % GRID) - Math.floor(GRID / 2)) * STEP;
	const spawns: { x: number; z: number }[] = [];
	for (let i = 0; i < count; i++) {
		spawns.push({ x: FX + ((i % 5) - 2) * 24, z: FZ + Math.floor(i / 5) * 26 });
	}

	// Spawn all bot processes first, then teleport them
	const botProcs: { proc: ChildProcess; username: string; exited: boolean }[] =
		[];
	for (let i = 0; i < count; i++) {
		const username = names[i]!;
		await sleep(2000);
		// Child = one bot. Must run the real entry (src/lib/steve/main.ts, not the old
		// src/main.ts) WITH the typecraft loader so the bare `typecraft` import resolves,
		// and with STEVE_CLI=1 so the CLI dispatch actually runs (STEVE_BOT_MODE branch).
		const steveProc = spawn(
			process.execPath,
			[
				"--import",
				join(ROOT, "typecraft-resolve.mjs"),
				join(ROOT, "src/lib/steve/main.ts"),
			],
			{
			cwd: ROOT,
			env: {
				...process.env,
				STEVE_CLI: "1",
				MC_PORT: String(SERVER_PORT),
				MC_USERNAME: username,
				STEVE_RACE_ID: RACE_ID,
				STEVE_BOT_MODE: "1",
				STEVE_SPAWN_X: String(spawns[i]?.x ?? 0),
				STEVE_SPAWN_Z: String(spawns[i]?.z ?? 0),
				STEVE_TIMEOUT: String(timeoutMs / 1000),
				STEVE_VIEWER_PORT: i < NUM_VIEWERS ? String(3001 + i) : "",
			},
			stdio: ["ignore", "ignore", "ignore"],
		});
		allProcs.push(steveProc);
		const entry = { proc: steveProc, username, exited: false };
		steveProc.on("exit", () => {
			entry.exited = true;
		});
		botProcs.push(entry);
	}

	// Teleport each bot as soon as it joins — poll and tp in one loop
	const placed = new Set<string>();
	for (let attempt = 0; attempt < 60 && placed.size < count; attempt++) {
		await sleep(1000);
		try {
			const list = await rcon("list");
			for (let i = 0; i < count; i++) {
				const name = names[i]!;
				if (placed.has(name) || !list.includes(name)) continue;
				const x = spawns[i]?.x ?? 0;
				const z = spawns[i]?.z ?? 0;
				await rcon(`clear ${name}`);
				await rcon(`tp ${name} ${x} 200 ${z}`);
				// Stagger: the box has only 4 cores, so let each bot's fresh chunk
				// generation settle before teleporting the next — otherwise 10
				// simultaneous gens saturate the CPU and the server misses keepalives,
				// dropping bots with "lost connection: Timed out".
				await sleep(8000);
				placed.add(name);
				console.log(`  ${name} → tp ${x}, ${z}`);
			}
		} catch {}
	}
	if (placed.size < count)
		console.log(`  Warning: ${count - placed.size} bots did not join`);
	console.log(`  All bots teleported — race starting\n`);

	const runBot = async (idx: number): Promise<InstanceResult> => {
		const username = names[idx]!;
		const entry = botProcs[idx]!;
		const steveProc = entry.proc;
		steveProc.on("exit", () => {
			entry.exited = true;
		});

		const start = Date.now();

		while (Date.now() - start < timeoutMs && winner === null && !entry.exited) {
			await sleep(3000);
			await checkMilestones();
			if (await checkForGoal(username)) {
				const elapsed = Math.round((Date.now() - start) / 1000);
				winner = idx;
				console.log(
					`\n${username} WINS — ${GOAL} in ${elapsed}s (race: ${RACE_ID})\n`,
				);
				const { notify } = await import("./lib/notify.ts");
				await notify("Steve Bot", `${username} got ${GOAL} in ${elapsed}s`);
				await rcon(`title ${username} title {"text":"WINNER!","color":"gold"}`);
				await sleep(10000);
				await killAll();
				return { idx, username, elapsed, won: true, inventory: GOAL };
			}
		}

		const elapsed = Math.round((Date.now() - start) / 1000);
		if (!entry.exited) steveProc.kill("SIGKILL");
		if (winner !== null && winner !== idx) {
			return {
				idx,
				username,
				elapsed,
				won: false,
				inventory: await getInventory(username),
			};
		}
		return {
			idx,
			username,
			elapsed,
			won: false,
			inventory: await getInventory(username),
		};
	};

	console.log(
		`Run ${RACE_ID} — ${count} bot${count > 1 ? "s" : ""} (timeout=${
			timeoutMs / 1000
		}s)\n`,
	);

	// Op all bot usernames
	for (let i = 0; i < count; i++) {
		await rcon(`op ${names[i]}`);
	}
	// Keep inventory on death — a bot that drowns/falls deep keeps its hard-won
	// iron instead of resetting to square one (deaths were the main progress-sink).
	await rcon("gamerule keep_inventory true");
	// Start the world at morning (time 0) so it's lit for the dashboard 3D views.
	await rcon("time set 0");
	await sleep(1000);

	// Web viewer grid
	if (NUM_VIEWERS > 0) {
		const { createServer: createHttpServer } = await import("node:http");
		const gridHtml = `<!DOCTYPE html>
<html><head><title>Steve Race</title>
<style>
body { margin: 0; background: #111; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; width: 100vw; height: 100vh; gap: 2px; }
iframe { width: 100%; height: 100%; border: none; background: #222; }
.cell { position: relative; }
.label { position: absolute; top: 4px; left: 8px; color: #fff; font: bold 14px monospace; z-index: 1; text-shadow: 0 0 4px #000; }
</style></head><body>
${Array.from(
	{ length: NUM_VIEWERS },
	(_, i) =>
		`<div class="cell"><div class="label">Steve${i}</div><iframe src="http://localhost:${
			3001 + i
		}"></iframe></div>`,
).join("\n")}
</body></html>`;
		const gridServer = createHttpServer((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(gridHtml);
		});
		gridServer.listen(3000, () =>
			console.log(`[grid] http://localhost:3000 (${NUM_VIEWERS} viewers)`),
		);
		gridServer.on("error", () => {
			console.log("[grid] port 3000 in use, skipping viewer");
		});
	}

	const results = await Promise.all(
		Array.from({ length: count }, (_, i) => runBot(i)),
	);

	console.log(`\n${"─".repeat(70)}`);
	console.log(`Run ${RACE_ID}`);
	console.log(`${"─".repeat(70)}`);
	console.log(
		`${"#".padEnd(4)} ${"bot".padEnd(10)} ${"time".padEnd(8)} ${"result".padEnd(
			10,
		)} inventory`,
	);
	console.log(`${"─".repeat(70)}`);
	const hasWinner = results.some((r) => r.won);
	for (const r of results) {
		const status = r.won
			? GOAL.toUpperCase()
			: hasWinner
				? "racing"
				: "timeout";
		console.log(
			`${String(r.idx).padEnd(4)} ${r.username.padEnd(10)} ${(
				`${r.elapsed}s`
			).padEnd(8)} ${status.padEnd(10)} ${r.inventory}`,
		);
	}
	console.log(`${"─".repeat(70)}`);

	const winners = results.filter((r) => r.won);
	if (winners.length > 0) {
		console.log(
			`${winners.length}/${count} ${GOAL} — fastest: ${Math.min(
				...winners.map((r) => r.elapsed),
			)}s`,
		);
	} else {
		console.log(`0/${count} got ${GOAL}`);
	}
	process.exit(0);
};

// ============================================
// START
// ============================================

// CLI entry — runs ONLY as a standalone process (STEVE_CLI=1). When this module
// is imported (e.g. by the SvelteKit server to reuse startBot), the dispatch must
// not run, or it would fork a whole race on import.
if (process.env.STEVE_CLI === "1") {
	const isBotMode = process.env.STEVE_BOT_MODE === "1";

	if (isBotMode) {
		// Child bot process — run single bot directly
		const raceId = process.env.STEVE_RACE_ID ?? new Date().toISOString();
		initLogger(raceId);
		if (!process.env.STEVE_RACE_ID) registerRace(raceId, "solo", 1);
		startBot();
	} else {
		// Orchestrator — parse args, spawn bot(s)
		const { parseArgs } = await import("node:util");
		const { values } = parseArgs({
			options: {
				bots: { type: "string", short: "b", default: "4" },
				timeout: { type: "string", short: "t", default: "7200" },
			},
			allowPositionals: true,
			args: process.argv.slice(2),
		});
		const count = parseInt(values.bots!, 10);
		const timeout = parseInt(values.timeout!, 10) * 1000;

		console.log("");
		console.log("╔════════════════════════════════════════════════════════╗");
		console.log("║          STEVE - Ender Dragon Speedrun Bot             ║");
		console.log("╚════════════════════════════════════════════════════════╝");
		console.log("");

		runRace(count, timeout);
	}
}
