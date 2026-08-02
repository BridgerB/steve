// /gym backend — runs speedrun sub-tasks in isolation as live, streamable bots.
//   - /gym/all: 4 worker bots, each picking a RANDOM step, granting its prereqs,
//     random-teleporting, running it to pass/fail, then picking the next random one.
//     Runs until you hit STOP. Max 4 at a time.
//   - /gym/[slug]: one dedicated bot that loops a single step so you can watch it.
// Every run persists to gym.db (see gym/db.ts) with its reproduction fields.
import type { BotStreamer } from '$lib/typecraft/web/serve';
import { GYM_BY_SLUG, GYM_STEPS, type GymStep } from '$lib/steve/gym/registry';
import { runGymStep } from '$lib/steve/gym/run';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type QBot = {
	on: (e: string, f: (...a: unknown[]) => void) => void;
	once: (e: string, f: (...a: unknown[]) => void) => void;
	quit?: () => void;
	end?: () => void;
	waitForChunksToLoad?: () => Promise<void>;
};

const guard = () => {
	const g = globalThis as typeof globalThis & { __gymGuard?: boolean };
	if (g.__gymGuard) return;
	g.__gymGuard = true;
	process.on('unhandledRejection', () => {});
	process.on('uncaughtException', (e) => console.error('[gym] uncaught:', (e as Error)?.message));
};

const makeBot = async (username: string): Promise<QBot> => {
	if (!process.env.MC_HOST) {
		try {
			(process as unknown as { loadEnvFile: () => void }).loadEnvFile();
		} catch {
			/* ambient env */
		}
	}
	const { createBot } = await import('$lib/typecraft');
	return createBot({
		host: process.env.MC_HOST ?? 'localhost',
		port: parseInt(process.env.MC_PORT ?? '25565', 10),
		username,
		version: process.env.MC_VERSION ?? '1.21.11',
		auth: 'offline'
	}) as unknown as QBot;
};

export interface WorkerStatus {
	slug: string;
	label: string;
	state: 'init' | 'running' | 'pass' | 'fail' | 'stopped';
	lastMs?: number;
}

// ── /gym/all: 4 workers, random steps, stoppable ─────────────────────────────
interface GymAll {
	streamers: BotStreamer[];
	status: WorkerStatus[];
	bots: (QBot | null)[];
	stop: boolean;
}
const ALL_KEY = '__gymAll__';
const N_WORKERS = 4;

const superviseWorker = async (state: GymAll, i: number): Promise<void> => {
	const uname = `GymW${i}`;
	while (!state.stop) {
		try {
			const bot = await makeBot(uname);
			state.bots[i] = bot;
			bot.on('error', () => {});
			await new Promise<void>((res) => bot.once('spawn', () => res()));
			await bot.waitForChunksToLoad?.();
			(state.streamers[i] as unknown as { bind: (b: unknown) => void }).bind(bot);
			const { connect } = await import('$lib/steve/lib/rcon');
			const rcon = await connect();
			let ended = false;
			bot.once('end', () => {
				ended = true;
			});
			while (!state.stop && !ended) {
				const step = GYM_STEPS[Math.floor(Math.random() * GYM_STEPS.length)];
				state.status[i] = { slug: step.slug, label: step.label, state: 'running' };
				const res = await runGymStep(bot as never, step, (c) => rcon.command(c));
				state.status[i] = {
					slug: step.slug,
					label: step.label,
					state: res.pass ? 'pass' : 'fail',
					lastMs: res.durationMs
				};
				if (state.stop) break;
				await sleep(2000);
			}
			try {
				(bot.quit ?? bot.end)?.();
			} catch {
				/* ignore */
			}
		} catch {
			/* reconnect */
		}
		if (state.stop) break;
		await sleep(4000);
	}
	state.status[i] = { slug: '', label: 'stopped', state: 'stopped' };
};

const startAll = async (): Promise<GymAll> => {
	guard();
	const { createBotStreamer } = await import('$lib/typecraft/web/serve');
	const state: GymAll = {
		streamers: Array.from({ length: N_WORKERS }, () => createBotStreamer({ viewDistance: 2 })),
		status: Array.from({ length: N_WORKERS }, () => ({ slug: '', label: 'starting…', state: 'init' as const })),
		bots: Array.from({ length: N_WORKERS }, () => null),
		stop: false
	};
	for (let i = 0; i < N_WORKERS; i++) void superviseWorker(state, i);
	return state;
};

const allSlot = (): { [ALL_KEY]?: Promise<GymAll> } =>
	globalThis as typeof globalThis & { [ALL_KEY]?: Promise<GymAll> };

export const getGymAllStreamers = async (): Promise<BotStreamer[]> => {
	const g = allSlot();
	if (!g[ALL_KEY]) g[ALL_KEY] = startAll();
	return (await g[ALL_KEY]).streamers;
};

export const getGymAllStatus = async (): Promise<{ running: boolean; workers: WorkerStatus[] }> => {
	const g = allSlot();
	if (!g[ALL_KEY]) return { running: false, workers: [] };
	const s = await g[ALL_KEY];
	return { running: !s.stop, workers: s.status };
};

export const stopGymAll = async (): Promise<void> => {
	const g = allSlot();
	if (!g[ALL_KEY]) return;
	const s = await g[ALL_KEY];
	s.stop = true;
	for (const b of s.bots) {
		try {
			(b?.quit ?? b?.end)?.();
		} catch {
			/* ignore */
		}
	}
	g[ALL_KEY] = undefined; // allow a fresh start on next visit
};

// ── /gym/[slug]: one dedicated looping bot ───────────────────────────────────
interface Single {
	streamer: BotStreamer;
	status: WorkerStatus;
}
const singleReg = new Map<string, Single>();
export const getGymSingleStatus = (slug: string): WorkerStatus | undefined =>
	singleReg.get(slug)?.status;

const superviseSingle = async (single: Single, step: GymStep): Promise<void> => {
	const uname = `GymS_${step.slug}`.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
	for (;;) {
		try {
			const bot = await makeBot(uname);
			bot.on('error', () => {});
			await new Promise<void>((res) => bot.once('spawn', () => res()));
			await bot.waitForChunksToLoad?.();
			(single.streamer as unknown as { bind: (b: unknown) => void }).bind(bot);
			const { connect } = await import('$lib/steve/lib/rcon');
			const rcon = await connect();
			let ended = false;
			bot.once('end', () => {
				ended = true;
			});
			while (!ended) {
				single.status = { slug: step.slug, label: step.label, state: 'running' };
				const res = await runGymStep(bot as never, step, (c) => rcon.command(c));
				single.status = {
					slug: step.slug,
					label: step.label,
					state: res.pass ? 'pass' : 'fail',
					lastMs: res.durationMs
				};
				await sleep(2500);
			}
		} catch {
			/* reconnect */
		}
		await sleep(5000);
	}
};

const startSingle = async (slug: string): Promise<BotStreamer> => {
	guard();
	const step = GYM_BY_SLUG.get(slug);
	if (!step) throw new Error(`no gym step ${slug}`);
	const { createBotStreamer } = await import('$lib/typecraft/web/serve');
	const streamer = createBotStreamer({ viewDistance: 2 });
	const single: Single = { streamer, status: { slug, label: step.label, state: 'init' } };
	singleReg.set(slug, single);
	void superviseSingle(single, step);
	return streamer;
};
const SINGLE_KEY = '__gymSingleStreamers__';
export const getGymSingleStreamer = (slug: string): Promise<BotStreamer> => {
	const g = globalThis as typeof globalThis & {
		[SINGLE_KEY]?: Map<string, Promise<BotStreamer>>;
	};
	if (!g[SINGLE_KEY]) g[SINGLE_KEY] = new Map();
	const map = g[SINGLE_KEY];
	if (!map.has(slug)) map.set(slug, startSingle(slug));
	return map.get(slug) as Promise<BotStreamer>;
};
