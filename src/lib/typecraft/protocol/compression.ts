/**
 * Packet compression — zlib DEFLATE with varint length prefix.
 * Wire format: [varint: uncompressed_length][data...]
 * If uncompressed_length = 0, data is raw (not compressed).
 * If uncompressed_length > 0, data is DEFLATE-compressed.
 */

import { deflateSync, inflateSync } from "node:zlib";
import { readVarInt, sizeOfVarInt, writeVarInt } from "./varint.ts";

/** Compress a packet if it exceeds the threshold. */
export const compressPacket = (data: Buffer, threshold: number): Buffer => {
	if (data.length < threshold) {
		// Below threshold — send uncompressed with 0 length marker
		const lenSize = sizeOfVarInt(0);
		const out = Buffer.allocUnsafe(lenSize + data.length);
		writeVarInt(0, out, 0);
		data.copy(out, lenSize);
		return out;
	}
	// Above threshold — DEFLATE compress
	const compressed = deflateSync(data);
	const lenSize = sizeOfVarInt(data.length);
	const out = Buffer.allocUnsafe(lenSize + compressed.length);
	writeVarInt(data.length, out, 0);
	compressed.copy(out, lenSize);
	return out;
};

/** Decompress a packet. Returns the raw packet data. */
export const decompressPacket = (data: Buffer): Buffer => {
	const { value: uncompressedLength, size: lenSize } = readVarInt(data, 0);
	const payload = data.subarray(lenSize);
	if (uncompressedLength === 0) return payload;
	return inflateSync(payload);
};
