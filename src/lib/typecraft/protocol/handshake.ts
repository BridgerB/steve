/**
 * Handshake + login flow — sends set_protocol, login_start, and handles
 * login success / configuration state transitions.
 */

import { publicEncrypt, randomBytes } from "node:crypto";
import { joinServer } from "./auth.ts";
import type { Client } from "./client.ts";
import { ProtocolState } from "./states.ts";

/** Wire up the login handshake flow for a client. */
export const registerHandshake = (
	client: Client,
	options: {
		readonly host: string;
		readonly port: number;
		readonly protocolVersion: number;
		readonly skipEncryption?: boolean;
		readonly accessToken?: string;
	},
) => {
	// ── Step 1: On connect, send handshake + login_start ──

	client.on("connect", () => {
		client.write("intention", {
			protocolVersion: options.protocolVersion,
			serverHost: options.host,
			serverPort: options.port,
			nextState: 2, // LOGIN
		});

		client.state = ProtocolState.LOGIN;

		client.write("hello", {
			name: client.username,
			profileId: client.uuid || "0".repeat(32),
		});
	});

	// ── Step 2: Handle encryption request ──
	// Always register: even offline clients must respond if the server requests encryption.

	client.on("hello", (packet: Record<string, unknown>) => {
		// Server sends "hello" to request encryption (contains server ID + public key + verify token)
		handleEncryption(client, packet, options.accessToken);
	});

	// ── Step 3: Handle compression ──

	client.on("login_compression", (packet: Record<string, unknown>) => {
		client.setCompressionThreshold(packet.compressionThreshold as number);
	});

	// ── Step 4: Handle login success → CONFIGURATION or PLAY ──

	client.on("login_finished", (packet: Record<string, unknown>) => {
		client.uuid = packet.uuid as string;
		client.username = packet.username as string;

		if (hasConfigurationState(client.protocolVersion)) {
			client.write("login_acknowledged", {});
			client.state = ProtocolState.CONFIGURATION;
			registerConfigurationHandlers(client);
		} else {
			client.state = ProtocolState.PLAY;
		}
	});
};

// ── Configuration state (1.20.2+) ──

const registerConfigurationHandlers = (client: Client) => {
	const onFinishConfig = () => {
		client.write("finish_configuration", {});
		client.state = ProtocolState.PLAY;

		client.removeListener("finish_configuration", onFinishConfig);
		client.removeListener("select_known_packs", onSelectKnownPacks);

		client.on("start_configuration", () => {
			client.write("configuration_acknowledged", {});
			client.state = ProtocolState.CONFIGURATION;
			registerConfigurationHandlers(client);
		});
	};

	const onSelectKnownPacks = (_packet: Record<string, unknown>) => {
		client.write("select_known_packs", { packs: [] });
	};

	client.on("finish_configuration", onFinishConfig);
	client.on("select_known_packs", onSelectKnownPacks);

	client.on("registry_data", () => {});
};

// ── Encryption handshake ──

const handleEncryption = (
	client: Client,
	packet: Record<string, unknown>,
	accessToken?: string,
) => {
	const serverPublicKey = packet.publicKey as Buffer;
	const verifyToken = packet.challenge as Buffer;
	const serverId = (packet.serverId as string) ?? "";

	const sharedSecret = randomBytes(16);

	const sendResponse = () => {
		const pubKeyPem = derToPem(serverPublicKey);
		const encryptedSecret = publicEncrypt(
			{ key: pubKeyPem, padding: 1 },
			sharedSecret,
		);
		const encryptedToken = publicEncrypt(
			{ key: pubKeyPem, padding: 1 },
			verifyToken,
		);

		client.write("key", {
			keybytes: encryptedSecret,
			encryptedChallenge: encryptedToken,
		});

		client.setEncryption(sharedSecret);
	};

	if (accessToken && client.uuid) {
		// Online mode: verify with Mojang session server before sending response
		joinServer(
			accessToken,
			client.uuid,
			serverId,
			sharedSecret,
			serverPublicKey,
		)
			.then(sendResponse)
			.catch((err) => {
				client.emit("error", err);
				client.end("Session server join failed");
			});
	} else {
		sendResponse();
	}
};

/** Convert a DER-encoded public key to PEM format. */
const derToPem = (der: Buffer): string => {
	const base64 = der.toString("base64");
	const lines: string[] = [];
	for (let i = 0; i < base64.length; i += 64) {
		lines.push(base64.slice(i, i + 64));
	}
	return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
};

/** 1.20.2+ (protocol version 764+) uses the CONFIGURATION state. */
const hasConfigurationState = (protocolVersion: number): boolean =>
	protocolVersion >= 764;
