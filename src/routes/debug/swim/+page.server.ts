import type { PageServerLoad } from './$types';
import { getSwimStreamers, SWIM_LABELS } from '$lib/server/swim';

// Kick the swim bots on page load (globalThis singleton — starts once).
export const load: PageServerLoad = async () => {
	void getSwimStreamers().catch(() => {});
	return { labels: SWIM_LABELS };
};
