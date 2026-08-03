/**
 * Does bot.attack actually deal damage / kill? Summon a cow at the bot's feet via
 * RCON so navigation is irrelevant, then swing on the sword cooldown up to 10 times
 * and report whether the cow dies and whether beef drops + gets collected.
 * Repeat a few times.
 *
 * Run: node --env-file=.env --import ./typecraft-resolve.mjs exp-food/diag-swing.ts
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

const nearestCow = () => {
	let best: any = null, bd = Infinity;
	for (const e of Object.values(bot.entities)) { if (e.name !== "cow") continue; const d = distance(bot.entity.position, e.position); if (d < bd) { bd = d; best = e; } }
	return best;
};

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad(); await sleep(500);
	await cmd(`gamemode survival ${BOT}`).catch(() => {});
	await cmd(`clear ${BOT}`).catch(() => {}); await cmd(`give ${BOT} stone_sword 1`).catch(() => {});
	// Land on flat solid ground so the cow spawns next to us.
	const cx = Math.floor(Math.random() * 10000), cz = Math.floor(Math.random() * 10000);
	await cmd(`forceload add ${cx} ${cz}`).catch(() => {}); await sleep(400);
	await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
	await sleep(2200); try { await bot.waitForChunksToLoad(); } catch {} await sleep(2000);
	await equipItem(bot, "sword", "hand");
	console.log(`held=${bot.heldItem?.name} pos=${bot.entity.position.x.toFixed(1)},${bot.entity.position.y.toFixed(1)},${bot.entity.position.z.toFixed(1)}`);

	for (let round = 0; round < 3; round++) {
		const p = bot.entity.position;
		const startMeat = rawMeat(bot);
		await cmd(`summon minecraft:cow ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${(p.z + 1.2).toFixed(2)}`).catch((e) => console.log("summon err", e));
		await sleep(800);
		const cow = nearestCow();
		if (!cow) { console.log(`round ${round}: NO COW appeared (summon failed?)`); continue; }
		console.log(`round ${round}: cow #${cow.id} at d=${distance(bot.entity.position, cow.position).toFixed(1)}`);
		let hits = 0;
		for (let i = 0; i < 10; i++) {
			if (!bot.entities[cow.id]) break;
			const live = bot.entities[cow.id];
			await bot.lookAt(offset(live.position, 0, (live.height ?? 1) * 0.5, 0));
			bot.attack(live);
			hits++;
			await sleep(650);
		}
		const dead = !bot.entities[cow.id];
		// walk over drop
		if (dead) { bot.setControlState("forward", true); await sleep(700); bot.setControlState("forward", false); await sleep(800); }
		console.log(`round ${round}: hits=${hits} cowDead=${dead} beefGained=${rawMeat(bot) - startMeat}`);
		await sleep(500);
	}
	await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	bot.quit(); await sleep(500); process.exit(0);
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 90000);
