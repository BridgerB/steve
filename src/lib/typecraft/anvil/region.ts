import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { promisify } from "node:util";
import { deflate, gunzip, inflate } from "node:zlib";
import { parseNbt, writeUncompressedNbt } from "../nbt/index.ts";
import type { NbtRoot } from "../nbt/types.ts";

const deflateAsync = promisify(deflate);
const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);

const SECTOR_BYTES = 4096;
const SECTOR_INTS = SECTOR_BYTES / 4;
const CHUNK_HEADER_SIZE = 5;
const VERSION_GZIP = 1;
const VERSION_DEFLATE = 2;

export type RegionFile = {
	fileName: string;
	file: FileHandle;
	offsets: number[];
	chunkTimestamps: number[];
	sectorFree: boolean[];
};

/** Open or create a region file. */
export const openRegionFile = async (path: string): Promise<RegionFile> => {
	let file: FileHandle;
	try {
		file = await fs.open(path, "r+");
	} catch {
		file = await fs.open(path, "w+");
	}

	const stat = await fs.stat(path);
	let size = stat.size;

	if (size < SECTOR_BYTES) {
		const empty = Buffer.alloc(SECTOR_BYTES);
		await file.write(empty, 0, SECTOR_BYTES, 0);
		await file.write(empty, 0, SECTOR_BYTES, SECTOR_BYTES);
		size = SECTOR_BYTES * 2;
	}

	if ((size & 0xfff) !== 0) {
		const remaining = SECTOR_BYTES - (size & 0xfff);
		await file.write(Buffer.alloc(remaining), 0, remaining, size);
		size += remaining;
	}

	const nSectors = Math.floor(size / SECTOR_BYTES);
	const sectorFree: boolean[] = [];
	for (let i = 0; i < nSectors; i++) {
		sectorFree.push(true);
	}
	sectorFree[0] = false; // offset table
	sectorFree[1] = false; // timestamps

	const offsets: number[] = [];
	const offsetBuf = Buffer.alloc(SECTOR_BYTES);
	await file.read(offsetBuf, 0, SECTOR_BYTES, 0);
	for (let i = 0; i < SECTOR_INTS; i++) {
		const offset = offsetBuf.readUInt32BE(i * 4);
		offsets[i] = offset;
		if (offset !== 0 && (offset >> 8) + (offset & 0xff) <= sectorFree.length) {
			for (let s = 0; s < (offset & 0xff); s++) {
				sectorFree[(offset >> 8) + s] = false;
			}
		}
	}

	const chunkTimestamps: number[] = [];
	const tsBuf = Buffer.alloc(SECTOR_BYTES);
	await file.read(tsBuf, 0, SECTOR_BYTES, SECTOR_BYTES);
	for (let i = 0; i < SECTOR_INTS; i++) {
		chunkTimestamps[i] = tsBuf.readUInt32BE(i * 4);
	}

	return { fileName: path, file, offsets, chunkTimestamps, sectorFree };
};

/** Check if a chunk exists in the region. */
export const hasChunk = (region: RegionFile, x: number, z: number): boolean =>
	(region.offsets[x + z * 32] ?? 0) !== 0;

/** Read a chunk's NBT data from the region file. Returns null if not present. */
export const readRegionChunk = async (
	region: RegionFile,
	x: number,
	z: number,
): Promise<NbtRoot | null> => {
	const offset = region.offsets[x + z * 32] ?? 0;
	if (offset === 0) return null;

	const sectorNumber = offset >> 8;
	const numSectors = offset & 0xff;

	if (sectorNumber + numSectors > region.sectorFree.length) return null;

	const lengthBuf = Buffer.alloc(4);
	await region.file.read(lengthBuf, 0, 4, sectorNumber * SECTOR_BYTES);
	const length = lengthBuf.readUInt32BE(0);
	if (length <= 1) return null;
	if (length > SECTOR_BYTES * numSectors) return null;

	const versionBuf = Buffer.alloc(1);
	await region.file.read(versionBuf, 0, 1, sectorNumber * SECTOR_BYTES + 4);
	const version = versionBuf.readUInt8(0);

	const dataBuf = Buffer.alloc(length - 1);
	await region.file.read(
		dataBuf,
		0,
		length - 1,
		sectorNumber * SECTOR_BYTES + 5,
	);

	let decompressed: Buffer;
	if (version === VERSION_GZIP) {
		decompressed = await gunzipAsync(dataBuf);
	} else if (version === VERSION_DEFLATE) {
		decompressed = await inflateAsync(dataBuf);
	} else {
		throw new Error(`Unknown compression version: ${version}`);
	}

	const { parsed } = parseNbt(decompressed);
	return parsed;
};

/** Write a chunk's NBT data to the region file. */
export const writeRegionChunk = async (
	region: RegionFile,
	x: number,
	z: number,
	nbtData: NbtRoot,
): Promise<void> => {
	const uncompressed = writeUncompressedNbt(nbtData);
	const compressed = await deflateAsync(uncompressed);

	const length = compressed.length + 1;
	const offset = region.offsets[x + z * 32] ?? 0;
	let sectorNumber = offset >> 8;
	const sectorsAllocated = offset & 0xff;
	const sectorsNeeded =
		Math.floor((length + CHUNK_HEADER_SIZE) / SECTOR_BYTES) + 1;

	if (sectorsNeeded >= 256) {
		throw new Error("Chunk data too large (max 1MB)");
	}

	if (sectorNumber !== 0 && sectorsAllocated === sectorsNeeded) {
		await writeChunkData(region, sectorNumber, compressed, length);
	} else {
		for (let i = 0; i < sectorsAllocated; i++) {
			region.sectorFree[sectorNumber + i] = true;
		}

		let runStart = region.sectorFree.indexOf(true);
		let runLength = 0;
		if (runStart !== -1) {
			for (let i = runStart; i < region.sectorFree.length; i++) {
				if (region.sectorFree[i]) {
					if (runLength === 0) runStart = i;
					runLength++;
				} else {
					runLength = 0;
				}
				if (runLength >= sectorsNeeded) break;
			}
		}

		if (runLength >= sectorsNeeded) {
			sectorNumber = runStart;
			await setOffset(region, x, z, (sectorNumber << 8) | sectorsNeeded);
			for (let i = 0; i < sectorsNeeded; i++) {
				region.sectorFree[sectorNumber + i] = false;
			}
			await writeChunkData(region, sectorNumber, compressed, length);
		} else {
			const stat = await fs.stat(region.fileName);
			sectorNumber = region.sectorFree.length;
			const toGrow = sectorsNeeded * SECTOR_BYTES;
			await region.file.write(Buffer.alloc(toGrow), 0, toGrow, stat.size);
			for (let i = 0; i < sectorsNeeded; i++) {
				region.sectorFree.push(false);
			}
			await writeChunkData(region, sectorNumber, compressed, length);
			await setOffset(region, x, z, (sectorNumber << 8) | sectorsNeeded);
		}
	}

	await setTimestamp(region, x, z, Math.floor(Date.now() / 1000));
};

const writeChunkData = async (
	region: RegionFile,
	sectorNumber: number,
	data: Buffer,
	length: number,
): Promise<void> => {
	const buffer = Buffer.alloc(4 + 1 + data.length);
	buffer.writeUInt32BE(length, 0);
	buffer.writeUInt8(VERSION_DEFLATE, 4);
	data.copy(buffer, 5);
	await region.file.write(
		buffer,
		0,
		buffer.length,
		sectorNumber * SECTOR_BYTES,
	);
};

const setOffset = async (
	region: RegionFile,
	x: number,
	z: number,
	offset: number,
): Promise<void> => {
	region.offsets[x + z * 32] = offset;
	const buf = Buffer.alloc(4);
	buf.writeInt32BE(offset, 0);
	await region.file.write(buf, 0, 4, (x + z * 32) * 4);
};

const setTimestamp = async (
	region: RegionFile,
	x: number,
	z: number,
	value: number,
): Promise<void> => {
	region.chunkTimestamps[x + z * 32] = value;
	const buf = Buffer.alloc(4);
	buf.writeInt32BE(value, 0);
	await region.file.write(buf, 0, 4, SECTOR_BYTES + (x + z * 32) * 4);
};

/** Close the region file handle. */
export const closeRegionFile = async (region: RegionFile): Promise<void> => {
	await region.file.close();
};
