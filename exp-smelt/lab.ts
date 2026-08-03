/**
 * smelt-iron LAB. Reuses the real gym flow (runGymStep: reset → give prereqs →
 * random teleport → run under timeout → check pass) but SWAPS the step's `run` for a
 * candidate module under ./ (env IDEA). Runs N trials at random surface locations and
 * prints a pass/duration table.
 *
 * Run:
 *   IDEA=idea-argfix BOT=gym-smelt-1 N=5 \
 *     node --env-file=.env --import ./typecraft-resolve.mjs exp-smelt/lab.ts
 */
import { createBot } from "typecraft";
import { GYM_BY_SLUG } from "./../src/lib/steve/gym/registry.ts";
import { runGymStep } from "./../src/lib/steve/gym/run.ts";
import { initLogger } from "./../src/lib/steve/lib/logger.ts";
import { connect } from "./../src/lib/steve/lib/rcon.ts";

const IDEA = process.env.IDEA ?? process.argv[2] ?? "idea-argfix";
const BOT = process.env.BOT ?? "gym-smelt-1";
const N = Number(process.env.N ?? 5);
const NOTP = process.env.NOTP === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mod = await import(`./${IDEA}.ts`);
const runFn = mod.run ?? mod.default;
if (typeof runFn !== "function") {
	console.log(`idea ${IDEA} must export run(bot) or default`);
	process.exit(1);
}

const base = GYM_BY_SLUG.get("smelt-iron");
if (!base) throw new Error("no smelt-iron step");
const step = { ...base, run: runFn };

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
initLogger(`smeltlab-${IDEA}-${Date.now()}`);

bot.once("spawn", async () => {
	console.log(`[lab] ${BOT} spawned — op + ${N} trials of ${IDEA}`);
	await cmd(`op ${BOT}`).catch(() => {});
	await sleep(500);
	const rows: { i: number; pass: boolean; ms: number; x: number; z: number; msg: string }[] = [];
	for (let i = 1; i <= N; i++) {
		const r = await runGymStep(bot, step, cmd, {
			noTeleport: NOTP,
			log: (l) => console.log(l),
		});
		rows.push({ i, pass: r.pass, ms: r.durationMs, x: r.x, z: r.z, msg: r.message });
		await sleep(1000);
	}
	console.log(`\n==== ${IDEA} results ====`);
	for (const r of rows) {
		console.log(
			`  #${r.i} ${r.pass ? "PASS" : "FAIL"} ${(r.ms / 1000).toFixed(1)}s @${r.x},${r.z} — ${r.msg}`,
		);
	}
	const passes = rows.filter((r) => r.pass).length;
	const durs = rows.filter((r) => r.pass).map((r) => r.ms).sort((a, b) => a - b);
	const med = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
	console.log(`  PASS ${passes}/${N}  medianPassDur ${(med / 1000).toFixed(1)}s`);
	await sleep(500);
	bot.quit();
	process.exit(0);
});

setTimeout(() => {
	console.log("[lab] hard timeout");
	process.exit(1);
}, 15 * 60 * 1000);
