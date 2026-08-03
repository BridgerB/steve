/**
 * mine-iron strategy LAB. Uses the REAL gym harness (runGymStep) so each trial does
 * exactly what the gym does: reset the bot, /give a stone_pickaxe, random-teleport to
 * a fresh surface spot (0..10k), run one strategy under the 150s timeout, and check
 * pass = raw_iron >= 3. Runs N trials with one bot (respects the 2-bot cap).
 *
 * Run:
 *   STRAT=digdown TRIALS=5 \
 *     node --env-file=.env --import ./typecraft-resolve.mjs exp-iron/lab.ts
 *
 * The strategy lives in ./strategies/<name>.ts and exports async `run(bot)`.
 */
import { createBot } from "typecraft";
import type { GymStep } from "../src/lib/steve/gym/registry.ts";
import { runGymStep } from "../src/lib/steve/gym/run.ts";
import { countInventoryItems } from "../src/lib/steve/lib/test-utils.ts";
import { initLogger } from "../src/lib/steve/lib/logger.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const STRAT = process.env.STRAT ?? process.argv[2] ?? "digdown";
const TRIALS = Number(process.env.TRIALS ?? 5);
const BOT = (process.env.BOT ?? `gym-iron-1`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);

const mod = await import(`./strategies/${STRAT}.ts`);
const run = mod.run ?? mod.default;
if (typeof run !== "function") {
	console.log(`strategy ${STRAT} must export run(bot)`);
	process.exit(1);
}

const step: GymStep = {
	slug: `mine-iron-exp-${STRAT}`,
	label: "Mine Iron (exp)",
	order: 11,
	prereq: ["stone_pickaxe 1"],
	run,
	pass: (b) => countInventoryItems(b, "raw_iron") >= 3,
	timeoutMs: 150000,
};

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
initLogger(`exp-iron-${STRAT}-${Date.now()}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Robust random surface teleport: spreadplayers occasionally fails ("too many
// entities for space") when a column has no clean surface, leaving the bot at spawn.
// Re-roll a fresh coordinate until it actually lands somewhere new.
const randomTp = async (): Promise<{ x: number; z: number } | null> => {
	for (let attempt = 0; attempt < 8; attempt++) {
		const cx = Math.floor(Math.random() * 10000);
		const cz = Math.floor(Math.random() * 10000);
		await rcon.command(`forceload add ${cx} ${cz}`).catch(() => {});
		await sleep(400);
		const sp = await rcon.command(`spreadplayers ${cx} ${cz} 0 1 false ${bot.username}`).catch((e) => `ERR ${e}`);
		await sleep(1600);
		try {
			await (bot as unknown as { waitForChunksToLoad?: () => Promise<void> }).waitForChunksToLoad?.();
		} catch {}
		await sleep(1200);
		const p = bot.entity?.position;
		if (sp && !sp.includes("Could not spread") && p && (Math.abs(p.x - cx) < 40 && Math.abs(p.z - cz) < 40)) {
			return { x: cx, z: cz };
		}
		await rcon.command(`forceload remove ${cx} ${cz}`).catch(() => {});
	}
	return null;
};

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	const results: { pass: boolean; ms: number; x: number; z: number; msg: string }[] = [];
	for (let i = 0; i < TRIALS; i++) {
		const loc = await randomTp();
		if (!loc) {
			console.log(`TRIAL ${i + 1}/${TRIALS} SKIP — could not find a random surface spot`);
			continue;
		}
		const r = await runGymStep(bot, step, (c) => rcon.command(c), {
			noTeleport: true,
			log: (l) => console.log(`  ${l}`),
		});
		await rcon.command(`forceload remove ${loc.x} ${loc.z}`).catch(() => {});
		results.push({ pass: r.pass, ms: r.durationMs, x: r.x, z: r.z, msg: r.message });
		console.log(
			`TRIAL ${i + 1}/${TRIALS} ${r.pass ? "PASS" : "FAIL"} ${(r.durationMs / 1000).toFixed(1)}s @${r.x},${r.z} raw_iron=${countInventoryItems(bot, "raw_iron")} — ${r.message}`,
		);
	}
	const passes = results.filter((r) => r.pass).length;
	const durs = results.map((r) => r.ms).sort((a, b) => a - b);
	const median = durs[Math.floor(durs.length / 2)] ?? 0;
	console.log(
		`\nSUMMARY strat=${STRAT} trials=${TRIALS} pass=${passes}/${TRIALS} (${((passes / TRIALS) * 100).toFixed(0)}%) medianMs=${median}`,
	);
	for (const r of results)
		console.log(`  ${r.pass ? "PASS" : "FAIL"} ${(r.ms / 1000).toFixed(1)}s @${r.x},${r.z} — ${r.msg}`);
	process.exit(0);
});

setTimeout(() => {
	console.log("TIMEOUT — never finished");
	process.exit(1);
}, TRIALS * (step.timeoutMs + 25000) + 60000);
