/**
 * Run one gym exercise from the CLI:
 *   STEP=gather-wood node --env-file=.env --import ./typecraft-resolve.mjs gym-cli.ts
 * Connects a bot, grants the step's prereqs, random-teleports it, runs the task, and
 * records the result in gym_runs. RCON tunnel (25575) required.
 */
import { createBot } from "typecraft";
import { GYM_BY_SLUG } from "./src/lib/steve/gym/registry.ts";
import { runGymStep } from "./src/lib/steve/gym/run.ts";
import { initLogger } from "./src/lib/steve/lib/logger.ts";
import { connect } from "./src/lib/steve/lib/rcon.ts";

const SLUG = process.env.STEP ?? process.argv[2] ?? "gather-wood";
const step = GYM_BY_SLUG.get(SLUG);
if (!step) {
	console.log(`unknown step "${SLUG}"`);
	process.exit(1);
}
const BOT = (process.env.BOT ?? `Gym_${SLUG}`).replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);

const rcon = await connect();
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
initLogger(`gymcli-${SLUG}-${Date.now()}`);

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	const res = await runGymStep(bot, step, (c) => rcon.command(c), {
		log: (l) => console.log(l),
	});
	console.log(`GYMRESULT ${JSON.stringify(res)}`);
	process.exit(0);
});

setTimeout(() => {
	console.log("TIMEOUT — never finished");
	process.exit(1);
}, step.timeoutMs + 90000);
