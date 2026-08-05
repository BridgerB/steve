/**
 * Chunk-sync diagnostic: does the bot's WORLD MODEL receive lava that RCON /fill places
 * 48 blocks away? Spawns a bot, tp's it to a known spot, forceloads + fills a surface lava
 * pool D blocks east, waits, then reads the bot's own world at those coords + findBlocks.
 *   node --env-file=.env --import ./typecraft-resolve.mjs spot-harness.ts
 */
import { createBot } from "typecraft";
import { connect } from "./src/lib/steve/lib/rcon.ts";

const D = Number(process.env.D ?? 48);
const rcon = await connect();
const bot = createBot({
	host: process.env.MC_HOST ?? "localhost",
	port: parseInt(process.env.MC_PORT ?? "25565", 10),
	username: "SpotHarness",
	version: process.env.MC_VERSION ?? "1.21.11",
	auth: "offline",
});
bot.on("error", (e) => {
	if (!e.message.includes("waypoint")) console.log("ERR", e.message);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	// Pick a fixed, known spot so we can reason about coords precisely.
	const p = bot.entity.position;
	const bx = Math.floor(p.x);
	const by = Math.floor(p.y);
	const bz = Math.floor(p.z);
	const lx = bx + D;
	const lz = bz;
	console.log(`bot at ${bx},${by},${bz}; pool target ${lx},${by - 1},${lz} (D=${D})`);

	await rcon.command(`forceload add ${bx - 8} ${bz - 10} ${lx + 8} ${lz + 10}`);
	await rcon.command(`fill ${bx - 4} ${by - 3} ${bz - 6} ${lx + 5} ${by - 1} ${lz + 6} stone`);
	await rcon.command(`fill ${bx - 4} ${by} ${bz - 6} ${lx + 5} ${by + 5} ${lz + 6} air`);
	await rcon.command(`fill ${lx - 4} ${by - 2} ${lz - 4} ${lx + 4} ${by - 1} ${lz + 4} lava`);
	console.log("scaffold filled; RCON confirms:", (await rcon.command(`execute if block ${lx} ${by - 1} ${lz} lava`)).trim());

	// Read the bot's world model at increasing waits.
	const bAt = (x: number, y: number, z: number) =>
		(bot as unknown as { blockAt: (v: { x: number; y: number; z: number }) => { name?: string } | null }).blockAt({ x, y, z })?.name ?? "null";
	const fb = (dist: number, exposed?: boolean) =>
		(bot as unknown as { findBlocks: (o: unknown) => { x: number; y: number; z: number }[] }).findBlocks({ matching: (n: string) => n === "lava", maxDistance: dist, count: 2048, exposed });
	const canSee = (x: number, y: number, z: number) =>
		(bot as unknown as { canSeeBlock: (v: { x: number; y: number; z: number }) => boolean }).canSeeBlock({ x, y, z });

	for (const w of [2, 5, 10, 20]) {
		await sleep(w * 1000 - (w > 2 ? (w - 2) * 1000 : 0));
		const poolBody = bAt(lx, by - 1, lz);
		const poolTop = bAt(lx, by - 2, lz);
		const nearLOS = fb(128); // default exposed=true (LOS)
		const nearNoLOS = fb(128, false); // no LOS filter
		console.log(
			`t=${w}s botWorld[pool]=${poolBody}/${poolTop} | findBlocks(128,exposed=default/LOS) n=${nearLOS.length} | (exposed=false) n=${nearNoLOS.length} | canSeeBlock(pool)=${canSee(lx, by - 1, lz)}`,
		);
	}
	process.exit(0);
});

setTimeout(() => {
	console.log("TIMEOUT");
	process.exit(1);
}, 90000);
