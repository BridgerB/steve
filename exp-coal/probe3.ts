/** DIAGNOSTIC: ground-truth blockAt cube scan vs findBlocks, to (a) confirm whether
 * findBlocks under-scans and (b) find at what Y coal actually appears near a random
 * spawn. Measurement only. */
import { createBot } from "typecraft";
import { connect } from "../src/lib/steve/lib/rcon.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BOT = (process.env.BOT ?? "gym-coal-2").slice(0, 16);
const N = Number(process.env.N ?? 4);
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

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	for (let s = 0; s < N; s++) {
		const cx = Math.floor(Math.random() * 10000);
		const cz = Math.floor(Math.random() * 10000);
		await cmd(`forceload add ${cx} ${cz}`);
		await sleep(400);
		await cmd(`spreadplayers ${cx} ${cz} 0 24 false ${BOT}`);
		await sleep(3000);
		try { await bot.waitForChunksToLoad(); } catch {}
		await sleep(1200);
		const px = Math.floor(bot.entity.position.x);
		const py = Math.floor(bot.entity.position.y);
		const pz = Math.floor(bot.entity.position.z);
		// Ground-truth blockAt cube scan, radius 16 horizontal, full vertical y-60..py.
		const R = 16;
		let coalTot = 0, ironTot = 0, coalExp = 0, nonAir = 0;
		let firstCoalY: number | null = null;
		const isExposed = (x: number, y: number, z: number) =>
			([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const).some(([a,b,c]) => {
				const nb = bot.blockAt({ x: x+a, y: y+b, z: z+c } as never);
				return !nb || nb.name === "air" || nb.name === "cave_air" || nb.name.includes("water");
			});
		for (let x = px - R; x <= px + R; x++)
			for (let z = pz - R; z <= pz + R; z++)
				for (let y = Math.max(-60, py - 80); y <= py + 4; y++) {
					const b = bot.blockAt({ x, y, z } as never);
					if (!b || b.name === "air" || b.name === "cave_air") continue;
					nonAir++;
					if (b.name.includes("coal_ore")) {
						coalTot++;
						if (firstCoalY == null || y > firstCoalY) firstCoalY = y;
						if (isExposed(x, y, z)) coalExp++;
					}
					if (b.name.includes("iron_ore")) ironTot++;
				}
		const fbCoal = bot.findBlocks({ matching: (n: string) => n.includes("coal_ore"), maxDistance: 24, count: 999 }).length;
		const fbCoalX = bot.findBlocks({ matching: (n: string) => n.includes("coal_ore"), maxDistance: 24, count: 999, exposed: false }).length;
		console.log(
			`spot${s + 1} @${px},${py},${pz} | GROUNDTRUTH r16col: nonAir=${nonAir} coal=${coalTot}(exposed ${coalExp}, topY ${firstCoalY}) iron=${ironTot} | findBlocks r24 coal exposed=${fbCoal} all=${fbCoalX}`,
		);
		await cmd(`forceload remove ${cx} ${cz}`);
	}
	console.log("P3DONE");
	process.exit(0);
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 30000 * N + 20000);
