/** DIAGNOSTIC: count several block types in a small radius to learn what findBlocks
 * actually sees (is the loaded region scannable?) and where coal really is. */
import { createBot } from "typecraft";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BOT = (process.env.BOT ?? "gym-coal-2").slice(0, 16);
const rcon = await connect();
const cmd = (c: string) => rcon.command(c);
const bot = createBot({
	host: process.env.MC_HOST ?? "localhost",
	port: parseInt(process.env.MC_PORT ?? "25565", 10),
	username: BOT,
	version: process.env.MC_VERSION ?? "1.21.11",
	auth: "offline",
});
bot.on("error", () => {});
const cnt = (sub: string, r: number, exposed?: boolean) =>
	bot.findBlocks({ matching: (n: string) => n.includes(sub), maxDistance: r, count: 5000, exposed }).length;

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	const cx = Math.floor(Math.random() * 10000);
	const cz = Math.floor(Math.random() * 10000);
	await cmd(`forceload add ${cx} ${cz}`);
	await sleep(400);
	await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`);
	await sleep(3000);
	try { await bot.waitForChunksToLoad(); } catch {}
	await sleep(1500);
	const p = bot.entity.position;
	const w = bot as unknown as { world: { columns: Map<unknown, unknown> } };
	console.log(`@${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)} loadedCols=${w.world.columns.size}`);
	for (const r of [16, 32]) {
		console.log(
			`r${r}: stone=${cnt("stone", r)} dirt=${cnt("dirt", r)} deepslate=${cnt("deepslate", r)} coal_ore=${cnt("coal_ore", r)} iron_ore=${cnt("iron_ore", r)} air handled sep`,
		);
	}
	// Also: dig straight down via blockAt to inspect the actual column under the bot.
	const col: string[] = [];
	for (let dy = 2; dy >= -40; dy--) {
		const b = bot.blockAt({ x: Math.floor(p.x), y: Math.floor(p.y) + dy, z: Math.floor(p.z) } as never);
		col.push(`${Math.floor(p.y) + dy}:${b?.name ?? "null"}`);
	}
	console.log("COLUMN under bot:\n" + col.join(" "));
	await cmd(`forceload remove ${cx} ${cz}`);
	process.exit(0);
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 40000);
