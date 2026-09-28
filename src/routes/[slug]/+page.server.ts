import type { PageServerLoad } from './$types';
import { getRaceData } from '$lib/server/race';
import { STEPS } from '$lib/steps';

// Fullscreen single-bot view. slug = bot id (e.g. steve-race-904). Live 3D
// windows return via the viewer Durable Object (Phase 4); until then no viewer.
export const load: PageServerLoad = async ({ params, platform }) => {
	const race = await getRaceData(platform?.env?.DB);
	const viewerCount = 0;
	const index = race.bots.findIndex((b) => b.id === params.slug);
	const bot = index >= 0 ? race.bots[index] : undefined;
	const step = bot && bot.current >= 0 && bot.current < STEPS.length ? STEPS[bot.current] : '';
	return {
		slug: params.slug,
		index,
		hasViewer: index >= 0 && index < viewerCount,
		step,
		inv: bot?.inv ?? [],
		health: bot?.health ?? '?',
		dim: bot?.dim ?? '',
		dead: bot?.dead ?? false
	};
};
