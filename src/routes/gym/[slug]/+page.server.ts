import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { GYM_BY_SLUG } from '$lib/steve/gym/registry';
import { getGymSingleStreamer } from '$lib/server/gym';

export const load: PageServerLoad = async ({ params }) => {
	const step = GYM_BY_SLUG.get(params.slug);
	if (!step) throw error(404, `no gym step "${params.slug}"`);
	// Start a dedicated looping bot for this step so it's watchable.
	void getGymSingleStreamer(params.slug).catch(() => {});
	return {
		slug: params.slug,
		label: step.label,
		order: step.order,
		prereq: step.prereq
	};
};
