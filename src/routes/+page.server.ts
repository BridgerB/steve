import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { getRaceData } from '$lib/server/race';
import { getBotStreamer } from '$lib/server/bot';

// Re-runs on every invalidateAll() from the page (~5s poll) → live data.
// VIEWER_COUNT = how many per-bot 3D windows to show. Simplified mono setup runs
// a single in-process bot, so default 1; each window streams via SSE /viewer/<i>.
export const load: PageServerLoad = async () => {
	// Kick the in-process bot on page load (getBotStreamer is a globalThis-pinned
	// singleton — starts once). Without this it only starts when <BotWindow> opens
	// /viewer/0, but BotWindow is gated on there being race data → a chicken-and-egg
	// deadlock on a fresh DB. Fire-and-forget; the SSE viewer keeps it alive after.
	void getBotStreamer().catch(() => {});
	return {
		race: await getRaceData(),
		viewerCount: Number(env.VIEWER_COUNT ?? 1)
	};
};
