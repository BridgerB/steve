/**
 * Coal bake-off lab. Runs one strategy across N random surface spawns using the
 * REAL gym harness (runGymStep resets, grants stone_pickaxe, random-teleports,
 * checks pass = has 3 coal). Mirrors production by registering the same
 * watchBlocks/blockSeen memory main.ts uses.
 *
 *   STRAT=idea-hybrid N=5 BOT=gym-coal-1 \
 *     node --env-file=.env --import ./typecraft-resolve.mjs exp-coal/lab.ts
 *
 * STRAT=baseline runs the current production mineBlock for comparison.
 */
import { createBot } from "typecraft";
import { GYM_BY_SLUG } from "../src/lib/steve/gym/registry.ts";
import type { GymStep } from "../src/lib/steve/gym/registry.ts";
import { runGymStep } from "../src/lib/steve/gym/run.ts";
import { rememberResource } from "../src/lib/steve/lib/bot-utils.ts";
import { initLogger } from "../src/lib/steve/lib/logger.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const STRAT = process.env.STRAT ?? process.argv[2] ?? "idea-hybrid";
const N = Number(process.env.N ?? 5);
const BOT = (process.env.BOT ?? "gym-coal-1").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);

const base = GYM_BY_SLUG.get("mine-coal");
if (!base) throw new Error("no mine-coal step");

let runFn = base.run;
if (STRAT !== "baseline") {
	const mod = await import(`./${STRAT}.ts`);
	runFn = mod.run ?? mod.default;
	if (typeof runFn !== "function") throw new Error(`bad strategy ${STRAT}`);
}
const step: GymStep = { ...base, run: runFn };

const rcon = await connect();
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
initLogger(`coallab-${STRAT}-${Date.now()}`);

// Mirror production memory: passively remember coal/iron/log sightings on chunk load.
for (const name of ["coal_ore", "deepslate_coal_ore", "iron_ore", "deepslate_iron_ore"])
	bot.watchBlocks.add(name);
bot.on("blockSeen", (name: string, pos: { x: number; y: number; z: number }) => {
	rememberResource(bot, name, pos);
});

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	console.log(`=== STRAT=${STRAT} N=${N} bot=${BOT} ===`);
	let pass = 0;
	const durs: number[] = [];
	for (let i = 0; i < N; i++) {
		// Heal + refill between trials (a fall in the prior trial leaves low health, which
		// would spuriously abort the next one). Creative fully heals; runGymStep resets to
		// survival immediately after.
		await rcon.command(`gamemode creative ${BOT}`).catch(() => {});
		await new Promise((r) => setTimeout(r, 400));
		const r = await runGymStep(bot, step, (c) => rcon.command(c), {
			log: (l) => console.log(`  ${l}`),
		});
		if (r.pass) pass++;
		durs.push(r.durationMs);
		console.log(
			`TRIAL ${i + 1}/${N} ${r.pass ? "PASS" : "FAIL"} ${(r.durationMs / 1000).toFixed(1)}s @${r.x},${r.z} — ${r.message}`,
		);
	}
	const sorted = [...durs].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
	console.log(
		`SUMMARY STRAT=${STRAT} pass=${pass}/${N} (${((100 * pass) / N).toFixed(0)}%) medianMs=${median}`,
	);
	process.exit(0);
});

setTimeout(
	() => {
		console.log("LAB TIMEOUT");
		process.exit(1);
	},
	(step.timeoutMs + 60_000) * N + 60_000,
);
