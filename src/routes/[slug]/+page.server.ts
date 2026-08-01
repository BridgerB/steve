import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { getRaceData } from '$lib/server/race';
import { STEPS } from '$lib/steps';

// Fullscreen single-bot view. slug = bot id (e.g. steve-race-904). The viewer
// index is the bot's position in the (sorted) race list; bots 0..viewerCount-1
// have a live createWebViewer stream on /viewer/<index>.
export const load: PageServerLoad = async ({ params }) => {
	const race = await getRaceData();
	const viewerCount = Number(env.VIEWER_COUNT ?? 1);
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
