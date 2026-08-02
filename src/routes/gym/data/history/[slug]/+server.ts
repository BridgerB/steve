import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gymHistory } from '$lib/steve/gym/db';
import { getGymSingleStatus } from '$lib/server/gym';

// Per-run history for one step (with reproduction fields) + the live single-bot state.
export const GET: RequestHandler = async ({ params }) => {
	let runs: unknown[] = [];
	try {
		runs = gymHistory(params.slug);
	} catch {
		runs = [];
	}
	return json({ runs, status: getGymSingleStatus(params.slug) ?? null });
};
