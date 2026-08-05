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
	z: number;
	message: string;
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

	// Random surface teleport. spreadplayers drops the bot on the top solid block
	// near (cx,cz) — no fall damage, and it loads the chunks itself. forceload keeps
	// them resident so the task can act immediately.
	if (!opts.noTeleport) {
		await rcon(`forceload add ${cx} ${cz}`).catch(() => {});
		await sleep(400);
		const sp = await rcon(`spreadplayers ${cx} ${cz} 0 24 false ${name}`).catch(
			(e) => `ERR ${e}`,
		);
		log(`[gym:${step.slug}] spreadplayers ${cx},${cz} → ${sp}`);
		await sleep(1800);
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
	try {
		const res = await Promise.race([
			step.run(bot),
			sleep(step.timeoutMs).then(() => ({ success: false, message: "gym timeout" })),
		]);
		message = (res as { message?: string })?.message ?? "";
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

	const result: GymResult = { pass, durationMs, x: gx, z: gz, message };
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
	if (!opts.noTeleport) await rcon(`forceload remove ${cx} ${cz}`).catch(() => {});
	return result;
};
