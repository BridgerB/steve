/**
 * Run the REAL gatherFood at random spots and watch it, with a 1s heartbeat
 * (health, food count, nearest animal + distance). Reveals whether it approaches,
 * whether attacks land (animal count drops), and whether meat is collected.
 *
 * Run: node --env-file=.env --import ./typecraft-resolve.mjs exp-food/probe-real.ts [trials]
 */
import { createBot, distance } from "typecraft";
import { gatherFood } from "../src/lib/steve/tasks/food/main.ts";
import { countItems } from "../src/lib/steve/lib/bot-utils.ts";
import { initLogger } from "../src/lib/steve/lib/logger.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const TRIALS = Number(process.argv[2] ?? 3);
const BOT = process.env.BOT ?? "gym-food-1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FOOD_ANIMALS = ["pig", "cow", "sheep", "chicken", "rabbit"];
const rawMeat = (bot: any) =>
	countItems(bot, "beef") + countItems(bot, "mutton") + countItems(bot, "chicken") + countItems(bot, "porkchop");

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
initLogger(`exp-food-probe-${Date.now()}`);

const nearestAnimal = () => {
	const p = bot.entity.position;
	let best: any = null;
	let bd = Infinity;
	for (const e of Object.values(bot.entities)) {
		if (!e.name || !FOOD_ANIMALS.includes(e.name)) continue;
		const d = distance(p, e.position);
		if (d < bd) { bd = d; best = e; }
	}
	return best ? { name: best.name, d: Math.round(bd) } : null;
};

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	await sleep(500);

	for (let t = 0; t < TRIALS; t++) {
		const cx = Math.floor(Math.random() * 10000);
		const cz = Math.floor(Math.random() * 10000);
		await cmd(`gamemode survival ${BOT}`).catch(() => {});
		await cmd(`clear ${BOT}`).catch(() => {});
		await sleep(300);
		await cmd(`give ${BOT} stone_sword 1`).catch(() => {});
		await cmd(`forceload add ${cx} ${cz}`).catch(() => {});
		await sleep(400);
		await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
		await sleep(2000);
		try { await bot.waitForChunksToLoad(); } catch {}
		await sleep(2500);

		const p0 = bot.entity.position;
		const census = Object.values(bot.entities).filter((e) => e.name && FOOD_ANIMALS.includes(e.name)).length;
		console.log(`\n=== trial ${t + 1} @${Math.round(p0.x)},${Math.round(p0.y)},${Math.round(p0.z)} animalsVisible=${census} ===`);

		let stop = false;
		const hb = (async () => {
			while (!stop) {
				const na = nearestAnimal();
				const pp = bot.entity.position;
				console.log(`  hb hp=${Math.round(bot.health ?? 0)} meat=${rawMeat(bot)} pos=${Math.round(pp.x)},${Math.round(pp.z)} nearest=${na ? na.name + "@" + na.d : "none"}`);
				await sleep(3000);
			}
		})();

		const t0 = Date.now();
		let msg = "";
		try {
			const res = await Promise.race([
				gatherFood(bot, 3),
				sleep(90000).then(() => ({ success: false, message: "gym timeout" })),
			]);
			msg = (res as any)?.message ?? "";
		} catch (e) {
			msg = e instanceof Error ? e.message : String(e);
		}
		stop = true;
		await hb;
		const dur = Date.now() - t0;
		const meat = rawMeat(bot);
		console.log(`RESULT trial ${t + 1}: ${meat >= 1 ? "PASS" : "FAIL"} meat=${meat} dur=${(dur / 1000).toFixed(1)}s msg="${msg}"`);
		await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	}
	console.log("\nALLDONE");
	bot.quit();
	await sleep(500);
	process.exit(0);
});

setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 130000 + TRIALS * 100000);
