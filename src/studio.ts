/**
 * Spawn a bot for block-render testing. The bot is parked in spectator mode
 * near the test slot (0,0,0) so it never falls; an external script drives
 * setblock via RCON. The viewer's /grid route shows the test block from 6 sides.
 */

import { createBot, createWebViewer } from "typecraft";

const VIEWER_PORT = 3001;

const bot = createBot({
	host: "localhost",
	port: 25565,
	username: "StudioBot",
	version: "1.21.11",
	auth: "offline",
});

bot.once("spawn", async () => {
	console.log("[studio] spawned, starting viewer on port", VIEWER_PORT);
	createWebViewer(bot, { port: VIEWER_PORT, viewDistance: 2 });

	// Spectator = no gravity; park near the test slot so chunk (0,0) stays loaded.
	bot.chat("/gamemode spectator StudioBot");
	bot.chat("/tp StudioBot 0.5 8 0.5");

	console.log("[studio] waiting for chunks...");
	await bot.waitForChunksToLoad();
	console.log("[studio] ready, pos=", bot.entity.position);
});

bot.on("death", () => {
	console.log("[studio] died — respawning");
	bot.chat("/gamemode spectator StudioBot");
});
bot.on("error", (err: Error) => console.log("[studio] error:", err.message));
bot.on("kicked", (reason: string) => console.log("[studio] kicked:", reason));
bot.on("end", () => console.log("[studio] disconnected"));
