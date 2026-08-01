import type { RequestHandler } from './$types';
import { getBotStreamer } from '$lib/server/bot';

// Server-Sent Events stream of one bot's live world (init/assets/chunks/
// position/entities). One-directional server -> browser, so plain HTTP streaming
// — no WebSocket. The viewer client connects with `new EventSource('/viewer/0')`.
export const GET: RequestHandler = async () => {
	const streamer = await getBotStreamer();
	let detach: (() => void) | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const sink = (json: string) => {
				try {
					controller.enqueue(enc.encode(`data: ${json}\n\n`));
				} catch {
					/* stream closed mid-write */
				}
			};
			detach = streamer.attach(sink);
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
