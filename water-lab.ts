/**
 * Water-escape strategy LAB. Drops a bot into the REAL ocean hole where steve keeps
 * getting stuck (~-154,62,125), runs ONE pluggable escape strategy, and measures
 * whether it reaches dry land + how long + how far it travelled. Same hole + same
 * success metric for every strategy, so results are comparable. RCON tunnel required:
 *   ssh -fN -L 25575:127.0.0.1:25575 bridger@144.24.32.76   (already up)
 *
 * Run:
 *   STRATEGY=<name> BOT=Water1 OFFX=0 OFFZ=0 \
 *     node --env-file=.env --import ./typecraft-resolve.mjs water-lab.ts
 *
 * The strategy lives in ./water-strategies/<name>.ts and default-exports (or exports
 * `escape`) an async function `(bot) => Promise<void>` that tries to get the bot out
 * of the water. It should loop until the bot is on dry land or it gives up; the lab
 * caps it at 75s. Give the bot whatever it needs via RCON inside your strategy if you
 * want (e.g. `/give` blocks) — but note a real spawn has nothing, so prefer no-item
 * strategies or dig-your-own-blocks.
 */
import { createBot } from "typecraft";
import {
	isInWaterTrap,
	isOnDryLand,
} from "./src/lib/steve/lib/bot-utils.ts";
import { initLogger } from "./src/lib/steve/lib/logger.ts";
import { connect } from "./src/lib/steve/lib/rcon.ts";

const STRATEGY = process.env.STRATEGY ?? process.argv[2];
if (!STRATEGY) {
	console.log("set STRATEGY=<name> (module ./water-strategies/<name>.ts)");
	process.exit(1);
}
const BOT = process.env.BOT ?? `WaterLab_${STRATEGY}`;
const OFFX = Number(process.env.OFFX ?? 0);
const OFFZ = Number(process.env.OFFZ ?? 0);
const HOLE = { x: -154 + OFFX, y: 62, z: 125 + OFFZ };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mod = await import(`./water-strategies/${STRATEGY}.ts`);
const escape: (bot: unknown) => Promise<void> = mod.escape ?? mod.default;
if (typeof escape !== "function") {
	console.log(`strategy ${STRATEGY} must export escape(bot) or default`);
	process.exit(1);
}

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
initLogger(`waterlab-${STRATEGY}-${Date.now()}`);

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	await sleep(500);
	await cmd(`op ${BOT}`);
	await cmd(`forceload add ${HOLE.x} ${HOLE.z}`);
	await sleep(600);

	let arrived = false;
	for (let i = 0; i < 20; i++) {
		await cmd(`tp ${BOT} ${HOLE.x} ${HOLE.y} ${HOLE.z}`);
		await sleep(400);
		const p = bot.entity?.position;
		if (p && Math.abs(p.x - HOLE.x) < 2 && Math.abs(p.z - HOLE.z) < 2) {
			arrived = true;
			break;
		}
	}
	await sleep(700);
	const s = bot.entity.position;
	const start = { x: s.x, y: s.y, z: s.z };
	console.log(
		`START strat=${STRATEGY} bot=${BOT} arrived=${arrived} x=${Math.round(s.x)} y=${Math.round(s.y * 10) / 10} z=${Math.round(s.z)} inWater=${bot.entity.isInWater} trap=${isInWaterTrap(bot)}`,
	);
	if (!arrived || !isInWaterTrap(bot)) {
		console.log("SETUP_FAIL — bot not in the water trap; result would be meaningless");
		await cmd(`forceload remove ${HOLE.x} ${HOLE.z}`);
		process.exit(2);
	}

	const t0 = Date.now();
	try {
		await Promise.race([escape(bot), sleep(75000)]);
	} catch (e) {
		console.log("STRAT_ERR", e instanceof Error ? e.message : String(e));
	}
	const p = bot.entity.position;
	const dry = isOnDryLand(bot);
	const dist = Math.hypot(p.x - start.x, p.z - start.z);
	console.log(
		`RESULT ${dry ? "PASS" : "FAIL"} strat=${STRATEGY} tookMs=${Date.now() - t0} onDryLand=${dry} inWater=${bot.entity.isInWater} x=${Math.round(p.x)} y=${Math.round(p.y * 10) / 10} z=${Math.round(p.z)} distXZ=${Math.round(dist)} hp=${Math.round(bot.health)}`,
	);
	await cmd(`forceload remove ${HOLE.x} ${HOLE.z}`);
	await sleep(300);
	process.exit(0);
});

setTimeout(() => {
	console.log("TIMEOUT — never reached spawn/finish");
	process.exit(1);
}, 115000);
