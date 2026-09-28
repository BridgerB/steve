import type { PageServerLoad } from './$types';
import { getRaceData } from '$lib/server/race';

// Re-runs on every invalidateAll() from the page (~5s poll) → live data.
// The bot is a standalone Node process writing to D1; this dashboard reads D1
// (platform.env.DB) and points the live 3D viewer at the relay Durable Object.
export const load: PageServerLoad = async ({ platform }) => {
	return {
		race: await getRaceData(platform?.env?.DB),
		relayUrl:
			(platform?.env as { RELAY_URL?: string })?.RELAY_URL ??
			'wss://steve-relay.bridgerb.workers.dev'
	};
};
