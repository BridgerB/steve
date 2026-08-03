/**
 * flint-and-steel strategy LAB (repo-root, like water-lab.ts). Connects ONE bot,
 * and for N trials runs the gym step's normal reset+give+random-teleport flow
 * (via runGymStep) but with the task `run` swapped for a pluggable strategy from
 * ./exp-flint/<STRATEGY>.ts. Prints per-trial + summary so ideas compare directly.
 *
 * Run:
 *   STRATEGY=idea-mine BOT=gym-flint-1 N=5 \
 *     node --env-file=.env --import ./typecraft-resolve.mjs flint-lab.ts
 */
import { createBot } from "typecraft";
import { GYM_STEPS } from "./src/lib/steve/gym/registry.ts";
import { runGymStep } from "./src/lib/steve/gym/run.ts";
import { initLogger } from "./src/lib/steve/lib/logger.ts";
import { connect } from "./src/lib/steve/lib/rcon.ts";
import type { StepResult } from "./src/lib/steve/types.ts";

const STRATEGY = process.env.STRATEGY ?? process.argv[2] ?? "baseline";
const BOT = process.env.BOT ?? "gym-flint-1";
const N = Number(process.env.N ?? 5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const step = GYM_STEPS.find((s) => s.slug === "flint-and-steel");
if (!step) throw new Error("no flint-and-steel step");

const mod = await import(`./exp-flint/${STRATEGY}.ts`);
const strat: (bot: unknown) => Promise<StepResult> = mod.run ?? mod.default;
if (typeof strat !== "function")
	throw new Error(`strategy ${STRATEGY} must export run(bot) or default`);

const rcon = await connect();
const cmd = (c: string) => rcon.command(c);

const bot = createBot({
	host: process.env.MC_HOST ?? "localhost",
	port: parseInt(process.env.MC_PORT ?? "25565", 10),
	username: BOT,
	version: process.env.MC_VERSION ?? "1.21.11",
	auth: "offline",
});
bot.on("error", (e) => {
	if (!e.message.includes("waypoint")) console.log("ERR", e.message);
});
initLogger(`flintlab-${STRATEGY}-${Date.now()}`);

const customStep = { ...step, run: (b: never) => strat(b) };

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	await sleep(500);
	const results: { pass: boolean; ms: number; x: number; z: number; msg: string }[] = [];
	for (let i = 0; i < N; i++) {
		try {
			const r = await runGymStep(bot as never, customStep as never, cmd, {
				log: (l) => console.log(l),
			});
			results.push({ pass: r.pass, ms: r.durationMs, x: r.x, z: r.z, msg: r.message });
		} catch (e) {
			console.log("TRIAL_ERR", e instanceof Error ? e.message : String(e));
			results.push({ pass: false, ms: 0, x: 0, z: 0, msg: `err:${e}` });
		}
		await sleep(1000);
	}
	const passes = results.filter((r) => r.pass).length;
	const durs = results.map((r) => r.ms).sort((a, b) => a - b);
	const median = durs[Math.floor(durs.length / 2)] ?? 0;
	console.log(`\n===== SUMMARY strat=${STRATEGY} =====`);
	for (const [i, r] of results.entries())
		console.log(`  #${i + 1} ${r.pass ? "PASS" : "FAIL"} ${(r.ms / 1000).toFixed(1)}s @${r.x},${r.z} — ${r.msg}`);
	console.log(`  PASS ${passes}/${N}  median=${(median / 1000).toFixed(1)}s`);
	await sleep(300);
	process.exit(0);
});

setTimeout(() => {
	console.log("LAB_TIMEOUT");
	process.exit(1);
}, 60_000 + N * 130_000);
