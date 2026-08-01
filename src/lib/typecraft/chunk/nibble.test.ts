import { describe, expect, it } from "vitest";
import { createNibbleArray, readNibble, writeNibble } from "../index.ts";

describe("readNibble", () => {
	it("reads low nibble at even index", () => {
		expect(readNibble(new Uint8Array([0xab]), 0)).toBe(0x0b);
	});

	it("reads high nibble at odd index", () => {
		expect(readNibble(new Uint8Array([0xab]), 1)).toBe(0x0a);
	});

	it("reads across multiple bytes", () => {
		const bytes = new Uint8Array([0x12, 0x34]);
		expect(readNibble(bytes, 0)).toBe(0x02);
		expect(readNibble(bytes, 1)).toBe(0x01);
		expect(readNibble(bytes, 2)).toBe(0x04);
		expect(readNibble(bytes, 3)).toBe(0x03);
	});
});

describe("writeNibble", () => {
	it("writes low nibble at even index", () => {
		const bytes = new Uint8Array([0x00]);
		writeNibble(bytes, 0, 0x0f);
		expect(bytes[0]).toBe(0x0f);
	});

	it("writes high nibble at odd index", () => {
		const bytes = new Uint8Array([0x00]);
		writeNibble(bytes, 1, 0x0f);
		expect(bytes[0]).toBe(0xf0);
	});

	it("preserves low nibble when writing high", () => {
		const bytes = new Uint8Array([0x05]);
		writeNibble(bytes, 1, 0x0a);
		expect(bytes[0]).toBe(0xa5);
	});

	it("preserves high nibble when writing low", () => {
		const bytes = new Uint8Array([0xa0]);
		writeNibble(bytes, 0, 0x05);
		expect(bytes[0]).toBe(0xa5);
	});

	it("masks value to 4 bits", () => {
		const bytes = new Uint8Array([0x00]);
		writeNibble(bytes, 0, 0xff);
		expect(bytes[0]).toBe(0x0f);
	});
});

describe("createNibbleArray", () => {
	it("allocates half the nibble count in bytes", () => {
		expect(createNibbleArray(4096).length).toBe(2048);
	});

	it("is zero-filled", () => {
		const bytes = createNibbleArray(8);
		expect(Array.from(bytes)).toEqual([0, 0, 0, 0]);
	});
});

describe("roundtrip", () => {
	it("writes and reads all 16 values", () => {
		const bytes = createNibbleArray(16);
		for (let i = 0; i < 16; i++) writeNibble(bytes, i, i);
		for (let i = 0; i < 16; i++) expect(readNibble(bytes, i)).toBe(i);
	});

	it("roundtrips a full 4096-nibble section", () => {
		const bytes = createNibbleArray(4096);
		for (let i = 0; i < 4096; i++) writeNibble(bytes, i, i & 0x0f);
		for (let i = 0; i < 4096; i++) expect(readNibble(bytes, i)).toBe(i & 0x0f);
	});
});
