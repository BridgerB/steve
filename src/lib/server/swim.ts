// /debug/swim backend — runs one bot per water-escape STRATEGY in-process, drops
// each into the real ocean hole (~-154,62,125) on a loop, and exposes each as a
// BotStreamer for the SSE grid. Lets you WATCH all the strategies try to climb out
// side-by-side. RCON (localhost:25575 tunnel) does the teleport/forceload.
import type { BotStreamer } from '$lib/typecraft/web/serve';
import * as sPathfind from '../../../water-strategies/pathfind-scaffold';
import * as sStair from '../../../water-strategies/stair-shore';
import * as sCommit from '../../../water-strategies/commit-swim';
import * as sDig from '../../../water-strategies/dig-pillar';
import * as sSpiral from '../../../water-strategies/spiral-brute';
import * as sBase from '../../../water-strategies/baseline';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HOLE = { x: -154, y: 62, z: 125 };

type EscapeFn = (bot: unknown) => Promise<void>;
const pick = (m: Record<string, unknown>): EscapeFn =>
	(m.escape ?? m.default) as EscapeFn;

// Order = grid order = viewer index.
export const SWIM_LABELS = [
	'pathfind-scaffold',
	'stair-shore',
	'commit-swim',
	'dig-pillar',
	'spiral-brute',
	'baseline'
];
const ESCAPES: EscapeFn[] = [
	pick(sPathfind),
	pick(sStair),
	pick(sCommit),
	pick(sDig),
	pick(sSpiral),
	pick(sBase)
];

const superviseSwim = async (
	streamer: BotStreamer,
	escape: EscapeFn,
	i: number
): Promise<void> => {
	const off = (i - 2) * 4; // spread the bots along X so they don't stack
	const uname = `Swim${i}`;
	const { createBot } = await import('$lib/typecraft');
	const { connect } = await import('$lib/steve/lib/rcon');
	for (;;) {
		try {
			const bot = createBot({
				host: process.env.MC_HOST ?? 'localhost',
				port: parseInt(process.env.MC_PORT ?? '25565', 10),
				username: uname,
				version: process.env.MC_VERSION ?? '1.21.11',
				auth: 'offline'
			}) as unknown as {
				on: (e: string, f: (...a: unknown[]) => void) => void;
				once: (e: string, f: (...a: unknown[]) => void) => void;
				waitForChunksToLoad?: () => Promise<void>;
			};
			bot.on('error', () => {});
			await new Promise<void>((res) => bot.once('spawn', () => res()));
			await bot.waitForChunksToLoad?.();
			(streamer as unknown as { bind: (b: unknown) => void }).bind(bot);
			const rcon = await connect(); // RCON runs as console (op-level) — no need to op the bot
			await rcon.command(`forceload add ${HOLE.x + off} ${HOLE.z}`);
			let stopped = false;
			bot.once('end', () => {
				stopped = true;
			});
			// Demo loop: reset into the hole, run the strategy (cap 60s), pause, repeat.
			while (!stopped) {
				try {
					await rcon.command(`tp ${uname} ${HOLE.x + off} ${HOLE.y} ${HOLE.z}`);
					await sleep(1800);
					if (escape) await Promise.race([escape(bot), sleep(60000)]);
				} catch {
					/* one loop hiccup — keep going */
				}
				await sleep(3000);
			}
		} catch {
			/* connection error — reconnect below */
		}
		await sleep(5000);
	}
};

const start = async (): Promise<BotStreamer[]> => {
	// A stray unhandled rejection from any bot (e.g. bot.craft "Promise timed out")
	// otherwise crashes the whole vite/node process and takes the dashboard down.
	// Swallow them so the multi-bot server stays up. (Debug surface — this is fine.)
	const g = globalThis as typeof globalThis & { __swimGuard?: boolean };
	if (!g.__swimGuard) {
		g.__swimGuard = true;
		process.on('unhandledRejection', () => {});
		process.on('uncaughtException', (e) => {
			console.error('[swim] swallowed uncaughtException:', e?.message);
		});
	}
	if (!process.env.MC_HOST) {
		try {
			(process as unknown as { loadEnvFile: () => void }).loadEnvFile();
		} catch {
			/* ambient env */
		}
	}
	const { createBotStreamer } = await import('$lib/typecraft/web/serve');
	// Low view distance — 6 extra bots share the process with the race bot.
	const streamers = ESCAPES.map(() => createBotStreamer({ viewDistance: 2 }));
	ESCAPES.forEach((escape, i) => void superviseSwim(streamers[i], escape, i));
	return streamers;
};

// globalThis-pinned singleton (survives vite dev module reloads — see bot.ts).
const KEY = '__swimStreamers__';
export const getSwimStreamers = (): Promise<BotStreamer[]> => {
	const g = globalThis as typeof globalThis & { [KEY]?: Promise<BotStreamer[]> };
	if (!g[KEY]) g[KEY] = start();
	return g[KEY];
};
