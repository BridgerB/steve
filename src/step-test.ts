/**
 * Isolation test runner — test ONE race step (or all) in isolation, "like the
 * race": spawn N bots, spread them ~50 blocks apart on flat platforms, hand each
 * its prerequisite kit + local arena, run only that step, and report how many
 * pass. Turns hours-to-feedback into seconds-to-feedback.
 *
 *   node src/step-test.ts get_water_buckets --bots 5
 *   node src/step-test.ts portal_cast -b 5
 *   node src/step-test.ts all -b 3
 *
 * Like main.ts, this file is BOTH orchestrator and child, switched by
 * STEP_TEST_MODE. The orchestrator spawns one child per bot, RCON-builds each
 * bot's platform + teleports it (8s stagger, the race's CPU lesson), then
 * collects each child's exit code (0=pass, 1=fail) and its RESULT line.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import type { Bot } from "typecraft";
import { createBot } from "typecraft";
import { attachSafety } from "./lib/bot-utils.ts";
import {
	attachDiagnostics,
	initLogger,
	logEvent,
	registerRace,
} from "./lib/logger.ts";
import { allIds, byId } from "./step-tests/registry.ts";
import { syncFromBot } from "./state.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ============================================================================
// CHILD — one bot, one step
// ============================================================================
const runChild = async (): Promise<void> => {
	const testId = process.env.STEP_TEST_ID ?? "";
	const test = byId.get(testId);
	if (!test) {
		console.log(`RESULT pass=false ok=false msg="unknown test ${testId}"`);
		process.exit(1);
	}

	const raceId = process.env.STEVE_RACE_ID ?? new Date().toISOString();
	initLogger(raceId);

	const bot = createBot({
		host: process.env.MC_HOST ?? "localhost",
		port: parseInt(process.env.MC_PORT ?? "25565", 10),
		username: process.env.MC_USERNAME ?? "Test",
		version: process.env.MC_VERSION ?? "1.21.11",
		auth: "offline",
	});
	bot.on("error", (e) => {
		if (!e.message.includes("waypoint")) console.error("ERR", e.message);
	});

	// Backstop: never hang a child forever (step timeout + setup/connect slack).
	const hard = setTimeout(
		() => {
			console.log(`RESULT pass=false ok=false msg="hard timeout"`);
			process.exit(1);
		},
		(test.timeout ?? 120_000) + 90_000,
	);

	bot.once("spawn", async () => {
		try {
			attachDiagnostics(bot);
			attachSafety(bot);
			await bot.waitForChunksToLoad();

			// Wait for the orchestrator to teleport us onto our platform.
			const tx = parseInt(process.env.STEVE_SPAWN_X ?? "", 10);
			const tz = parseInt(process.env.STEVE_SPAWN_Z ?? "", 10);
			if (!Number.isNaN(tx)) {
				await new Promise<void>((resolve) => {
					const to = setTimeout(resolve, 30_000);
					const check = () => {
						if (
							Math.abs(bot.entity.position.x - tx) < 300 &&
							Math.abs(bot.entity.position.z - tz) < 300
						) {
							clearTimeout(to);
							bot.removeListener("forcedMove", check);
							resolve();
						}
					};
					bot.on("forcedMove", check);
					check();
				});
				await bot.waitForChunksToLoad();
			}
			await sleep(2000);

			// Setup via RCON (reliable — bot.chat drops commands under load and
			// gives false failures). Helpers bind to this bot's name + platform pos.
			const { connect } = await import("./lib/rcon.ts");
			const rconClient = await connect({
				port: parseInt(process.env.MC_RCON_PORT ?? "25575", 10),
				password: process.env.MC_RCON_PASS ?? "minecraft-test-rcon",
			});
			const username = process.env.MC_USERNAME ?? "Test";
			const p0 = bot.entity.position;
			const X = Math.floor(p0.x);
			const Y = Math.floor(p0.y);
			const Z = Math.floor(p0.z);
			await test.setup({
				cmd: async (s: string) => {
					await rconClient.command(s);
					await sleep(120);
				},
				give: async (item: string, n: number) => {
					await rconClient.command(`give ${username} ${item} ${n}`);
					await sleep(120);
				},
				clear: async () => {
					await rconClient.command(`clear ${username}`);
					await sleep(120);
				},
				x: X,
				y: Y,
				z: Z,
			});
			try {
				rconClient.close();
			} catch {}
			await sleep(1500); // let block + inventory updates arrive at the bot

			const sp = bot.entity.position;
			console.log(
				`START id=${testId} x=${Math.floor(sp.x)} y=${Math.floor(sp.y)} z=${Math.floor(sp.z)}`,
			);

			const run =
				test.run ?? ((b: Bot) => test.step!.execute(b, syncFromBot(b)));
			let result: { success: boolean; message: string };
			try {
				result = await Promise.race([
					run(bot),
					sleep(test.timeout ?? 120_000).then(() => ({
						success: false,
						message: "step timeout",
					})),
				]);
			} catch (e) {
				result = {
					success: false,
					message: `threw: ${e instanceof Error ? e.message : String(e)}`,
				};
			}

			const pass = test.pass
				? test.pass(bot)
				: test.step!.isComplete(syncFromBot(bot));
			logEvent("isolation", pass ? "pass" : "fail", `${testId}: ${result.message}`);
			console.log(
				`RESULT pass=${pass} ok=${result.success} msg="${String(result.message).replace(/"/g, "'")}"`,
			);
			clearTimeout(hard);
			await sleep(300);
			process.exit(pass ? 0 : 1);
		} catch (e) {
			console.log(
				`RESULT pass=false ok=false msg="child error: ${e instanceof Error ? e.message : String(e)}"`,
			);
			process.exit(1);
		}
	});
};

// ============================================================================
// ORCHESTRATOR — spawn N bots, spread, run, report
// ============================================================================
const runOrchestrator = async (): Promise<void> => {
	const { parseArgs } = await import("node:util");
	const { values, positionals } = parseArgs({
		options: {
			bots: { type: "string", short: "b", default: "5" },
			timeout: { type: "string", short: "t", default: "300" },
		},
		allowPositionals: true,
		args: process.argv.slice(2),
	});
	const which = positionals[0] ?? "all";
	const count = parseInt(values.bots ?? "5", 10);
	const timeoutSec = parseInt(values.timeout ?? "300", 10);

	const ids = which === "all" ? allIds() : [which];
	for (const id of ids) {
		if (!byId.has(id)) {
			console.log(
				`Unknown step test "${id}".\nAvailable: ${allIds().join(", ")}`,
			);
			process.exit(1);
		}
	}

	const ROOT = process.cwd();
	const RCON_PORT = parseInt(process.env.MC_RCON_PORT ?? "25575", 10);
	const RCON_PASS = process.env.MC_RCON_PASS ?? "minecraft-test-rcon";
	const { connect } = await import("./lib/rcon.ts");
	const rconClient = await connect({ port: RCON_PORT, password: RCON_PASS });
	const rcon = (c: string) => rconClient.command(c);

	const RACE_ID = `steptest-${new Date().toISOString().replace(/:/g, "-")}`;
	initLogger(RACE_ID);
	registerRace(RACE_ID, "isolation", count);

	// Grid spacing must exceed the craft task's 50-block "walk back to a known
	// crafting table" radius — at 50, bot N walks toward bot N-1's table and
	// fails "Need crafting table". 128 keeps each bot fully isolated (arenas are
	// only ~±12). Parked away from the world.
	const FX = 400;
	const FZ = 400;
	const SPACING = 128;
	const spawns = Array.from({ length: count }, (_, i) => ({
		x: FX + (i % 5) * SPACING,
		z: FZ + Math.floor(i / 5) * SPACING,
	}));

	type Res = { username: string; success: boolean; message: string };

	const runOneTest = async (id: string): Promise<Res[]> => {
		const test = byId.get(id)!;
		console.log(`\n=== ${id} (${test.name}) — ${count} bots ===`);

		const procs: {
			proc: ChildProcess;
			username: string;
			out: string;
			exited: boolean;
			code: number | null;
		}[] = [];
		for (let i = 0; i < count; i++) {
			const username = `Test${i}`;
			const child = spawn(process.execPath, [join(ROOT, "src/step-test.ts")], {
				cwd: ROOT,
				env: {
					...process.env,
					STEP_TEST_MODE: "1",
					STEP_TEST_ID: id,
					MC_USERNAME: username,
					STEVE_RACE_ID: RACE_ID,
					STEVE_SPAWN_X: String(spawns[i]!.x),
					STEVE_SPAWN_Z: String(spawns[i]!.z),
					STEVE_TIMEOUT: String(timeoutSec),
				},
				stdio: ["ignore", "pipe", "ignore"],
			});
			const entry = {
				proc: child,
				username,
				out: "",
				exited: false,
				code: null as number | null,
			};
			child.stdout?.on("data", (d) => {
				entry.out += d.toString();
			});
			child.on("exit", (code) => {
				entry.exited = true;
				entry.code = code;
			});
			procs.push(entry);
			await sleep(2000);
		}

		// Build each bot's platform + teleport it (8s stagger — CPU lesson).
		const placed = new Set<string>();
		for (let attempt = 0; attempt < 90 && placed.size < count; attempt++) {
			await sleep(1000);
			let list = "";
			try {
				list = await rcon("list");
			} catch {}
			for (let i = 0; i < count; i++) {
				const name = `Test${i}`;
				if (placed.has(name) || !list.includes(name)) continue;
				const { x, z } = spawns[i]!;
				// A THICK solid stone block (y70-99), not a thin floating slab —
				// otherwise mining/digging steps punch through it and fall into the
				// void. The bot stands on top at y100.
				await rcon(`fill ${x - 12} 100 ${z - 12} ${x + 12} 130 ${z + 12} air`);
				await rcon(`fill ${x - 12} 70 ${z - 12} ${x + 12} 99 ${z + 12} stone`);
				await rcon(`gamemode survival ${name}`);
				await rcon(`tp ${name} ${x} 100 ${z}`);
				await sleep(8000);
				placed.add(name);
				console.log(`  ${name} → platform @ ${x},${z}`);
			}
		}

		// Wait for children to finish (bounded).
		const deadline = Date.now() + (timeoutSec + 150) * 1000;
		while (procs.some((p) => !p.exited) && Date.now() < deadline) {
			await sleep(2000);
		}
		for (const p of procs) {
			if (!p.exited) {
				try {
					p.proc.kill("SIGKILL");
				} catch {}
			}
		}
		await sleep(500);

		return procs.map((p) => {
			const m = p.out.match(/RESULT pass=(\w+) ok=(\w+) msg="([^"]*)"/);
			const pass = p.code === 0 || (!!m && m[1] === "true");
			const msg = m
				? m[3]!
				: p.exited
					? `exit ${p.code}, no RESULT line`
					: "timed out (killed)";
			return { username: p.username, success: pass, message: msg };
		});
	};

	const summary: { id: string; passed: number; total: number }[] = [];
	for (const id of ids) {
		const results = await runOneTest(id);
		const passed = results.filter((r) => r.success).length;
		for (const r of results) {
			console.log(`  [${r.success ? "PASS" : "FAIL"}] ${r.username}  ${r.message}`);
		}
		console.log(`  → ${passed}/${results.length} passed`);
		summary.push({ id, passed, total: results.length });
	}

	console.log(`\n========== ISOLATION TEST SUMMARY ==========`);
	for (const s of summary) {
		const mark = s.passed === s.total ? "✓" : s.passed === 0 ? "✗" : "~";
		console.log(`  ${mark} ${s.id}: ${s.passed}/${s.total}`);
	}
	try {
		rconClient.close();
	} catch {}
	process.exit(0);
};

// ============================================================================
if (process.env.STEP_TEST_MODE === "1") {
	runChild();
} else {
	runOrchestrator();
}
