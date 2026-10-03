/**
 * Run one gym exercise on a bot: reset it, grant the step's prerequisites, teleport
 * it to a RANDOM surface location (0,0)–(10k,10k), run just that task under its
 * timeout, check whether it produced the expected output, and record the result.
 * Shared by the /gym web runner and the node:test suite.
 */
import type { Bot } from "typecraft";
import type { GymStep } from "./registry.ts";
import { recordGymRun } from "./db.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Rcon = (cmd: string) => Promise<string>;

export interface GymResult {
	pass: boolean;
	durationMs: number;
	x: number;
	y?: number;
	z: number;
	message: string;
	/** World seed from RCON `seed` (recorded for replayable, paired trials). */
	seed?: string;
	/** The landing cell requested (replay it with GYM_LANDING="x,z"). */
	landing?: [number, number];
	/** Step-reported extras (e.g. time_to_portal_s, dispatches, deaths). */
	extra?: Record<string, unknown>;
}

export interface RunGymOpts {
	/** Skip the random teleport (e.g. to test the current spot). */
	noTeleport?: boolean;
	log?: (line: string) => void;
}

export const runGymStep = async (
	bot: Bot,
	step: GymStep,
	rcon: Rcon,
	opts: RunGymOpts = {},
): Promise<GymResult> => {
	const name = bot.username;
	const log = opts.log ?? (() => {});
	const cx = Math.floor(Math.random() * 10000);
	const cz = Math.floor(Math.random() * 10000);

	// Reset the bot to a clean survival state, then grant prerequisites.
	await rcon(`gamemode survival ${name}`).catch(() => {});
	await rcon(`clear ${name}`).catch(() => {});
	await sleep(400);
	for (const item of step.prereq) await rcon(`give ${name} ${item}`).catch(() => {});
	await sleep(400);

	// Surface placement WITHOUT spreadplayers (cycle 4, Part 5.4: spreadplayers into
	// ungenerated terrain generates chunks synchronously on the server thread and crashed
	// Server B with a 60 s watchdog tick). Forceload the landing chunk, wait until it is
	// loaded, then tp onto the motion-blocking heightmap. GYM_LANDING="x,z" replays a
	// recorded landing (paired comparisons); otherwise a random cell in (0..10k)².
	let seed: string | undefined;
	try {
		seed = /\[(-?\d+)\]/.exec(await rcon("seed"))?.[1];
		if (seed) process.env.GYM_SEED = seed;
	} catch {}
	const forced: [number, number][] = [];
	let landing: [number, number] = [cx, cz];
	if (!opts.noTeleport) {
		const fixed = (process.env.GYM_LANDING ?? "").split(",").map(Number);
		let landed = false;
		for (let t = 0; t < 3; t++) {
			const tx = t === 0 && fixed.length === 2 && fixed.every(Number.isFinite) ? fixed[0]! : t === 0 ? cx : Math.floor(Math.random() * 10000);
			const tz = t === 0 && fixed.length === 2 && fixed.every(Number.isFinite) ? fixed[1]! : t === 0 ? cz : Math.floor(Math.random() * 10000);
			await rcon(`forceload add ${tx} ${tz}`).catch(() => {});
			forced.push([tx, tz]);
			let loaded = false;
			for (let w = 0; w < 60 && !loaded; w++) {
				const r = await rcon(`execute if loaded ${tx} 0 ${tz}`).catch(() => "");
				if (/passed/i.test(r)) loaded = true;
				else await sleep(500);
			}
			if (!loaded) {
				log(`[gym:${step.slug}] chunk ${tx},${tz} never loaded — next cell`);
				continue;
			}
			const tp = await rcon(
				`execute positioned ${tx} 0 ${tz} positioned over motion_blocking_no_leaves run tp ${name} ~0.5 ~ ~0.5`,
			).catch((e) => `ERR ${e}`);
			log(`[gym:${step.slug}] tp-over ${tx},${tz} → ${tp}`);
			// The client position lags the server teleport: wait until it has moved here.
			for (let w = 0; w < 30; w++) {
				await sleep(200);
				const p = bot.entity?.position;
				if (p && Math.abs(p.x - tx) < 8 && Math.abs(p.z - tz) < 8) break;
			}
			await sleep(1200);
			const ly = bot.entity?.position?.y ?? 0;
			const wet = !!(bot as { entity?: { isInWater?: boolean } }).entity?.isInWater;
			const lava = /passed/i.test(await rcon(`execute as ${name} at @s if block ~ ~ ~ minecraft:lava`).catch(() => ""));
			if (ly >= 55 && !wet && !lava) {
				landed = true;
				landing = [tx, tz];
				break;
			}
			log(`[gym:${step.slug}] bad landing (y=${Math.floor(ly)}${wet ? " water" : ""}${lava ? " lava" : ""}) — next cell`);
			await rcon(`forceload remove ${tx} ${tz}`).catch(() => {});
			forced.pop();
		}
		if (!landed) {
			for (const [fx, fz] of forced) await rcon(`forceload remove ${fx} ${fz}`).catch(() => {});
			const message = "HARNESS no good landing after 3 cells";
			log(`[gym:${step.slug}] FAIL 0s — ${message}`);
			return { pass: false, durationMs: 0, x: cx, z: cz, message, seed };
		}
	}
	try {
		await (bot as unknown as { waitForChunksToLoad?: () => Promise<void> }).waitForChunksToLoad?.();
	} catch {
		/* keep going */
	}
	await sleep(1500);

	const gx = Math.floor(bot.entity?.position?.x ?? cx);
	const gy = Math.floor(bot.entity?.position?.y ?? 64);
	const gz = Math.floor(bot.entity?.position?.z ?? cz);
	log(`[gym:${step.slug}] tp ${gx},${gy},${gz} — running`);

	// Per-step scaffold (e.g. enter-nether builds a lit portal at the landing). Runs
	// after the teleport so it can build relative to where the bot actually landed.
	if (step.setup) {
		try {
			await step.setup(bot, rcon, { x: gx, y: gy, z: gz });
			await sleep(800);
		} catch (e) {
			log(`[gym:${step.slug}] setup error: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	// Match the race's priority-0 escape_water override: a random teleport into water
	// shouldn't fail an unrelated step (mining/gathering bail "yielding to escape_water").
	// In a real run escape_water always gets the bot to dry land BEFORE any other step,
	// so do the same here — otherwise water spawns falsely tank every resource step.
	if ((bot as { entity?: { isInWater?: boolean } }).entity?.isInWater) {
		try {
			const { escapeWater } = await import("../lib/bot-utils.ts");
			await Promise.race([escapeWater(bot as never), sleep(30000)]);
			log(`[gym:${step.slug}] escaped spawn water`);
		} catch {
			/* best-effort */
		}
	}

	const t0 = Date.now();
	let message = "";
	let extra: Record<string, unknown> | undefined;
	try {
		const res = await Promise.race([
			step.run(bot),
			sleep(step.timeoutMs).then(() => ({ success: false, message: "gym timeout" })),
		]);
		message = (res as { message?: string })?.message ?? "";
		extra = (res as { extra?: Record<string, unknown> })?.extra;
	} catch (e) {
		message = e instanceof Error ? e.message : String(e);
	}
	const durationMs = Date.now() - t0;

	let pass = false;
	try {
		pass = step.pass(bot);
	} catch {
		pass = false;
	}

	const result: GymResult = { pass, durationMs, x: gx, y: gy, z: gz, message, seed, landing, extra };
	log(`[gym:${step.slug}] ${pass ? "PASS" : "FAIL"} ${(durationMs / 1000).toFixed(1)}s @${gx},${gy},${gz} — ${message}`);
	try {
		// Store the reproduction fields: exact tp (x,y,z) + prereqs → re-run anywhere.
		recordGymRun({
			slug: step.slug,
			pass,
			duration_ms: durationMs,
			x: gx,
			y: gy,
			z: gz,
			prereq: step.prereq,
			message,
		});
	} catch {
		/* db optional */
	}
	// Release exactly the chunk(s) this run forceloaded (the old code released the
	// FIRST cell even when a later one was kept, leaking forceloads).
	for (const [fx, fz] of forced) await rcon(`forceload remove ${fx} ${fz}`).catch(() => {});
	return result;
};
