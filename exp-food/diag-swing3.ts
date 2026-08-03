/**
 * Test the fix hypothesis: forced look (bot.lookAt(pos, true)) applies rotation
 * instantly + sends the rot packet, vs the gradual lerp that hangs. Summon a cow
 * adjacent, force-look at it each hit, attack, and see if it dies.
 */
import { createBot, distance, offset } from "typecraft";
import { countItems, equipItem } from "../src/lib/steve/lib/bot-utils.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const BOT = process.env.BOT ?? "gym-food-1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rawMeat = (bot: any) => countItems(bot, "beef") + countItems(bot, "mutton") + countItems(bot, "chicken") + countItems(bot, "porkchop");
const rcon = await connect();
const cmd = (c: string) => rcon.command(c);
const bot = createBot({ host: process.env.MC_HOST ?? "localhost", port: parseInt(process.env.MC_PORT ?? "25565", 10), username: BOT, version: process.env.MC_VERSION ?? "1.21.11", auth: "offline" });
bot.on("error", (e) => { if (!e.message.includes("waypoint")) console.log("ERR", e.message); });
const nearestCow = () => { let best: any = null, bd = Infinity; for (const e of Object.values(bot.entities)) { if (e.name !== "cow") continue; const d = distance(bot.entity.position, e.position); if (d < bd) { bd = d; best = e; } } return best; };

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad(); await sleep(500);
	await cmd(`gamemode survival ${BOT}`).catch(() => {});
	await cmd(`clear ${BOT}`).catch(() => {}); await cmd(`give ${BOT} stone_sword 1`).catch(() => {});
	const cx = Math.floor(Math.random() * 10000), cz = Math.floor(Math.random() * 10000);
	await cmd(`forceload add ${cx} ${cz}`).catch(() => {}); await sleep(400);
	await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
	await sleep(2200); try { await bot.waitForChunksToLoad(); } catch {} await sleep(2000);
	await equipItem(bot, "sword", "hand");
	const p = bot.entity.position;
	console.log(`setup held=${bot.heldItem?.name} pos=${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
	const startMeat = rawMeat(bot);
	await cmd(`summon minecraft:cow ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${(p.z + 1.4).toFixed(2)}`).catch((e) => console.log("summon err", e));
	await sleep(1000);
	const cow = nearestCow();
	if (!cow) { console.log("NO COW"); process.exit(0); }
	console.log(`cow #${cow.id} d=${distance(bot.entity.position, cow.position).toFixed(2)}`);
	for (let i = 0; i < 12; i++) {
		if (!bot.entities[cow.id]) { console.log(`hit ${i}: cow GONE`); break; }
		const live = bot.entities[cow.id];
		const yawBefore = bot.entity.yaw.toFixed(2);
		await bot.lookAt(offset(live.position, 0, (live.height ?? 1) * 0.5, 0), true); // FORCE
		await sleep(60); // let the rot packet flush
		bot.attack(live);
		console.log(`hit ${i}: d=${distance(bot.entity.position, live.position).toFixed(2)} yaw ${yawBefore}->${bot.entity.yaw.toFixed(2)} cowAlive=${!!bot.entities[cow.id]} meat=${rawMeat(bot)}`);
		await sleep(650);
	}
	const dead = !bot.entities[cow.id];
	if (dead) { bot.setControlState("forward", true); await sleep(900); bot.setControlState("forward", false); await sleep(1200); }
	console.log(`RESULT cowDead=${dead} beefGained=${rawMeat(bot) - startMeat} finalMeat=${rawMeat(bot)}`);
	await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	bot.quit(); await sleep(500); process.exit(0);
});
setTimeout(() => { console.log("HARD_TIMEOUT"); process.exit(1); }, 60000);
