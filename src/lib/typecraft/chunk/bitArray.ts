/**
 * Packed integer array storing N-bit values in a Uint32Array.
 * Uses the "NoSpan" variant where values never span 64-bit word boundaries.
 * This is the format used by Minecraft Java 1.16+ for block/biome palettes.
 */
export type BitArray = {
	data: Uint32Array;
	bitsPerValue: number;
	capacity: number;
	valuesPerLong: number;
	valueMask: number;
};

/** Number of bits needed to represent a value. */
export const neededBits = (value: number): number => 32 - Math.clz32(value);

export const createBitArray = (
	bitsPerValue: number,
	capacity: number,
): BitArray => {
	const valuesPerLong = Math.floor(64 / bitsPerValue);
	const bufferSize = Math.ceil(capacity / valuesPerLong) * 2;
	return {
		data: new Uint32Array(bufferSize),
		bitsPerValue,
		capacity,
		valuesPerLong,
		valueMask: (1 << bitsPerValue) - 1,
	};
};

export const createBitArrayFromData = (
	data: Uint32Array,
	bitsPerValue: number,
	capacity: number,
): BitArray => ({
	data,
	bitsPerValue,
	capacity,
	valuesPerLong: Math.floor(64 / bitsPerValue),
	valueMask: (1 << bitsPerValue) - 1,
});

export const getBitValue = (arr: BitArray, index: number): number => {
	const startLongIndex = Math.floor(index / arr.valuesPerLong);
	const indexInLong =
		(index - startLongIndex * arr.valuesPerLong) * arr.bitsPerValue;

	if (indexInLong >= 32) {
		const indexInStartLong = indexInLong - 32;
		return (
			(arr.data[startLongIndex * 2 + 1]! >>> indexInStartLong) & arr.valueMask
		);
	}

	let result = arr.data[startLongIndex * 2]! >>> indexInLong;
	const endBitOffset = indexInLong + arr.bitsPerValue;
	if (endBitOffset > 32) {
		result |= arr.data[startLongIndex * 2 + 1]! << (32 - indexInLong);
	}
	return result & arr.valueMask;
};

export const setBitValue = (
	arr: BitArray,
	index: number,
	value: number,
): void => {
	const startLongIndex = Math.floor(index / arr.valuesPerLong);
	const indexInLong =
		(index - startLongIndex * arr.valuesPerLong) * arr.bitsPerValue;

	if (indexInLong >= 32) {
		const indexInStartLong = indexInLong - 32;
		const i = startLongIndex * 2 + 1;
		arr.data[i] =
			((arr.data[i]! & ~(arr.valueMask << indexInStartLong)) |
				((value & arr.valueMask) << indexInStartLong)) >>>
			0;
		return;
	}

	const i = startLongIndex * 2;
	arr.data[i] =
		((arr.data[i]! & ~(arr.valueMask << indexInLong)) |
			((value & arr.valueMask) << indexInLong)) >>>
		0;

	const endBitOffset = indexInLong + arr.bitsPerValue;
	if (endBitOffset > 32) {
		const j = startLongIndex * 2 + 1;
		arr.data[j] =
			((arr.data[j]! & ~((1 << (endBitOffset - 32)) - 1)) |
				(value >> (32 - indexInLong))) >>>
			0;
	}
};

export const resizeBitArray = (
	arr: BitArray,
	newBitsPerValue: number,
): BitArray => {
	const result = createBitArray(newBitsPerValue, arr.capacity);
	for (let i = 0; i < arr.capacity; i++) {
		setBitValue(result, i, getBitValue(arr, i));
	}
	return result;
};

export const resizeBitArrayCapacity = (
	arr: BitArray,
	newCapacity: number,
): BitArray => {
	const result = createBitArray(arr.bitsPerValue, newCapacity);
	const count = Math.min(newCapacity, arr.capacity);
	for (let i = 0; i < count; i++) {
		setBitValue(result, i, getBitValue(arr, i));
	}
	return result;
};

/** Convert to array of [MSB, LSB] pairs for NBT long array serialization. */
export const bitArrayToLongArray = (arr: BitArray): [number, number][] => {
	const result: [number, number][] = [];
	for (let i = 0; i < arr.data.length; i += 2) {
		result.push([(arr.data[i + 1]! << 32) >> 32, (arr.data[i]! << 32) >> 32]);
	}
	return result;
};

/** Create from array of [MSB, LSB] pairs (NBT long array format). */
export const bitArrayFromLongArray = (
	longs: [number, number][] | readonly (readonly [number, number])[],
	bitsPerValue: number,
): BitArray => {
	const capacity = Math.floor(64 / bitsPerValue) * longs.length;
	const data = new Uint32Array(longs.length * 2);
	for (let i = 0; i < longs.length; i++) {
		data[i * 2 + 1] = longs[i]![0]!;
		data[i * 2] = longs[i]![1]!;
	}
	return createBitArrayFromData(data, bitsPerValue, capacity);
};

/** Number of 64-bit longs in the backing store. */
export const bitArrayLongCount = (arr: BitArray): number => arr.data.length / 2;

/** Read BitArray data from a buffer in big-endian 64-bit long format. */
export const readBitArrayData = (
	arr: BitArray,
	buffer: Buffer,
	offset: number,
	longCount: number,
): number => {
	const uint32Count = longCount * 2;
	if (uint32Count !== arr.data.length) {
		arr.data = new Uint32Array(uint32Count);
	}
	for (let i = 0; i < uint32Count; i += 2) {
		arr.data[i + 1] = buffer.readUInt32BE(offset);
		offset += 4;
		arr.data[i] = buffer.readUInt32BE(offset);
		offset += 4;
	}
	return offset;
};

/** Write BitArray data to a buffer in big-endian 64-bit long format. */
export const writeBitArrayData = (
	arr: BitArray,
	buffer: Buffer,
	offset: number,
): number => {
	for (let i = 0; i < arr.data.length; i += 2) {
		offset = buffer.writeUInt32BE(arr.data[i + 1]!, offset);
		offset = buffer.writeUInt32BE(arr.data[i]!, offset);
	}
	return offset;
};
