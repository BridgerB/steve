import type { PageServerLoad } from './$types';
import { getGymAllStreamers } from '$lib/server/gym';

// Kick the 4 random-gym workers on load (globalThis singleton — starts once).
export const load: PageServerLoad = async () => {
	void getGymAllStreamers().catch(() => {});
	return { count: 4 };
};
