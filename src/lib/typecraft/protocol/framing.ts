/**
 * Packet framing — varint length-prefix encoding/decoding.
 * Wire format: [varint: packet_length][packet_data...]
 */

import { readVarInt, sizeOfVarInt, writeVarInt } from "./varint.ts";

/** Frame a packet by prepending its varint-encoded length. */
export const framePacket = (data: Buffer): Buffer => {
	const lenSize = sizeOfVarInt(data.length);
	const framed = Buffer.allocUnsafe(lenSize + data.length);
	writeVarInt(data.length, framed, 0);
	data.copy(framed, lenSize);
	return framed;
};

/**
 * Packet splitter — extracts complete packets from a stream of bytes.
 * Accumulates data internally and yields complete packets.
 */
export const createSplitter = (): {
	readonly write: (chunk: Buffer) => Buffer[];
	readonly reset: () => void;
} => {
	let buffer: Buffer = Buffer.alloc(0);

	return {
		write: (chunk: Buffer): Buffer[] => {
			buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
			const packets: Buffer[] = [];

			while (buffer.length > 0) {
				let packetLen: number;
				let lenSize: number;
				try {
					const result = readVarInt(buffer, 0);
					packetLen = result.value;
					lenSize = result.size;
				} catch {
					// Incomplete varint — wait for more data
					break;
				}

				if (buffer.length < lenSize + packetLen) break;

				packets.push(buffer.subarray(lenSize, lenSize + packetLen));
				buffer = buffer.subarray(lenSize + packetLen);
			}

			return packets;
		},

		reset: () => {
			buffer = Buffer.alloc(0);
		},
	};
};
