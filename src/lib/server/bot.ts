// Runs ONE steve bot in-process (inside the SvelteKit Node server) and exposes
// its live world as a BotStreamer for the SSE /viewer route. A supervisor keeps
// the bot alive: on disconnect/kick it reconnects and re-binds to the same
// streamer, so transient drops don't end the run. (Single-bot for now; multi-bot
// later needs a per-bot logger instead of the current module-singleton.)

import type { BotStreamer } from '$lib/typecraft/web/serve';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Keep one bot connected forever. The bot's server-side state (inventory,
// position) persists across reconnects, and the logger/race continues, so the
// run resumes where it left off rather than restarting.
const supervise = async (streamer: BotStreamer): Promise<void> => {
	const { startBot } = await import('$lib/steve/main');
	for (;;) {
		try {
			const bot = await startBot();
			if (!bot.entity || !bot.game) {
				await new Promise<void>((resolve) => bot.once('spawn', () => resolve()));
			}
			streamer.bind(bot);
			// Wait until this bot disconnects, then loop to reconnect.
			await new Promise<void>((resolve) => bot.once('end', () => resolve()));
			console.log('[bot] disconnected — reconnecting in 5s');
		} catch (e) {
			console.error('[bot] supervisor error:', e instanceof Error ? e.message : e);
		}
		await sleep(5000);
	}
};

const start = async (): Promise<BotStreamer> => {
	// CONFIG in steve/main.ts reads process.env at import time, so make sure the
	// MC_* / DATABASE_URL vars from .env are present before we import it.
	if (!process.env.MC_HOST) {
		try {
			process.loadEnvFile();
		} catch {
			/* no .env on disk — rely on the ambient environment */
		}
	}

	const { createBotStreamer } = await import('$lib/typecraft/web/serve');
	const { initLogger, registerRace } = await import('$lib/steve/lib/logger');

	const raceId = process.env.STEVE_RACE_ID ?? new Date().toISOString();
	initLogger(raceId);
	registerRace(raceId, 'solo', 1);

	const streamer = createBotStreamer({ viewDistance: 6 });
	void supervise(streamer); // keep the bot alive in the background
	return streamer;
};

// Pin the singleton to globalThis, NOT a module-level var: in vite dev an SSR
// "page reload" re-evaluates this module (resetting module vars), which would
// otherwise spawn a SECOND supervisor/bot. Two bots with the same username then
// duplicate-login-kick each other in a tight loop, churning the viewer's chunks
// and rendering the world see-through. globalThis survives module reloads, so
// exactly one bot ever starts.
const BOT_KEY = '__steveBotStreamer__';
type WithBot = typeof globalThis & { [BOT_KEY]?: Promise<BotStreamer> };

/** Lazily start the bot on first viewer connect; reused for all viewers. */
export const getBotStreamer = (): Promise<BotStreamer> => {
	const g = globalThis as WithBot;
	if (!g[BOT_KEY]) g[BOT_KEY] = start();
	return g[BOT_KEY];
};
