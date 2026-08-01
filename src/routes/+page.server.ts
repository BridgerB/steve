import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { getRaceData } from '$lib/server/race';

// Re-runs on every invalidateAll() from the page (~5s poll) → live data.
// VIEWER_COUNT = how many per-bot 3D windows to show. Simplified mono setup runs
// a single in-process bot, so default 1; each window streams via SSE /viewer/<i>.
export const load: PageServerLoad = async () => {
	return {
		race: await getRaceData(),
		viewerCount: Number(env.VIEWER_COUNT ?? 1)
	};
};
