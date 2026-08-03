/**
 * Food strategy LAB. Mirrors the gym's gather-food exercise so results are
 * comparable: for each trial it resets the bot, gives a stone_sword, teleports to
 * a RANDOM surface spot (0-10k), runs ONE pluggable strategy under a 90s cap, and
 * checks the gym pass criterion (>=1 raw meat: beef/mutton/chicken/porkchop).
 *
 * Run:
 *   STRATEGY=<name> TRIALS=6 BOT=gym-food-1 \
 *     node --env-file=.env --import ./typecraft-resolve.mjs exp-food/food-lab.ts
 *
 * Strategy module: ./exp-food/<name>.ts default-exports async (bot)=>StepResult.
 * "real" runs the production gatherFood for baseline.
 */
import { createBot } from "typecraft";
import { countItems } from "../src/lib/steve/lib/bot-utils.ts";
import { initLogger } from "../src/lib/steve/lib/logger.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const STRATEGY = process.env.STRATEGY ?? process.argv[2] ?? "real";
const TRIALS = Number(process.env.TRIALS ?? process.argv[3] ?? 6);
const BOT = process.env.BOT ?? "gym-food-1";
const TIMEOUT = Number(process.env.TIMEOUT ?? 90000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rawMeat = (bot: any) =>
	countItems(bot, "beef") + countItems(bot, "mutton") + countItems(bot, "chicken") + countItems(bot, "porkchop");

const load = async (): Promise<(bot: any) => Promise<any>> => {
	if (STRATEGY === "real") {
		const m = await import("../src/lib/steve/tasks/food/main.ts");
		return (bot) => m.gatherFood(bot, 3);
	}
	const m = await import(`./${STRATEGY}.ts`);
	const fn = m.default ?? m.hunt ?? m.strategy;
	return (bot) => fn(bot);
};
const strat = await load();

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
initLogger(`food-lab-${STRATEGY}-${Date.now()}`);

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	await sleep(500);
	let passes = 0;
	const durs: number[] = [];
	let prev = { x: bot.entity.position.x, z: bot.entity.position.z };
	for (let t = 0; t < TRIALS; t++) {
		await cmd(`gamemode survival ${BOT}`).catch(() => {});
		await cmd(`clear ${BOT}`).catch(() => {});
		await sleep(300);
		await cmd(`give ${BOT} stone_sword 1`).catch(() => {});
		// VERIFIED relocation: spreadplayers intermittently fails to move the bot,
		// which would corrupt a trial (same spot repeated). Retry until the bot lands
		// >200 blocks from the previous trial's spot.
		let cx = 0, cz = 0;
		for (let r = 0; r < 8; r++) {
			cx = Math.floor(Math.random() * 10000);
			cz = Math.floor(Math.random() * 10000);
			await cmd(`forceload add ${cx} ${cz}`).catch(() => {});
			await sleep(400);
			await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
			await sleep(2000);
			try { await bot.waitForChunksToLoad(); } catch {}
			await sleep(2000);
			const moved = Math.hypot(bot.entity.position.x - prev.x, bot.entity.position.z - prev.z);
			if (moved > 200) break;
			await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
		}
		prev = { x: bot.entity.position.x, z: bot.entity.position.z };

		const p0 = bot.entity.position;
		const FOOD = ["pig", "cow", "sheep", "chicken", "rabbit"];
		const visible = Object.values(bot.entities).filter((e: any) => e.name && FOOD.includes(e.name)).length;

		const t0 = Date.now();
		let msg = "";
		try {
			const res = await Promise.race([
				strat(bot),
				sleep(TIMEOUT).then(() => ({ success: false, message: "timeout" })),
			]);
			msg = (res as any)?.message ?? "";
		} catch (e) {
			msg = e instanceof Error ? e.message : String(e);
		}
		bot.clearControlStates?.();
		const dur = Date.now() - t0;
		const meat = rawMeat(bot);
		const pass = meat >= 1;
		if (pass) { passes++; durs.push(dur); }
		console.log(
			`[${STRATEGY}] trial ${t + 1}/${TRIALS} ${pass ? "PASS" : "FAIL"} meat=${meat} visible@start=${visible} dur=${(dur / 1000).toFixed(1)}s @${Math.round(p0.x)},${Math.round(p0.z)} msg="${msg}"`,
		);
		await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
		await sleep(500);
	}
	const med = durs.length ? durs.sort((a, b) => a - b)[Math.floor(durs.length / 2)]! : 0;
	console.log(`\nSUMMARY [${STRATEGY}] pass=${passes}/${TRIALS} (${Math.round((100 * passes) / TRIALS)}%) medianPassDur=${(med / 1000).toFixed(1)}s`);
	bot.quit();
	await sleep(500);
	process.exit(0);
});

setTimeout(() => { console.log("TIMEOUT_LAB"); process.exit(1); }, 60000 + TRIALS * (TIMEOUT + 12000));
