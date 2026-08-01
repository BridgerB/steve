/**
 * Minecraft protocol client — manages TCP connection, packet codec pipeline,
 * encryption, compression, and state machine transitions.
 */

import { EventEmitter } from "node:events";
import { type Socket, connect as tcpConnect } from "node:net";
import { buildProtocol } from "./build-protocol.ts";
import { createPacketCodec, type PacketCodec } from "./codec.ts";
import { compressPacket, decompressPacket } from "./compression.ts";
import { createDecryptor, createEncryptor } from "./encryption.ts";
import { createSplitter, framePacket } from "./framing.ts";
import { Direction, ProtocolState } from "./states.ts";
import { readVarInt } from "./varint.ts";

// ── Types ──

export type ClientOptions = {
	readonly host?: string;
	readonly port?: number;
	readonly username: string;
	readonly version: string;
	readonly auth?: "microsoft" | "offline";
	readonly keepAlive?: boolean;
	readonly profilesFolder?: string;
	readonly hideErrors?: boolean;
	readonly onMsaCode?: (data: {
		user_code: string;
		verification_uri: string;
	}) => void;
};

export type PacketMeta = {
	readonly name: string;
	readonly state: string;
};

export type Client = EventEmitter & {
	/** Send a packet. */
	readonly write: (name: string, params: Record<string, unknown>) => void;
	/** Send raw bytes (bypasses serialization). */
	readonly writeRaw: (buffer: Buffer) => void;
	/** Close the connection. */
	readonly end: (reason?: string) => void;
	/** Attach a TCP socket and wire up the pipeline. */
	readonly setSocket: (socket: Socket) => void;
	/** Enable AES-128-CFB8 encryption with shared secret. */
	readonly setEncryption: (secret: Buffer) => void;
	/** Enable zlib compression above threshold bytes. */
	readonly setCompressionThreshold: (threshold: number) => void;
	/** Register a plugin channel for custom_payload handling. */
	readonly registerChannel: (
		name: string,
		serializer?: ((params: unknown) => Buffer) | null,
		deserializer?: ((data: Buffer) => unknown) | null,
		custom?: boolean,
	) => void;
	/** Send data on a registered plugin channel. */
	readonly writeChannel: (name: string, params: unknown) => void;
	/** Unregister a plugin channel. */
	readonly unregisterChannel: (name: string, custom?: boolean) => void;
	/** Hooks for external modules to respond to version detection (e.g. Forge/FML). */
	autoVersionHooks: ((
		response: unknown,
		client: Client,
		options: ClientOptions,
	) => void)[];
	/** Current protocol state. */
	state: string;
	/** Player username. */
	username: string;
	/** Player UUID (set after login). */
	uuid: string;
	/** Minecraft version string. */
	readonly version: string;
	/** Protocol version number. */
	readonly protocolVersion: number;
	/** Underlying TCP socket. */
	socket: Socket | null;
};

// ── Client factory ──

/** Create a protocol client. Call setSocket() or connectClient() to start. */
export const createProtocolClient = (options: ClientOptions): Client => {
	const emitter = new EventEmitter();
	const schema = buildProtocol();
	const protocol = schema.protocol;
	const sharedTypes = protocol.types as Record<string, unknown>;
	const protocolVersion = schema.version.version;

	// ── Mutable state ──

	let currentState: string = ProtocolState.HANDSHAKING;
	let currentSocket: Socket | null = null;
	let readCodec: PacketCodec | null = null;
	let writeCodec: PacketCodec | null = null;
	let compressionThreshold = -1;
	let cipher: { update: (data: Buffer) => Buffer } | null = null;
	let decipher: { update: (data: Buffer) => Buffer } | null = null;
	const splitter = createSplitter();
	let ended = false;

	// ── Codec management ──

	const mergeTypes = (
		stateTypes: Record<string, unknown>,
	): Record<string, unknown> => ({
		...sharedTypes,
		...stateTypes,
	});

	const updateCodecs = (newState: string) => {
		const stateData = protocol[newState] as
			| Record<string, Record<string, unknown>>
			| undefined;
		if (!stateData) return;

		const toClient = stateData[Direction.TO_CLIENT] as
			| { types: Record<string, unknown> }
			| undefined;
		const toServer = stateData[Direction.TO_SERVER] as
			| { types: Record<string, unknown> }
			| undefined;

		readCodec = toClient
			? createPacketCodec({ types: mergeTypes(toClient.types) })
			: null;
		writeCodec = toServer
			? createPacketCodec({ types: mergeTypes(toServer.types) })
			: null;
	};

	// Initialize codecs for handshaking state
	updateCodecs(ProtocolState.HANDSHAKING);

	// ── Inbound pipeline: decrypt → split → decompress → deserialize → emit ──

	const handleData = (chunk: Buffer) => {
		try {
			const decrypted = decipher ? decipher.update(chunk) : chunk;
			const packets = splitter.write(decrypted);

			for (const raw of packets) {
				let decompressed: Buffer | undefined;
				try {
					decompressed =
						compressionThreshold >= 0 ? decompressPacket(raw) : raw;
					if (!readCodec) continue;

					const { name, params } = readCodec.read(decompressed);
					const meta: PacketMeta = { name, state: currentState };

					emitter.emit("packet", params, meta);
					emitter.emit(name, params, meta);
				} catch (packetErr) {
					if (!options.hideErrors) {
						// Annotate error with packet name and hex dump
						const err = packetErr as Error;
						if (decompressed && readCodec) {
							try {
								const { value: id } = readVarInt(decompressed, 0);
								const pktName = readCodec.packetNames.get(id);
								const hex = decompressed.subarray(0, 64).toString("hex");
								err.message = `[${pktName ?? `0x${id.toString(16)}`}] ${err.message} | len=${decompressed.length} hex=${hex}`;
							} catch {}
						}
						emitter.emit("error", err);
					}
				}
			}
		} catch (err) {
			if (!options.hideErrors) emitter.emit("error", err);
		}
	};

	// ── Outbound pipeline: serialize → compress → frame → encrypt → socket ──

	const writeToSocket = (data: Buffer) => {
		if (!currentSocket || currentSocket.destroyed || ended) return;
		const compressed =
			compressionThreshold >= 0
				? compressPacket(data, compressionThreshold)
				: data;
		const framed = framePacket(compressed);
		const encrypted = cipher ? cipher.update(framed) : framed;
		currentSocket.write(encrypted);
	};

	// ── Build the client ──

	const client = Object.assign(emitter, {
		username: options.username,
		uuid: "",
		version: options.version,
		protocolVersion,
		socket: null as Socket | null,
		autoVersionHooks: [] as ((
			response: unknown,
			client: Client,
			options: ClientOptions,
		) => void)[],

		setSocket: (socket: Socket) => {
			currentSocket = socket;
			client.socket = socket;
			socket.setNoDelay(true);

			socket.on("data", handleData);

			socket.on("error", (err: Error) => {
				emitter.emit("error", err);
			});

			socket.on("close", () => {
				client.end("socket closed");
			});

			socket.on("end", () => {
				client.end("socket end");
			});

			socket.on("connect", () => {
				emitter.emit("connect");
			});
		},

		write: (name: string, params: Record<string, unknown>) => {
			if (!writeCodec)
				throw new Error(`No write codec for state: ${currentState}`);
			const data = writeCodec.write(name, params);
			writeToSocket(data);
		},

		writeRaw: (buffer: Buffer) => {
			writeToSocket(buffer);
		},

		end: (reason?: string) => {
			if (ended) return;
			ended = true;
			emitter.emit("end", reason ?? "client disconnect");
			currentSocket?.end();
		},

		setEncryption: (secret: Buffer) => {
			cipher = createEncryptor(secret);
			decipher = createDecryptor(secret);
		},

		setCompressionThreshold: (threshold: number) => {
			compressionThreshold = threshold;
		},

		registerChannel: (
			_name: string,
			_serializer?: ((params: unknown) => Buffer) | null,
			_deserializer?: ((data: Buffer) => unknown) | null,
			_custom?: boolean,
		) => {},
		writeChannel: (_name: string, _params: unknown) => {},
		unregisterChannel: (_name: string, _custom?: boolean) => {},
	}) as Client;

	// Define state as a getter/setter so codec updates happen on assignment.
	// Object.assign would flatten a getter/setter into a plain data property.
	Object.defineProperty(client, "state", {
		get: () => currentState,
		set: (newState: string) => {
			const oldState = currentState;
			currentState = newState;
			updateCodecs(newState);
			splitter.reset();
			emitter.emit("state", newState, oldState);
		},
		enumerable: true,
		configurable: true,
	});

	return client;
};

// ── TCP connection helper ──

/** Connect a client to a server via TCP. */
export const connectClient = (
	client: Client,
	host = "localhost",
	port = 25565,
) => {
	const socket = tcpConnect({ host, port });
	client.setSocket(socket);
};
