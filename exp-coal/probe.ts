/**
 * DIAGNOSTIC ONLY (not a bot strategy): teleport to several random surface spots
 * and measure how much coal_ore actually exists nearby — total (exposed:false) vs
 * line-of-sight visible (exposed:true) — at the surface and at a few depths. Tells
 * us whether the coal task fails on DENSITY or on HARVESTING. The exposed:false
 * scan here is a measurement instrument; the delivered bot strategy never uses it.
 */
import { createBot } from "typecraft";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BOT = (process.env.BOT ?? "gym-coal-2").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
const N = Number(process.env.N ?? 6);

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

const isCoal = (n: string) => n.includes("coal_ore");
const count = (r: number, exposed?: boolean) =>
	bot.findBlocks({ matching: isCoal, maxDistance: r, count: 2000, exposed }).length;

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	console.log(`=== coal DENSITY probe, ${N} random spots ===`);
	for (let i = 0; i < N; i++) {
		const cx = Math.floor(Math.random() * 10000);
		const cz = Math.floor(Math.random() * 10000);
		await cmd(`forceload add ${cx} ${cz}`);
		await sleep(400);
		await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`);
		await sleep(2500);
		try {
			await bot.waitForChunksToLoad();
		} catch {}
		await sleep(1200);
		const y = Math.floor(bot.entity.position.y);
		// Total (X-ray, measurement) vs visible (exposed) coal in radius 32 and 64.
		const t32 = count(32);
		const v32 = count(32, true);
		const t64 = count(64);
		const v64 = count(64, true);
		console.log(
			`spot ${i + 1} @${Math.floor(bot.entity.position.x)},${y},${Math.floor(bot.entity.position.z)} | coal r32 total=${t32} vis=${v32} | r64 total=${t64} vis=${v64}`,
		);
		await cmd(`forceload remove ${cx} ${cz}`);
	}
	console.log("PROBE DONE");
	process.exit(0);
});

setTimeout(() => {
	console.log("PROBE TIMEOUT");
	process.exit(1);
}, 20000 * N + 30000);
