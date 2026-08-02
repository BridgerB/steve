import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stopGymAll } from '$lib/server/gym';

// STOP the 4 gym workers (disconnects their bots; a fresh visit starts anew).
export const POST: RequestHandler = async () => {
	await stopGymAll();
	return json({ stopped: true });
};
