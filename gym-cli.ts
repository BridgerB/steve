/**
 * Run one gym exercise from the CLI:
 *   STEP=gather-wood node --env-file=.env --import ./typecraft-resolve.mjs gym-cli.ts
 * Connects a bot, grants the step's prereqs, random-teleports it, runs the task, and
 * records the result in gym_runs. RCON tunnel (25575) required.
 */
import { createBot } from "typecraft";
import { GYM_BY_SLUG } from "./src/lib/steve/gym/registry.ts";
import { runGymStep } from "./src/lib/steve/gym/run.ts";
import { registerBlockMemory } from "./src/lib/steve/lib/bot-utils.ts";
import { attachDiagnostics, initLogger, logEvent, stopLogger } from "./src/lib/steve/lib/logger.ts";
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
// A dropped connection must end the run: b4-5 was "lost connection: Timed out"
// 30s after login, the process kept running against a stale world model for 20
// minutes (site_anchor, chamber, heartbeats) and only the 33-min CLI timeout
// ended it.
const disconnected = (why: string): void => {
	console.log(`DISCONNECTED ${why}`);
	logEvent("lifecycle", "end", why);
	stopLogger();
	process.exit(2);
};
bot.on("end", (reason: string) => disconnected(`end ${reason ?? ""}`));
bot.on("kicked", (reason: string) => disconnected(`kicked ${String(reason).slice(0, 120)}`));
bot.on("error", (e) => {
	if (!e.message.includes("waypoint")) console.log("ERR", e.message);
});
registerBlockMemory(bot); // same passive ore memory as production
const RUN_ID = process.env.GYM_RUN_ID ?? `gymcli-${SLUG}-${Date.now()}`;
initLogger(RUN_ID);
console.log(`RACEID ${RUN_ID}`);

bot.once("spawn", async () => {
	await bot.waitForChunksToLoad();
	// Same damage/death/threat logging as a race bot (b1-7 died at the lava fill
	// with no event, respawned at world spawn and cast its frame there).
	attachDiagnostics(bot);
	const res = await runGymStep(bot, step, (c) => rcon.command(c), {
		log: (l) => console.log(l),
	});
	console.log(`GYMRESULT ${JSON.stringify(res)}`);
	stopLogger(); // flush the last events (portal_lit was missing from D1 in gym b1-5)
	process.exit(0);
});

setTimeout(() => {
	console.log("TIMEOUT — never finished");
	stopLogger();
	process.exit(1);
}, step.timeoutMs + 90000);
