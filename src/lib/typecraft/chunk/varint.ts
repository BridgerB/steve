/** Read a protocol varint from a buffer at offset. Returns [value, newOffset]. */
export const readVarint = (
	buffer: Buffer,
	offset: number,
): [number, number] => {
	let numRead = 0;
	let result = 0;
	let byte: number;
	do {
		byte = buffer.readUInt8(offset++);
		result |= (byte & 0x7f) << (7 * numRead);
		numRead++;
		if (numRead > 5) {
			throw new Error("varint is too big");
		}
	} while ((byte & 0x80) !== 0);
	return [result, offset];
};

/** Write a protocol varint to a buffer at offset. Returns new offset. */
export const writeVarint = (
	buffer: Buffer,
	offset: number,
	value: number,
): number => {
	do {
		let temp = value & 0x7f;
		value >>>= 7;
		if (value !== 0) {
			temp |= 0x80;
		}
		offset = buffer.writeUInt8(temp, offset);
	} while (value !== 0);
	return offset;
};
