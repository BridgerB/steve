import type { RequestHandler } from './$types';
import { getGymAllStreamers } from '$lib/server/gym';

export const GET: RequestHandler = async ({ params }) => {
	const streamers = await getGymAllStreamers();
	const streamer = streamers[Number(params.i)];
	if (!streamer) return new Response('no such gym worker', { status: 404 });
	let detach: (() => void) | null = null;
	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			detach = streamer.attach((json: string) => {
				try {
					controller.enqueue(enc.encode(`data: ${json}\n\n`));
				} catch {
					/* closed */
				}
			});
		},
		cancel() {
			detach?.();
		}
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};
