/**
 * Try each interact action value (0..4) against a fresh cow to see if any deals
 * damage — in case this server build renumbered the ATTACK action. Reads HP via RCON.
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
const hp = async () => { const r = await cmd(`data get entity @e[tag=acow,limit=1] Health`).catch(() => "ERR"); const m = r.match(/([\d.]+)f/); return m ? parseFloat(m[1]) : NaN; };
const freshCow = async () => { await cmd(`kill @e[tag=acow]`).catch(() => {}); await sleep(300); const p = bot.entity.position; await cmd(`summon minecraft:cow ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${(p.z + 1.3).toFixed(2)} {Tags:["acow"],NoAI:1b,Invulnerable:0b}`).catch(() => {}); await sleep(700); return nearestCow(); };

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad(); await sleep(500);
	await cmd(`gamemode survival ${BOT}`).catch(() => {});
	await cmd(`clear ${BOT}`).catch(() => {}); await cmd(`give ${BOT} stone_sword 1`).catch(() => {});
	const cx = Math.floor(Math.random() * 10000), cz = Math.floor(Math.random() * 10000);
	await cmd(`forceload add ${cx} ${cz}`).catch(() => {}); await sleep(400);
	await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
	await sleep(2200); try { await bot.waitForChunksToLoad(); } catch {} await sleep(2000);
	await equipItem(bot, "sword", "hand");

	for (const action of [0, 1, 2, 3]) {
		const c = await freshCow();
		if (!c) { console.log(`action ${action}: NO COW`); continue; }
		await bot.lookAt(offset(c.position, 0, 0.7, 0), true); await sleep(80);
		const h0 = await hp();
		for (let i = 0; i < 3; i++) {
			bot.swingArm?.();
			const pkt: any = { target: c.id, mouse: action, sneaking: false };
			if (action === 2) { pkt.x = 0; pkt.y = 0.7; pkt.z = 0; pkt.hand = 0; }
			if (action === 0) pkt.hand = 0;
			try { bot.client.write("interact", pkt); } catch (e) { console.log(`action ${action} write ERR ${(e as Error).message}`); break; }
			await sleep(650);
		}
		console.log(`action ${action}: HP ${h0} -> ${await hp()}`);
	}
	// Also try bot.useOn (right-click) and a swing-only, for completeness
	await cmd(`kill @e[tag=acow]`).catch(() => {});
	await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	bot.quit(); await sleep(500); process.exit(0);
});
setTimeout(() => { console.log("HARD_TIMEOUT"); process.exit(1); }, 90000);
