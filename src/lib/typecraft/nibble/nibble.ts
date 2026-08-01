export const readNibble = (bytes: Uint8Array, index: number): number =>
	(index & 1) === 0 ? bytes[index >>> 1]! & 0x0f : bytes[index >>> 1]! >>> 4;

export const writeNibble = (
	bytes: Uint8Array,
	index: number,
	value: number,
): void => {
	const byteIndex = index >>> 1;
	bytes[byteIndex] =
		(index & 1) === 0
			? (bytes[byteIndex]! & 0xf0) | (value & 0x0f)
			: (bytes[byteIndex]! & 0x0f) | ((value & 0x0f) << 4);
};

export const createNibbleArray = (length: number): Uint8Array =>
	new Uint8Array(length >>> 1);
