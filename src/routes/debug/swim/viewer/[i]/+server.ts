import type { RequestHandler } from './$types';
import { getSwimStreamers } from '$lib/server/swim';

// SSE stream of swim-bot i's live world (same transport as /viewer/[id], but
// backed by the multi-bot swim registry instead of the single race bot).
export const GET: RequestHandler = async ({ params }) => {
	const streamers = await getSwimStreamers();
	const i = Number(params.i);
	const streamer = streamers[i];
	if (!streamer) return new Response('no such swim bot', { status: 404 });

	let detach: (() => void) | null = null;
	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			detach = streamer.attach((json: string) => {
				try {
					controller.enqueue(enc.encode(`data: ${json}\n\n`));
				} catch {
					/* stream closed mid-write */
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
