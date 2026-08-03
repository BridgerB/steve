/**
 * Rule out server-side reach failure: read the bot's SERVER position and the cow's,
 * confirm they're ~1.3 apart (well within the 3-block attack reach), then attack and
 * read HP. If they're close AND HP doesn't drop, the attack packet itself is being
 * ignored/misparsed by this server version (not a reach problem).
 */
import { createBot, distance, offset } from "typecraft";
import { equipItem, sleep } from "../src/lib/steve/lib/bot-utils.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const BOT = process.env.BOT ?? "gym-food-1";
const rcon = await connect();
const cmd = (c: string) => rcon.command(c);
const bot = createBot({ host: process.env.MC_HOST ?? "localhost", port: parseInt(process.env.MC_PORT ?? "25565", 10), username: BOT, version: process.env.MC_VERSION ?? "1.21.11", auth: "offline" });
bot.on("error", (e) => { if (!e.message.includes("waypoint")) console.log("ERR", e.message); });
const nearestCow = () => { let best: any = null, bd = Infinity; for (const e of Object.values(bot.entities)) { if (e.name !== "cow") continue; const d = distance(bot.entity.position, e.position); if (d < bd) { bd = d; best = e; } } return best; };
const hp = async () => { const r = await cmd(`data get entity @e[tag=rcow,limit=1] Health`).catch(() => "ERR"); const m = r.match(/([\d.]+)f/); return m ? parseFloat(m[1]) : NaN; };

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
	await cmd(`summon minecraft:cow ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${(p.z + 1.3).toFixed(2)} {Tags:["rcow"],NoAI:1b}`).catch(() => {});
	await sleep(800);
	const cow = nearestCow();
	if (!cow) { console.log("NO COW"); process.exit(0); }
	const botPos = await cmd(`data get entity ${BOT} Pos`).catch(() => "ERR");
	const cowPos = await cmd(`data get entity @e[tag=rcow,limit=1] Pos`).catch(() => "ERR");
	const heldSel = await cmd(`data get entity ${BOT} SelectedItem`).catch(() => "ERR");
	console.log(`botPos: ${botPos}`);
	console.log(`cowPos: ${cowPos}`);
	console.log(`selectedItem: ${heldSel}`);
	console.log(`clientDist=${distance(bot.entity.position, cow.position).toFixed(2)}`);
	const h0 = await hp();
	for (let i = 0; i < 4; i++) { await bot.lookAt(offset(cow.position, 0, 0.7, 0), true); await sleep(80); bot.attack(cow); await sleep(700); }
	console.log(`HP ${h0} -> ${await hp()} cowAlive=${!!nearestCow()}`);
	await cmd(`kill @e[tag=rcow]`).catch(() => {});
	await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	bot.quit(); await sleep(500); process.exit(0);
});
setTimeout(() => { console.log("HARD_TIMEOUT"); process.exit(1); }, 60000);
