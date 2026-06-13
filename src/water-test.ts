/**
 * Self-contained swimming/drowning test. Connects a bot, builds a flooded
 * horizontal tunnel (dry on one end, flooded on the other), drops the bot in
 * the flooded end, and runs escapeWater with the dry end as the retreat point.
 * Prints START/RESULT and exits — no REPL round-trips.
 *
 *   node src/water-test.ts            # retreat test (tunnel)
 *   node src/water-test.ts capped     # capped column (dig-up fallback)
 */
import { createBot, vec3 } from "typecraft";
import { escapeWater } from "./lib/bot-utils.ts";
import { initLogger } from "./lib/logger.ts";

const MODE = process.argv[2] ?? "tunnel";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const bot = createBot({
	host: process.env.MC_HOST ?? "localhost",
	port: parseInt(process.env.MC_PORT ?? "25565", 10),
	username: "InlineBot",
	version: process.env.MC_VERSION ?? "1.21.11",
	auth: "offline",
});
bot.on("error", (e) => {
	if (!e.message.includes("waypoint")) console.log("ERR", e.message);
});
initLogger(`watertest-${new Date().toISOString()}`);

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	await sleep(500);

	// Build the arena via op'd chat commands.
	if (MODE === "capped") {
		bot.chat("/fill 197 70 197 203 90 203 stone");
		bot.chat("/fill 200 72 200 200 86 200 water"); // capped column, no air above
	} else if (MODE === "deep") {
		bot.chat("/fill 198 60 198 212 79 212 stone");
		bot.chat("/fill 200 64 200 210 79 210 water"); // 16-deep open pool, shore at y80
	} else {
		bot.chat("/fill 198 72 208 212 78 212 stone");
		bot.chat("/fill 200 75 210 210 76 210 air"); // tunnel
		bot.chat("/fill 205 75 210 210 76 210 water"); // flood the far half
	}
	await sleep(2000);

	const dest =
		MODE === "capped"
			? "200 73 200"
			: MODE === "deep"
				? "205 64 205"
				: "210 75 210";
	bot.chat(`/tp InlineBot ${dest}`);
	await sleep(2000);

	const s = bot.entity.position;
	console.log(
		`START mode=${MODE} x=${Math.round(s.x)} y=${Math.round(s.y * 10) / 10} hp=${bot.health} inWater=${bot.entity.isInWater}`,
	);

	// Retreat point = the dry shore (irrelevant for capped → dig-up).
	const lastSafe =
		MODE === "capped"
			? undefined
			: MODE === "deep"
				? vec3(199, 80, 205)
				: vec3(201, 75, 210);
	const t0 = Date.now();
	const ok = await escapeWater(bot, lastSafe);
	const p = bot.entity.position;
	console.log(
		`RESULT ok=${ok} took=${Date.now() - t0}ms x=${Math.round(p.x)} y=${Math.round(p.y * 10) / 10} inWater=${bot.entity.isInWater} hp=${bot.health}`,
	);
	await sleep(300);
	process.exit(0);
});

setTimeout(() => {
	console.log("TIMEOUT — never reached spawn/finish");
	process.exit(1);
}, 45000);
