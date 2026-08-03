/**
 * Brute-force: which attack variant actually damages a cow? For each variant, summon
 * a fresh tagged cow point-blank, apply the variant, read Health via RCON.
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
const hp = async () => { const r = await cmd(`data get entity @e[tag=vcow,limit=1] Health`).catch(() => "ERR"); const m = r.match(/([\d.]+)f/); return m ? parseFloat(m[1]) : NaN; };

const freshCow = async () => {
	await cmd(`kill @e[tag=vcow]`).catch(() => {});
	await sleep(300);
	const p = bot.entity.position;
	await cmd(`summon minecraft:cow ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${(p.z + 1.3).toFixed(2)} {Tags:["vcow"],NoAI:1b}`).catch(() => {});
	await sleep(700);
	return nearestCow();
};

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad(); await sleep(500);
	await cmd(`gamemode survival ${BOT}`).catch(() => {});
	await cmd(`clear ${BOT}`).catch(() => {}); await cmd(`give ${BOT} stone_sword 1`).catch(() => {});
	const cx = Math.floor(Math.random() * 10000), cz = Math.floor(Math.random() * 10000);
	await cmd(`forceload add ${cx} ${cz}`).catch(() => {}); await sleep(400);
	await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
	await sleep(2200); try { await bot.waitForChunksToLoad(); } catch {} await sleep(2000);
	await equipItem(bot, "sword", "hand");
	const gm = await cmd(`data get entity ${BOT} playerGameType`).catch(() => "ERR");
	console.log(`setup held=${bot.heldItem?.name} gm=${gm}`);

	const aim = (c: any) => bot.lookAt(offset(c.position, 0, (c.height ?? 1) * 0.5, 0), true);

	// V1: baseline bot.attack, idle
	{ const c = await freshCow(); if (c) { const h0 = await hp(); await aim(c); await sleep(80); bot.attack(c); await sleep(700); console.log(`V1 baseline idle: HP ${h0} -> ${await hp()}`); } }

	// V2: raw interact packet (mouse:1) + manual swing
	{ const c = await freshCow(); if (c) { const h0 = await hp(); await aim(c); await sleep(80); bot.swingArm?.(); bot.client.write("interact", { target: c.id, mouse: 1, sneaking: false }); await sleep(700); console.log(`V2 raw interact: HP ${h0} -> ${await hp()}`); } }

	// V3: attack while MOVING (walk into cow so server gets fresh position packets)
	{ const c = await freshCow(); if (c) { const h0 = await hp(); await aim(c); bot.setControlState("forward", true); await sleep(250); bot.attack(c); await sleep(300); bot.attack(c); await sleep(400); bot.setControlState("forward", false); await sleep(400); console.log(`V3 moving-attack: HP ${h0} -> ${await hp()}`); } }

	// V4: sprint crit (jump + sprint + attack)
	{ const c = await freshCow(); if (c) { const h0 = await hp(); await aim(c); bot.setControlState("sprint", true); bot.setControlState("forward", true); await sleep(200); bot.setControlState("jump", true); await sleep(150); bot.attack(c); bot.setControlState("jump", false); await sleep(600); bot.setControlState("forward", false); bot.setControlState("sprint", false); console.log(`V4 sprint-jump-crit: HP ${h0} -> ${await hp()}`); } }

	// V5: force a position packet before attack (teleport-nudge via move), then attack idle
	{ const c = await freshCow(); if (c) { const h0 = await hp(); await aim(c); // nudge position by toggling a tiny move
		bot.setControlState("forward", true); await sleep(120); bot.setControlState("forward", false); await sleep(150); bot.attack(c); await sleep(700); console.log(`V5 nudge-then-attack: HP ${h0} -> ${await hp()}`); } }

	await cmd(`kill @e[tag=vcow]`).catch(() => {});
	await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	bot.quit(); await sleep(500); process.exit(0);
});
setTimeout(() => { console.log("HARD_TIMEOUT"); process.exit(1); }, 90000);
