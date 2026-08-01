/**
 * High-level client factory — creates a connected Minecraft client
 * with handshake, keepalive, and optional auth wired up.
 */

import { createHash } from "node:crypto";
import { authenticateMicrosoft } from "../auth/auth.ts";
import {
	type Client,
	type ClientOptions,
	connectClient,
	createProtocolClient,
} from "./client.ts";
import { resolveServer } from "./dns.ts";
import { registerHandshake } from "./handshake.ts";
import { registerKeepalive } from "./keepalive.ts";
import { initPluginChannels } from "./pluginChannels.ts";

/** Create and connect a Minecraft client. */
export const createClient = (options: ClientOptions): Client => {
	const host = options.host ?? "localhost";
	const port = options.port ?? 25565;
	const auth = options.auth ?? "offline";
	const keepAlive = options.keepAlive ?? true;

	const client = createProtocolClient(options);
	initPluginChannels(client);

	const wireUp = (
		resolvedHost: string,
		resolvedPort: number,
		accessToken?: string,
	) => {
		registerHandshake(client, {
			host: resolvedHost,
			port: resolvedPort,
			protocolVersion: client.protocolVersion,
			skipEncryption: auth === "offline",
			accessToken,
		});
		if (keepAlive) registerKeepalive(client);
		connectClient(client, resolvedHost, resolvedPort);
	};

	if (auth === "offline") {
		client.uuid = offlineUUID(client.username);
		resolveServer(host, port)
			.then(({ host: h, port: p }) => wireUp(h, p))
			.catch((err) => client.emit("error", err));
	} else if (auth === "microsoft") {
		Promise.all([
			authenticateMicrosoft({
				username: options.username,
				profilesFolder: options.profilesFolder,
				onMsaCode: options.onMsaCode,
			}),
			resolveServer(host, port),
		])
			.then(([result, resolved]) => {
				client.username = result.username;
				client.uuid = result.uuid;
				wireUp(resolved.host, resolved.port, result.accessToken);
			})
			.catch((err) => client.emit("error", err));
	}

	return client;
};

/** Generate an offline-mode UUID from a username (consistent with Minecraft's algorithm). */
const offlineUUID = (username: string): string => {
	const hash = createHash("md5").update(`OfflinePlayer:${username}`).digest();
	hash[6] = (hash[6]! & 0x0f) | 0x30;
	hash[8] = (hash[8]! & 0x3f) | 0x80;
	const hex = hash.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
