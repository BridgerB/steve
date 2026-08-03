/**
 * Tight single-spot diagnostic. Teleport (verified) to a spot, find the nearest
 * animal, and for 40s drive straight at it while logging every 300ms:
 *   - bot XZ + how far it moved since last tick (is physics moving us?)
 *   - nearest animal name/id/dist
 *   - whether we're issuing attacks
 * Prints when an animal disappears (a kill) and whether meat lands.
 *
 * Run: node --env-file=.env --import ./typecraft-resolve.mjs exp-food/diag-chase.ts
 */
import { createBot, distance, offset } from "typecraft";
import { countItems, equipItem } from "../src/lib/steve/lib/bot-utils.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const BOT = process.env.BOT ?? "gym-food-1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FOOD = ["pig", "cow", "sheep", "chicken", "rabbit"];
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
bot.on("error", (e) => { if (!e.message.includes("waypoint")) console.log("ERR", e.message); });

const nearest = () => {
	const p = bot.entity.position;
	let best: any = null, bd = Infinity;
	for (const e of Object.values(bot.entities)) {
		if (!e.name || !FOOD.includes(e.name)) continue;
		const d = distance(p, e.position);
		if (d < bd) { bd = d; best = e; }
	}
	return best ? { e: best, d: bd } : null;
};

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	await sleep(500);
	await cmd(`gamemode survival ${BOT}`).catch(() => {});
	await cmd(`clear ${BOT}`).catch(() => {});
	await cmd(`give ${BOT} stone_sword 1`).catch(() => {});

	// Verified relocation to a spot with animals: retry until we land somewhere new
	// with an animal within 20 blocks.
	let ok = false;
	for (let a = 0; a < 8 && !ok; a++) {
		const cx = Math.floor(Math.random() * 10000);
		const cz = Math.floor(Math.random() * 10000);
		await cmd(`forceload add ${cx} ${cz}`).catch(() => {});
		await sleep(400);
		await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
		await sleep(2200);
		try { await bot.waitForChunksToLoad(); } catch {}
		await sleep(2500);
		const na = nearest();
		console.log(`attempt ${a}: @${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.z)} nearest=${na ? na.e.name + "@" + na.d.toFixed(1) : "none"} animalsVisible=${Object.values(bot.entities).filter((e:any)=>e.name&&FOOD.includes(e.name)).length}`);
		if (na && na.d < 20) ok = true;
		else await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	}
	if (!ok) { console.log("no close animal found"); process.exit(0); }

	await equipItem(bot, "sword", "hand");
	console.log(`held=${bot.heldItem?.name} hp=${bot.health}`);

	let target = nearest()!.e;
	let lastPos = { x: bot.entity.position.x, z: bot.entity.position.z };
	let lastHit = 0;
	let hits = 0;
	const startMeat = rawMeat(bot);
	bot.setControlState("sprint", true);
	const deadline = Date.now() + 40000;
	let lastLog = 0;
	while (Date.now() < deadline) {
		if (!bot.entities[target.id]) {
			console.log(`*** target ${target.id} GONE (kill?) meat=${rawMeat(bot)} ***`);
			const na = nearest();
			if (!na) { console.log("no more animals"); break; }
			target = na.e;
		}
		const live = bot.entities[target.id];
		const d = distance(bot.entity.position, live.position);
		await bot.lookAt(offset(live.position, 0, (live.height ?? 1) * 0.5, 0));
		bot.setControlState("forward", d > 1.0);
		let attacked = false;
		if (d <= 3.2 && Date.now() - lastHit >= 625) {
			bot.attack(live);
			lastHit = Date.now();
			hits++;
			attacked = true;
		}
		if (Date.now() - lastLog > 300) {
			const moved = Math.hypot(bot.entity.position.x - lastPos.x, bot.entity.position.z - lastPos.z);
			lastPos = { x: bot.entity.position.x, z: bot.entity.position.z };
			console.log(`t=${((Date.now()-(deadline-40000))/1000).toFixed(1)}s pos=${bot.entity.position.x.toFixed(1)},${bot.entity.position.z.toFixed(1)} moved=${moved.toFixed(2)} d=${d.toFixed(1)} name=${live.name} atk=${attacked} hits=${hits} onGround=${bot.entity.onGround} inWater=${bot.entity.isInWater}`);
			lastLog = Date.now();
		}
		await sleep(55);
	}
	bot.clearControlStates();
	console.log(`DONE hits=${hits} meatGained=${rawMeat(bot) - startMeat} finalMeat=${rawMeat(bot)}`);
	bot.quit();
	await sleep(500);
	process.exit(0);
});

setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 120000);
