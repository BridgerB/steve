/**
 * Isolate the failure: physics vs pathfinder vs attack.
 * Teleport to a spot with an animal within 60 blocks, then:
 *  1. raw forward+sprint 3s  -> does the bot move at all?
 *  2. goTo a fixed point 12 blocks ahead -> does the pathfinder move it?
 *  3. run hunt-v2 raw chase on nearest animal 45s -> kills? meat?
 *
 * Run: node --env-file=.env --import ./typecraft-resolve.mjs exp-food/diag-move.ts
 */
import { createBot, distance } from "typecraft";
import { countItems, equipItem, goTo } from "../src/lib/steve/lib/bot-utils.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";
import hunt from "./hunt-v2.ts";

const BOT = process.env.BOT ?? "gym-food-1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FOOD = ["pig", "cow", "sheep", "chicken", "rabbit"];
const rawMeat = (bot: any) => countItems(bot, "beef") + countItems(bot, "mutton") + countItems(bot, "chicken") + countItems(bot, "porkchop");
const rcon = await connect();
const cmd = (c: string) => rcon.command(c);
const bot = createBot({ host: process.env.MC_HOST ?? "localhost", port: parseInt(process.env.MC_PORT ?? "25565", 10), username: BOT, version: process.env.MC_VERSION ?? "1.21.11", auth: "offline" });
bot.on("error", (e) => { if (!e.message.includes("waypoint")) console.log("ERR", e.message); });
const nearest = () => {
	const p = bot.entity.position; let best: any = null, bd = Infinity;
	for (const e of Object.values(bot.entities)) { if (!e.name || !FOOD.includes(e.name)) continue; const d = distance(p, e.position); if (d < bd) { bd = d; best = e; } }
	return best ? { e: best, d: bd } : null;
};

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad(); await sleep(500);
	await cmd(`gamemode survival ${BOT}`).catch(() => {});
	await cmd(`clear ${BOT}`).catch(() => {});
	await cmd(`give ${BOT} stone_sword 1`).catch(() => {});
	let prev = { x: bot.entity.position.x, z: bot.entity.position.z };
	let ok = false;
	for (let a = 0; a < 12 && !ok; a++) {
		const cx = Math.floor(Math.random() * 10000), cz = Math.floor(Math.random() * 10000);
		await cmd(`forceload add ${cx} ${cz}`).catch(() => {});
		await sleep(400);
		await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
		await sleep(2200); try { await bot.waitForChunksToLoad(); } catch {} await sleep(2500);
		const moved = Math.hypot(bot.entity.position.x - prev.x, bot.entity.position.z - prev.z);
		prev = { x: bot.entity.position.x, z: bot.entity.position.z };
		const na = nearest();
		console.log(`attempt ${a}: @${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.z)} relocated=${moved.toFixed(0)} nearest=${na ? na.e.name + "@" + na.d.toFixed(1) : "none"}`);
		if (na && na.d < 60 && moved > 50) ok = true;
		else await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	}
	if (!ok) { console.log("setup failed"); process.exit(0); }
	await equipItem(bot, "sword", "hand");

	// TEST 1: raw forward+sprint 3s
	const p1 = { x: bot.entity.position.x, z: bot.entity.position.z };
	await bot.lookAt({ x: p1.x + 10, y: bot.entity.position.y, z: p1.z } as never);
	bot.setControlState("sprint", true); bot.setControlState("forward", true);
	await sleep(3000);
	bot.setControlState("forward", false); bot.setControlState("sprint", false);
	const moved1 = Math.hypot(bot.entity.position.x - p1.x, bot.entity.position.z - p1.z);
	console.log(`TEST1 raw-walk moved=${moved1.toFixed(1)} blocks in 3s (expect ~15 if physics works)`);

	// TEST 2: goTo a fixed point 12 blocks ahead
	const p2 = bot.entity.position;
	const tgt = { x: p2.x + 12, y: p2.y, z: p2.z };
	const t0 = Date.now();
	const reached = await goTo(bot, tgt as never, { range: 2, timeout: 12000 });
	const moved2 = Math.hypot(bot.entity.position.x - p2.x, bot.entity.position.z - p2.z);
	console.log(`TEST2 goTo returned=${reached} moved=${moved2.toFixed(1)} blocks in ${((Date.now()-t0)/1000).toFixed(1)}s`);

	// TEST 3: hunt-v2 raw chase 45s
	const startMeat = rawMeat(bot);
	const t1 = Date.now();
	const res = await Promise.race([hunt(bot), sleep(45000).then(() => ({ message: "cap" }))]);
	console.log(`TEST3 hunt-v2 msg="${(res as any).message}" meatGained=${rawMeat(bot) - startMeat} in ${((Date.now()-t1)/1000).toFixed(1)}s`);
	bot.clearControlStates();
	bot.quit(); await sleep(500); process.exit(0);
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 180000);
