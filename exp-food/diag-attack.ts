/**
 * Does the bot CLOSE to melee range, and do attacks KILL? Land near an animal,
 * then chase with per-tick logging: distance, movement, whether we attacked, and
 * whether the target entity ever disappears (a kill). Also tries a "corner" test:
 * once within 3 blocks, stop and swing 6 times to see if a stationary target dies.
 *
 * Run: node --env-file=.env --import ./typecraft-resolve.mjs exp-food/diag-attack.ts
 */
import { createBot, distance, offset } from "typecraft";
import { countItems, equipItem } from "../src/lib/steve/lib/bot-utils.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const BOT = process.env.BOT ?? "gym-food-1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FOOD = ["pig", "cow", "sheep", "chicken", "rabbit"];
const rawMeat = (bot: any) => countItems(bot, "beef") + countItems(bot, "mutton") + countItems(bot, "chicken") + countItems(bot, "porkchop");
const rcon = await connect();
const cmd = (c: string) => rcon.command(c);
const bot = createBot({ host: process.env.MC_HOST ?? "localhost", port: parseInt(process.env.MC_PORT ?? "25565", 10), username: BOT, version: process.env.MC_VERSION ?? "1.21.11", auth: "offline" });
bot.on("error", (e) => { if (!e.message.includes("waypoint")) console.log("ERR", e.message); });
const nearest = () => { const p = bot.entity.position; let best: any = null, bd = Infinity; for (const e of Object.values(bot.entities)) { if (!e.name || !FOOD.includes(e.name)) continue; const d = distance(p, e.position); if (d < bd) { bd = d; best = e; } } return best ? { e: best, d: bd } : null; };

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad(); await sleep(500);
	await cmd(`gamemode survival ${BOT}`).catch(() => {});
	await cmd(`clear ${BOT}`).catch(() => {}); await cmd(`give ${BOT} stone_sword 1`).catch(() => {});
	let prev = { x: bot.entity.position.x, z: bot.entity.position.z }; let ok = false;
	for (let a = 0; a < 12 && !ok; a++) {
		const cx = Math.floor(Math.random() * 10000), cz = Math.floor(Math.random() * 10000);
		await cmd(`forceload add ${cx} ${cz}`).catch(() => {}); await sleep(400);
		await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
		await sleep(2200); try { await bot.waitForChunksToLoad(); } catch {} await sleep(2500);
		const moved = Math.hypot(bot.entity.position.x - prev.x, bot.entity.position.z - prev.z); prev = { x: bot.entity.position.x, z: bot.entity.position.z };
		const na = nearest();
		console.log(`attempt ${a}: relocated=${moved.toFixed(0)} nearest=${na ? na.e.name + "@" + na.d.toFixed(1) : "none"}`);
		if (na && na.d < 16 && moved > 50) ok = true; else await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	}
	if (!ok) { console.log("setup failed"); process.exit(0); }
	await equipItem(bot, "sword", "hand");
	console.log(`held=${bot.heldItem?.name}`);

	let target = nearest()!.e;
	const targetName = target.name;
	let hits = 0, lastHit = 0, minD = Infinity, closeTicks = 0;
	let lastPos = { x: bot.entity.position.x, z: bot.entity.position.z };
	bot.setControlState("sprint", true);
	const deadline = Date.now() + 30000; let lastLog = 0;
	while (Date.now() < deadline) {
		if (!bot.entities[target.id]) { console.log(`*** ${targetName} #${target.id} GONE at hits=${hits} meat=${rawMeat(bot)} ***`); break; }
		const live = bot.entities[target.id];
		const d = distance(bot.entity.position, live.position);
		minD = Math.min(minD, d);
		await bot.lookAt(offset(live.position, 0, (live.height ?? 1) * 0.5, 0));
		bot.setControlState("forward", d > 1.0);
		let atk = false;
		if (d <= 3.2 && Date.now() - lastHit >= 625) { bot.attack(live); lastHit = Date.now(); hits++; atk = true; }
		if (d <= 3.2) closeTicks++;
		if (Date.now() - lastLog > 400) {
			const moved = Math.hypot(bot.entity.position.x - lastPos.x, bot.entity.position.z - lastPos.z); lastPos = { x: bot.entity.position.x, z: bot.entity.position.z };
			console.log(`d=${d.toFixed(1)} minD=${minD.toFixed(1)} moved=${moved.toFixed(2)} atk=${atk} hits=${hits} onGround=${bot.entity.onGround} inWater=${bot.entity.isInWater} yTarget=${live.position.y.toFixed(1)} yBot=${bot.entity.position.y.toFixed(1)}`);
			lastLog = Date.now();
		}
		await sleep(55);
	}
	bot.setControlState("forward", false); bot.setControlState("sprint", false);
	console.log(`SUMMARY hits=${hits} minDist=${minD.toFixed(1)} closeTicks=${closeTicks} meat=${rawMeat(bot)} targetAlive=${!!bot.entities[target.id]}`);
	bot.quit(); await sleep(500); process.exit(0);
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 150000);
