import type { PageServerLoad } from './$types';
import { getRaceData } from '$lib/server/race';

// Re-runs on every invalidateAll() from the page (~5s poll) → live data.
// The bot is now a standalone Node process writing to D1; this dashboard only
// reads D1 (platform.env.DB). Live 3D windows return via the viewer Durable
// Object, so viewerCount is 0 until that's wired.
export const load: PageServerLoad = async ({ platform }) => {
	return {
		race: await getRaceData(platform?.env?.DB),
		viewerCount: 0
	};
};
