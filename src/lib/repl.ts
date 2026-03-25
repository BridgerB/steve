/**
 * Interactive bot REPL for testing tasks against a live server.
 *
 * Usage:
 *   node src/lib/repl.ts
 *
 * Then send commands:
 *   echo 'return bot.entity.position' > /tmp/steve-cmd.txt
 *   echo 'const { gatherWood } = await import("./src/tasks/gather-wood/main.ts"); return await gatherWood(bot, 3);' > /tmp/steve-cmd.txt
 */

import { readFileSync, watchFile, writeFileSync } from "node:fs";
import type { Bot } from "typecraft";
import { createBot } from "typecraft";
import { initLogger, logEvent } from "./logger.ts";

const CMD_FILE = "/tmp/steve-cmd.txt";
const HOST = process.env.MC_HOST ?? "localhost";
const PORT = parseInt(process.env.MC_PORT ?? "25565", 10);
const USERNAME = process.env.MC_USERNAME ?? "InlineBot";
const VERSION = process.env.MC_VERSION ?? "1.21.11";

const bot: Bot = createBot({
	host: HOST,
	port: PORT,
	username: USERNAME,
	version: VERSION,
	auth: "offline",
});
bot.on("error", (e) => {
	if (!e.message.includes("waypoint")) console.log("ERR:", e.message);
});
initLogger();
bot.on("debug", (category: string, detail: Record<string, unknown>) => {
	logEvent(category, "debug", JSON.stringify(detail));
});

bot.once("spawn", async () => {
	const p = bot.entity.position;
	console.log(
		`READY ${USERNAME} at ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`,
	);
	await bot.waitForChunksToLoad();
	console.log(`chunks loaded, watching ${CMD_FILE}`);

	writeFileSync(CMD_FILE, "");
	let busy = false;

	watchFile(CMD_FILE, { interval: 500 }, async () => {
		if (busy) return;
		const cmd = readFileSync(CMD_FILE, "utf8").trim();
		if (!cmd) return;
		writeFileSync(CMD_FILE, "");
		busy = true;
		console.log(`> ${cmd}`);
		try {
			// Write a temp module that exports a run(bot) function, then import and call it
			const tmpFile = new URL("../../.repl-exec.ts", import.meta.url).pathname;
			writeFileSync(
				tmpFile,
				`export default async function(bot: any) { ${cmd} }\n`,
			);
			const mod = await import(`${tmpFile}?t=${Date.now()}`);
			const result = await mod.default(bot);
			if (result !== undefined) console.log(JSON.stringify(result, null, 2));
		} catch (e: unknown) {
			const err = e as Error;
			console.log("ERROR:", err.message);
			if (err.stack) console.log(err.stack.split("\n").slice(0, 3).join("\n"));
		}
		busy = false;
		console.log("READY");
	});
});
