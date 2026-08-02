import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gymSummary } from '$lib/steve/gym/db';
import { getGymAllStatus } from '$lib/server/gym';

// Per-step summary (pass% + timing + spread) + the live 4-worker state.
export const GET: RequestHandler = async () => {
	let summary: unknown[] = [];
	try {
		summary = gymSummary();
	} catch {
		summary = [];
	}
	const all = await getGymAllStatus();
	return json({ summary, running: all.running, workers: all.workers });
};
