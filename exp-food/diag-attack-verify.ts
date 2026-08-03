/**
 * Ground truth: does bot.attack reduce a mob's Health? Summon a tagged cow, read
 * its Health via RCON before and after a burst of attacks. Also hook client.write
 * to confirm the interact/swing packets are actually emitted.
 */
import { createBot, distance, offset } from "typecraft";
import { equipItem } from "../src/lib/steve/lib/bot-utils.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const BOT = process.env.BOT ?? "gym-food-1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rcon = await connect();
const cmd = (c: string) => rcon.command(c);
const bot = createBot({ host: process.env.MC_HOST ?? "localhost", port: parseInt(process.env.MC_PORT ?? "25565", 10), username: BOT, version: process.env.MC_VERSION ?? "1.21.11", auth: "offline" });
bot.on("error", (e) => { if (!e.message.includes("waypoint")) console.log("ERR", e.message); });

let interactWrites = 0, swingWrites = 0;
const origWrite = bot.client.write.bind(bot.client);
(bot.client as any).write = (name: string, data: any) => {
	if (name === "interact") interactWrites++;
	if (name === "swing") swingWrites++;
	return origWrite(name, data);
};
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
	console.log(`setup pos=${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} held=${bot.heldItem?.name}`);
	await cmd(`summon minecraft:cow ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${(p.z + 1.4).toFixed(2)} {Tags:["gymcow"]}`).catch((e) => console.log("summon err", e));
	await sleep(1000);
	const cow = nearestCow();
	if (!cow) { console.log("NO COW"); process.exit(0); }
	const hp0 = await cmd(`data get entity @e[tag=gymcow,limit=1] Health`).catch((e) => `ERR ${e}`);
	console.log(`cow #${cow.id} d=${distance(bot.entity.position, cow.position).toFixed(2)} HP0: ${hp0}`);
	for (let i = 0; i < 6; i++) {
		if (!bot.entities[cow.id]) { console.log(`hit ${i}: GONE`); break; }
		const live = bot.entities[cow.id];
		await bot.lookAt(offset(live.position, 0, (live.height ?? 1) * 0.5, 0), true);
		await sleep(60);
		bot.attack(live);
		await sleep(700);
	}
	const hp1 = await cmd(`data get entity @e[tag=gymcow,limit=1] Health`).catch((e) => `ERR ${e}`);
	console.log(`AFTER: interactWrites=${interactWrites} swingWrites=${swingWrites} cowAlive=${!!nearestCow()} HP1: ${hp1}`);
	await cmd(`kill @e[tag=gymcow]`).catch(() => {});
	await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	bot.quit(); await sleep(500); process.exit(0);
});
setTimeout(() => { console.log("HARD_TIMEOUT"); process.exit(1); }, 60000);
