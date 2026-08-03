/**
 * Focused re-test of the 5 hardest gym steps after the integration, to see if the
 * winners actually moved the needle in-situ (vs the agents' isolated measurements).
 * One bot, sequential round-robin — safe on the shared box. Records to gym.db (ts>now),
 * so: sqlite3 data/gym.db "SELECT slug,count(*),sum(pass) FROM gym_runs WHERE ts>START ..."
 *
 *   ROUNDS=6 node --env-file=.env --import ./typecraft-resolve.mjs subset-test.ts
 */
import { createBot } from "typecraft";
import { GYM_BY_SLUG } from "./src/lib/steve/gym/registry.ts";
import { runGymStep } from "./src/lib/steve/gym/run.ts";
import { registerBlockMemory } from "./src/lib/steve/lib/bot-utils.ts";
import { initLogger } from "./src/lib/steve/lib/logger.ts";
import { connect } from "./src/lib/steve/lib/rcon.ts";

const SLUGS = ["smelt-iron", "mine-coal", "mine-iron", "flint-and-steel", "gather-food"];
const ROUNDS = Number(process.env.ROUNDS ?? 6);
const BOT = process.env.BOT ?? "gym-subset-1";

const tally: Record<string, { pass: number; n: number; ms: number[] }> = {};
for (const s of SLUGS) tally[s] = { pass: 0, n: 0, ms: [] };

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
registerBlockMemory(bot);
initLogger(`subset-${Date.now()}`);

const summary = () => {
	console.log("\n===== SUBSET RESULTS (post-integration) =====");
	for (const s of SLUGS) {
		const t = tally[s];
		const rate = t.n ? Math.round((100 * t.pass) / t.n) : 0;
		const med = t.ms.length
			? Math.round(t.ms.slice().sort((a, b) => a - b)[Math.floor(t.ms.length / 2)] / 1000)
			: 0;
		console.log(`${s.padEnd(18)} ${t.pass}/${t.n}  ${String(rate).padStart(3)}%  ~${med}s`);
	}
	console.log("=============================================\n");
};

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	console.log(`START ${Date.now()} — ${ROUNDS} rounds × ${SLUGS.length} steps`);
	for (let r = 0; r < ROUNDS; r++) {
		for (const slug of SLUGS) {
			const step = GYM_BY_SLUG.get(slug);
			if (!step) continue;
			const res = await runGymStep(bot, step, (c) => rcon.command(c), {
				log: (l) => console.log(l),
			});
			const t = tally[slug];
			t.n++;
			if (res.pass) {
				t.pass++;
				t.ms.push(res.durationMs);
			}
			console.log(`[round ${r + 1}/${ROUNDS}] ${slug} → ${res.pass ? "PASS" : "FAIL"} ${(res.durationMs / 1000).toFixed(0)}s`);
		}
		summary();
	}
	summary();
	console.log("DONE");
	process.exit(0);
});

setTimeout(() => {
	console.log("HARD TIMEOUT");
	summary();
	process.exit(1);
}, ROUNDS * SLUGS.length * 180000 + 120000);
