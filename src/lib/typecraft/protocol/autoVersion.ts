/**
 * Auto-version detection — pings the server to discover its protocol version,
 * then invokes autoVersionHooks so external modules (e.g. Forge/FML) can react.
 */

import type { Client, ClientOptions } from "./client.ts";
import { ping } from "./ping.ts";

/** Known protocol version → Minecraft version mappings. */
const PROTOCOL_VERSIONS: Record<number, string> = {
	775: "26.1.2",
	774: "1.21.11",
	769: "1.21.4",
	768: "1.21.2",
	767: "1.21.1",
	766: "1.21",
	765: "1.20.4",
	764: "1.20.2",
	763: "1.20.1",
	762: "1.20",
};

/** Ping the target server and configure the client to match its version. */
export const autoVersion = async (
	client: Client,
	options: ClientOptions,
): Promise<void> => {
	const host = options.host ?? "localhost";
	const port = options.port ?? 25565;

	const response = await ping({ host, port, version: options.version });

	const protocolVersion = response.version.protocol;
	const brandedName = response.version.name;

	const known = PROTOCOL_VERSIONS[protocolVersion];
	if (!known && !brandedName) {
		throw new Error(
			`Unsupported protocol version '${protocolVersion}' (server: ${brandedName})`,
		);
	}

	// Invoke hooks so external modules (e.g. Forge/FML) can respond to the ping
	for (const hook of client.autoVersionHooks) {
		hook(response, client, options);
	}
};
