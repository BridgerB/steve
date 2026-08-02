import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gymAllRuns } from '$lib/steve/gym/db';

// All recent runs (slug, pass, duration, x, z, ts) for the location + over-time charts.
export const GET: RequestHandler = async () => {
	let runs: unknown[] = [];
	try {
		runs = gymAllRuns();
	} catch {
		runs = [];
	}
	return json({ runs });
};
