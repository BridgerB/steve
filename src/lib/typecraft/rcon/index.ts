/**
 * Source RCON client for Minecraft servers.
 * Protocol: TCP, little-endian int32 framing.
 * Packet: [size:i32][id:i32][type:i32][body:string][pad:0x00][pad:0x00]
 */

import { createConnection, type Socket } from "node:net";

export interface RconOptions {
	host?: string;
	port?: number;
	password?: string;
	/** Command timeout in ms (default 5000) */
	timeout?: number;
}

export interface RconClient {
	/** Send a command and return the response */
	command: (cmd: string) => Promise<string>;
	/** Close the connection */
	close: () => void;
	/** Whether the connection is alive */
	readonly connected: boolean;
}

const PACKET_TYPE = {
	AUTH: 3,
	AUTH_RESPONSE: 2,
	COMMAND: 2,
	RESPONSE: 0,
} as const;

const encodePacket = (id: number, type: number, body: string): Buffer => {
	const bodyBuf = Buffer.from(body, "utf8");
	const length = 4 + 4 + bodyBuf.length + 2;
	const buf = Buffer.alloc(4 + length);
	buf.writeInt32LE(length, 0);
	buf.writeInt32LE(id, 4);
	buf.writeInt32LE(type, 8);
	bodyBuf.copy(buf, 12);
	buf.writeInt8(0, 12 + bodyBuf.length);
	buf.writeInt8(0, 13 + bodyBuf.length);
	return buf;
};

const decodePacket = (
	buf: Buffer,
): { id: number; type: number; body: string } => ({
	id: buf.readInt32LE(4),
	type: buf.readInt32LE(8),
	body: buf.toString("utf8", 12, buf.length - 2),
});

/** Strip Minecraft color codes (§X) from a string */
export const stripColors = (s: string): string =>
	s.replace(/§[0-9a-fk-or]/gi, "");

export const createRcon = (options: RconOptions = {}): Promise<RconClient> => {
	const host = options.host ?? "localhost";
	const port = options.port ?? 25575;
	const password = options.password ?? "";
	const cmdTimeout = options.timeout ?? 5000;

	return new Promise((resolve, reject) => {
		let connected = true;
		const socket: Socket = createConnection({ host, port }, () => {
			socket.write(encodePacket(1, PACKET_TYPE.AUTH, password));
		});

		let requestId = 10;
		let pendingResolve: ((body: string) => void) | null = null;
		let dataBuf = Buffer.alloc(0);

		socket.on("data", (chunk) => {
			dataBuf = Buffer.concat([dataBuf, chunk as Buffer]);

			while (dataBuf.length >= 4) {
				const packetLen = dataBuf.readInt32LE(0);
				if (dataBuf.length < 4 + packetLen) break;

				const packet = decodePacket(dataBuf.subarray(0, 4 + packetLen));
				dataBuf = dataBuf.subarray(4 + packetLen);

				if (packet.id === 1) {
					if (packet.type === PACKET_TYPE.AUTH_RESPONSE) {
						resolve(client);
					} else {
						reject(new Error("RCON authentication failed"));
					}
				} else if (pendingResolve) {
					pendingResolve(packet.body);
					pendingResolve = null;
				}
			}
		});

		socket.on("error", (err) => {
			connected = false;
			if (pendingResolve) {
				pendingResolve("");
				pendingResolve = null;
			}
			reject(err);
		});

		socket.on("close", () => {
			connected = false;
		});

		let commandQueue: Promise<string> = Promise.resolve("");

		const client: RconClient = {
			command: (cmd: string): Promise<string> => {
				const prev = commandQueue;
				const next = prev.then(
					() =>
						new Promise<string>((res) => {
							const id = ++requestId;
							pendingResolve = res;
							socket.write(encodePacket(id, PACKET_TYPE.COMMAND, cmd));
							setTimeout(() => {
								if (pendingResolve === res) {
									pendingResolve = null;
									res("");
								}
							}, cmdTimeout);
						}),
				);
				commandQueue = next.catch(() => "");
				return next;
			},
			close: () => {
				connected = false;
				socket.destroy();
			},
			get connected() {
				return connected;
			},
		};
	});
};
