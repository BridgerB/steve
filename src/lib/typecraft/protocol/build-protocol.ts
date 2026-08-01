/**
 * Protocol schema builder — assembles the complete ProtoDef schema from:
 * 1. Shared type definitions (shared-types.ts, hand-written complex types)
 * 2. Packet field definitions (protocol-extracted.json, auto-generated from MC bytecode)
 * 3. Packet IDs (packets-raw.json, from server --reports)
 *
 * Uses Mojang packet names throughout (matching datagen extraction).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKET_DEFS } from "./packet-defs.ts";
import { SHARED_TYPES } from "./shared-types.ts";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");

type PacketsRaw = Record<
	string,
	Record<string, Record<string, { protocol_id: number }>>
>;

type ProtocolExtracted = Record<
	string,
	Record<string, { types: Record<string, unknown> }>
>;

const DIRECTION_MAP: Record<string, string> = {
	clientbound: "toClient",
	serverbound: "toServer",
};

const STATE_MAP: Record<string, string> = {
	handshake: "handshaking",
	status: "status",
	login: "login",
	configuration: "configuration",
	play: "play",
};

// Extracted states that map to protocol states
const EXTRACTED_STATE_MAP: Record<string, string> = {
	common: "play", // common packets appear in both play and configuration
	cookie: "play",
	ping: "status",
	play: "play",
	login: "login",
	status: "status",
	configuration: "configuration",
	handshaking: "handshaking",
};

type ProtocolSchema = {
	readonly protocol: Record<string, unknown>;
	readonly version: {
		readonly type: string;
		readonly majorVersion: string;
		readonly version: number;
		readonly minecraftVersion: string;
	};
};

let cached: ProtocolSchema | null = null;

/** Build the complete ProtoDef protocol schema. Result is cached. */
export const buildProtocol = (): ProtocolSchema => {
	if (cached) return cached;

	const packetsRaw = JSON.parse(
		readFileSync(join(DATA_DIR, "packets-raw.json"), "utf8"),
	) as PacketsRaw;

	// Load auto-extracted packet definitions
	let extracted: ProtocolExtracted = {};
	try {
		extracted = JSON.parse(
			readFileSync(join(DATA_DIR, "protocol-extracted.json"), "utf8"),
		) as ProtocolExtracted;
	} catch {
		console.error(
			"[build-protocol] Warning: protocol-extracted.json not found, using empty defs",
		);
	}

	// Build flat lookup from extracted data: "play.toClient.packet_animate" → definition
	const extractedDefs: Record<string, unknown> = {};
	for (const [extState, dirs] of Object.entries(extracted)) {
		const protoState = EXTRACTED_STATE_MAP[extState] ?? extState;
		for (const [dir, data] of Object.entries(dirs)) {
			for (const [name, def] of Object.entries(data.types ?? {})) {
				// Store under both the extracted state and the protocol state
				extractedDefs[`${protoState}.${dir}.${name}`] = def;
				if (extState !== protoState) {
					extractedDefs[`${extState}.${dir}.${name}`] = def;
				}
			}
		}
	}

	const protocol: Record<string, unknown> = {
		types: { ...SHARED_TYPES },
	};

	for (const [rawState, rawDirs] of Object.entries(packetsRaw)) {
		const state = STATE_MAP[rawState];
		if (!state) continue;

		const stateObj: Record<string, unknown> = {};

		for (const [rawDir, packets] of Object.entries(rawDirs)) {
			const dir = DIRECTION_MAP[rawDir];
			if (!dir) continue;

			const mappings: Record<string, string> = {};
			const switchFields: Record<string, string> = {};
			const types: Record<string, unknown> = {};

			for (const [fullName, info] of Object.entries(packets)) {
				const name = fullName.replace("minecraft:", "");
				const hexId = `0x${info.protocol_id.toString(16).padStart(2, "0")}`;

				mappings[hexId] = name;
				switchFields[name] = `packet_${name}`;

				const defKey = `${state}.${dir}.packet_${name}`;
				// Prefer shared-types (hand-written, accurate) over extracted (may have wrong types)
				// Fall back to extracted, then empty container
				types[`packet_${name}`] =
					SHARED_TYPES[`packet_common_${name}`] ??
					PACKET_DEFS[defKey] ??
					extractedDefs[defKey] ??
					["container", []];
			}

			types.packet = [
				"container",
				[
					{
						name: "name",
						type: ["mapper", { type: "varint", mappings }],
					},
					{
						name: "params",
						type: ["switch", { compareTo: "name", fields: switchFields }],
					},
				],
			];

			stateObj[dir] = { types };
		}

		protocol[state] = stateObj;
	}

	// Handshaking — always present, stable across versions
	{ // Always override handshaking
		protocol.handshaking = {
			toClient: { types: {} },
			toServer: {
				types: {
					packet_intention: extractedDefs[
						"handshaking.toServer.packet_intention"
					] ?? [
						"container",
						[
							{ name: "protocolVersion", type: "varint" },
							{ name: "serverHost", type: "string" },
							{ name: "serverPort", type: "u16" },
							{ name: "nextState", type: "varint" },
						],
					],
					packet_legacy_server_list_ping: [
						"container",
						[{ name: "payload", type: "u8" }],
					],
					packet: [
						"container",
						[
							{
								name: "name",
								type: [
									"mapper",
									{
										type: "varint",
										mappings: {
											"0x00": "intention",
											"0xfe": "legacy_server_list_ping",
										},
									},
								],
							},
							{
								name: "params",
								type: [
									"switch",
									{
										compareTo: "name",
										fields: {
											intention: "packet_intention",
											legacy_server_list_ping: "packet_legacy_server_list_ping",
										},
									},
								],
							},
						],
					],
				},
			},
		};
	}

	cached = {
		protocol,
		version: {
			type: "pc",
			majorVersion: "26.1",
			version: 775,
			minecraftVersion: "26.1.2",
		},
	};

	return cached;
};
