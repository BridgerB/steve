/**
 * Server list ping — query a Minecraft server for MOTD, player count, version info.
 * Uses the STATUS protocol state.
 */

import { connect as tcpConnect } from "node:net";
import { buildProtocol } from "./build-protocol.ts";
import { createPacketCodec, type PacketCodec } from "./codec.ts";
import { createSplitter, framePacket } from "./framing.ts";
import { Direction, ProtocolState } from "./states.ts";

export type PingResponse = {
	readonly version: { readonly name: string; readonly protocol: number };
	readonly players: {
		readonly online: number;
		readonly max: number;
		readonly sample?: readonly { readonly name: string; readonly id: string }[];
	};
	readonly description: unknown;
	readonly favicon?: string;
	readonly latency: number;
};

export type PingOptions = {
	readonly host?: string;
	readonly port?: number;
	readonly version?: string;
	readonly timeout?: number;
};

/** Ping a Minecraft server and return its status. */
export const ping = (options: PingOptions = {}): Promise<PingResponse> => {
	const host = options.host ?? "localhost";
	const port = options.port ?? 25565;
	const timeout = options.timeout ?? 5000;

	const schema = buildProtocol();
	const protocol = schema.protocol;
	const sharedTypes = protocol.types as Record<string, unknown>;
	const protocolVersion = schema.version.version;

	return new Promise((resolve, reject) => {
		const socket = tcpConnect({ host, port });
		socket.setNoDelay(true);

		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error(`Ping timeout after ${timeout}ms`));
		}, timeout);

		const cleanup = () => {
			clearTimeout(timer);
			socket.destroy();
		};

		socket.on("error", (err) => {
			cleanup();
			reject(err);
		});

		// Build codecs for HANDSHAKING and STATUS states
		const statusData = protocol[ProtocolState.STATUS] as Record<
			string,
			Record<string, unknown>
		>;
		const handshakeData = protocol[ProtocolState.HANDSHAKING] as Record<
			string,
			Record<string, unknown>
		>;

		const handshakeTypes = handshakeData[Direction.TO_SERVER]!.types as Record<
			string,
			unknown
		>;
		const statusWriteTypes = statusData[Direction.TO_SERVER]!.types as Record<
			string,
			unknown
		>;
		const statusReadTypes = statusData[Direction.TO_CLIENT]!.types as Record<
			string,
			unknown
		>;

		const handshakeCodec = createPacketCodec({
			types: { ...sharedTypes, ...handshakeTypes },
		});
		const statusWriteCodec = createPacketCodec({
			types: { ...sharedTypes, ...statusWriteTypes },
		});
		const statusReadCodec = createPacketCodec({
			types: { ...sharedTypes, ...statusReadTypes },
		});

		const splitter = createSplitter();
		let serverInfo: Record<string, unknown> | null = null;
		let pingTime = 0n;

		const writePacket = (
			codec: PacketCodec,
			name: string,
			params: Record<string, unknown>,
		) => {
			socket.write(framePacket(codec.write(name, params)));
		};

		socket.on("connect", () => {
			writePacket(handshakeCodec, "intention", {
				protocolVersion,
				serverHost: host,
				serverPort: port,
				nextState: 1, // STATUS
			});
			writePacket(statusWriteCodec, "status_request", {});
		});

		socket.on("data", (chunk: Buffer) => {
			try {
				for (const raw of splitter.write(chunk)) {
					const { name, params } = statusReadCodec.read(raw);

					if (name === "status_response") {
						serverInfo = JSON.parse(params.response as string);
						pingTime = process.hrtime.bigint();
						writePacket(statusWriteCodec, "ping_request", { time: 0n });
					} else if (name === "pong_response" && serverInfo) {
						const latency = Math.round(
							Number(process.hrtime.bigint() - pingTime) / 1_000_000,
						);
						cleanup();
						resolve({
							version: serverInfo.version as PingResponse["version"],
							players: serverInfo.players as PingResponse["players"],
							description: serverInfo.description,
							favicon: serverInfo.favicon as string | undefined,
							latency,
						});
					}
				}
			} catch (err) {
				cleanup();
				reject(err);
			}
		});
	});
};
