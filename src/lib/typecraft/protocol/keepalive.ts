/**
 * Keep-alive responder — echoes keep_alive packets back to the server.
 */

import type { Client } from "./client.ts";

/** Wire up automatic keep-alive responses. */
export const registerKeepalive = (client: Client) => {
	client.on("keep_alive", (packet: Record<string, unknown>) => {
		client.write("keep_alive", { keepAliveId: packet.keepAliveId });
	});
};
