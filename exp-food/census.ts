/**
 * Census: teleport a bot to N random surface spots (mirroring the gym's
 * spreadplayers), then report what animals it can see and at what distance.
 * Answers: is the failure a "find animals" gap or a "kill/collect" gap?
 *
 * Run: node --env-file=.env --import ./typecraft-resolve.mjs exp-food/census.ts [N]
 */
import { createBot, distance } from "typecraft";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const N = Number(process.argv[2] ?? 8);
const BOT = process.env.BOT ?? "gym-food-1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FOOD_ANIMALS = ["pig", "cow", "sheep", "chicken", "rabbit"];

const rcon = await connect();
const cmd = (c: string) => rcon.command(c);

const bot = createBot({
	host: process.env.MC_HOST ?? "localhost",
	port: parseInt(process.env.MC_PORT ?? "25565", 10),
	username: BOT,
	version: process.env.MC_VERSION ?? "1.21.11",
	auth: "offline",
});
bot.on("error", (e) => {
	if (!e.message.includes("waypoint")) console.log("ERR", e.message);
});

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	await sleep(500);

	for (let i = 0; i < N; i++) {
		const cx = Math.floor(Math.random() * 10000);
		const cz = Math.floor(Math.random() * 10000);
		await cmd(`forceload add ${cx} ${cz}`).catch(() => {});
		await sleep(400);
		await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`).catch(() => {});
		await sleep(2000);
		try {
			await bot.waitForChunksToLoad();
		} catch {}
		await sleep(2500); // let entity spawn packets arrive

		const p = bot.entity.position;
		const biomeBlock = bot.blockAt({
			x: Math.floor(p.x),
			y: Math.floor(p.y) - 1,
			z: Math.floor(p.z),
		});
		const all = Object.values(bot.entities);
		const animals = all
			.filter((e) => e.name && FOOD_ANIMALS.includes(e.name))
			.map((e) => ({
				name: e.name,
				d: Math.round(distance(p, e.position)),
			}))
			.sort((a, b) => a.d - b.d);
		const anyMobs = all
			.filter((e) => e.type === "mob" || e.kind === "creature" || e.kind === "monster")
			.map((e) => e.name);
		console.log(
			`#${i + 1} @${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)} ground=${biomeBlock?.name} entities=${all.length} animals=${animals.length} ${JSON.stringify(animals.slice(0, 8))} nearestMobKinds=${JSON.stringify([...new Set(anyMobs)].slice(0, 10))}`,
		);
		await cmd(`forceload remove ${cx} ${cz}`).catch(() => {});
	}
	console.log("DONE");
	bot.quit();
	await sleep(500);
	process.exit(0);
});

setTimeout(() => {
	console.log("TIMEOUT");
	process.exit(1);
}, 60000 + N * 8000);
