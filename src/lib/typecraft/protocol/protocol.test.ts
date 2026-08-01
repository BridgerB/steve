import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildProtocol } from "./build-protocol.ts";
import { createPacketCodec, createTypeRegistry } from "./codec.ts";
import { compressPacket, decompressPacket } from "./compression.ts";
import { createDecryptor, createEncryptor } from "./encryption.ts";
import { createSplitter, framePacket } from "./framing.ts";
import { Direction, ProtocolState } from "./states.ts";
import {
	readVarInt,
	readVarLong,
	sizeOfVarInt,
	sizeOfVarLong,
	writeVarInt,
	writeVarLong,
} from "./varint.ts";

// ── VarInt ──

describe("varint", () => {
	const cases: [number, number[]][] = [
		[0, [0x00]],
		[1, [0x01]],
		[127, [0x7f]],
		[128, [0x80, 0x01]],
		[255, [0xff, 0x01]],
		[25565, [0xdd, 0xc7, 0x01]],
		[2097151, [0xff, 0xff, 0x7f]],
		[2147483647, [0xff, 0xff, 0xff, 0xff, 0x07]],
		[-1, [0xff, 0xff, 0xff, 0xff, 0x0f]],
		[-2147483648, [0x80, 0x80, 0x80, 0x80, 0x08]],
	];

	it("reads varint correctly", () => {
		for (const [expected, bytes] of cases) {
			const buf = Buffer.from(bytes);
			const { value, size } = readVarInt(buf, 0);
			expect(value).toBe(expected);
			expect(size).toBe(bytes.length);
		}
	});

	it("writes varint correctly", () => {
		for (const [value, expectedBytes] of cases) {
			const buf = Buffer.alloc(5);
			const end = writeVarInt(value, buf, 0);
			expect(end).toBe(expectedBytes.length);
			expect([...buf.subarray(0, end)]).toEqual(expectedBytes);
		}
	});

	it("sizeOfVarInt matches actual size", () => {
		for (const [value, expectedBytes] of cases) {
			expect(sizeOfVarInt(value)).toBe(expectedBytes.length);
		}
	});

	it("reads varint at offset", () => {
		const buf = Buffer.from([0xaa, 0xbb, 0xdd, 0xc7, 0x01, 0xcc]);
		const { value, size } = readVarInt(buf, 2);
		expect(value).toBe(25565);
		expect(size).toBe(3);
	});

	it("throws on varint too big", () => {
		const buf = Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
		expect(() => readVarInt(buf, 0)).toThrow("VarInt too big");
	});
});

// ── VarLong ──

describe("varlong", () => {
	it("reads/writes zero", () => {
		const buf = Buffer.alloc(10);
		const end = writeVarLong(0n, buf, 0);
		expect(end).toBe(1);
		const { value, size } = readVarLong(buf, 0);
		expect(value).toBe(0n);
		expect(size).toBe(1);
	});

	it("round-trips positive values", () => {
		const values = [1n, 127n, 128n, 255n, 2147483647n, 9223372036854775807n];
		for (const v of values) {
			const buf = Buffer.alloc(10);
			const end = writeVarLong(v, buf, 0);
			const { value } = readVarLong(buf, 0);
			expect(value).toBe(v);
			expect(sizeOfVarLong(v)).toBe(end);
		}
	});

	it("round-trips negative values", () => {
		const buf = Buffer.alloc(10);
		writeVarLong(-1n, buf, 0);
		const { value } = readVarLong(buf, 0);
		expect(value).toBe(-1n);
	});

	it("throws on varlong too big", () => {
		const buf = Buffer.alloc(11).fill(0x80);
		expect(() => readVarLong(buf, 0)).toThrow("VarLong too big");
	});
});

// ── Framing ──

describe("framing", () => {
	it("frames a packet with length prefix", () => {
		const data = Buffer.from([0x01, 0x02, 0x03]);
		const framed = framePacket(data);
		expect(framed[0]).toBe(3); // varint length = 3
		expect(framed.subarray(1)).toEqual(data);
	});

	it("frames a packet with multi-byte length", () => {
		const data = Buffer.alloc(200, 0xab);
		const framed = framePacket(data);
		const { value: len, size } = readVarInt(framed, 0);
		expect(len).toBe(200);
		expect(framed.subarray(size)).toEqual(data);
	});

	it("splitter extracts single packet", () => {
		const splitter = createSplitter();
		const data = Buffer.from([0x01, 0x02, 0x03]);
		const framed = framePacket(data);
		const packets = splitter.write(framed);
		expect(packets).toHaveLength(1);
		expect(packets[0]).toEqual(data);
	});

	it("splitter extracts multiple packets", () => {
		const splitter = createSplitter();
		const pkt1 = framePacket(Buffer.from([0x01]));
		const pkt2 = framePacket(Buffer.from([0x02, 0x03]));
		const combined = Buffer.concat([pkt1, pkt2]);
		const packets = splitter.write(combined);
		expect(packets).toHaveLength(2);
		expect(packets[0]).toEqual(Buffer.from([0x01]));
		expect(packets[1]).toEqual(Buffer.from([0x02, 0x03]));
	});

	it("splitter handles partial data across writes", () => {
		const splitter = createSplitter();
		const data = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
		const framed = framePacket(data);

		// Send first 3 bytes
		const packets1 = splitter.write(framed.subarray(0, 3));
		expect(packets1).toHaveLength(0);

		// Send remaining bytes
		const packets2 = splitter.write(framed.subarray(3));
		expect(packets2).toHaveLength(1);
		expect(packets2[0]).toEqual(data);
	});

	it("splitter reset clears buffer", () => {
		const splitter = createSplitter();
		// Write partial data
		splitter.write(Buffer.from([0x05, 0x01]));
		splitter.reset();
		// Write a complete packet
		const packets = splitter.write(framePacket(Buffer.from([0xaa])));
		expect(packets).toHaveLength(1);
		expect(packets[0]).toEqual(Buffer.from([0xaa]));
	});
});

// ── Compression ──

describe("compression", () => {
	it("does not compress below threshold", () => {
		const data = Buffer.from([0x01, 0x02, 0x03]);
		const compressed = compressPacket(data, 256);
		const { value: uncompLen } = readVarInt(compressed, 0);
		expect(uncompLen).toBe(0); // 0 = not compressed
	});

	it("compresses above threshold", () => {
		const data = Buffer.alloc(512, 0xab);
		const compressed = compressPacket(data, 256);
		const { value: uncompLen } = readVarInt(compressed, 0);
		expect(uncompLen).toBe(512);
		expect(compressed.length).toBeLessThan(data.length);
	});

	it("round-trips compressed data", () => {
		const data = Buffer.alloc(512, 0xab);
		const compressed = compressPacket(data, 256);
		const decompressed = decompressPacket(compressed);
		expect(decompressed).toEqual(data);
	});

	it("round-trips uncompressed data", () => {
		const data = Buffer.from([0x01, 0x02, 0x03]);
		const compressed = compressPacket(data, 256);
		const decompressed = decompressPacket(compressed);
		expect(decompressed).toEqual(data);
	});
});

// ── Encryption ──

describe("encryption", () => {
	it("round-trips data through encrypt/decrypt", () => {
		const secret = randomBytes(16);
		const enc = createEncryptor(secret);
		const dec = createDecryptor(secret);

		const plaintext = Buffer.from("Hello Minecraft!");
		const encrypted = enc.update(plaintext);
		const decrypted = dec.update(encrypted);

		expect(decrypted).toEqual(plaintext);
	});

	it("handles streaming correctly", () => {
		const secret = randomBytes(16);
		const enc = createEncryptor(secret);
		const dec = createDecryptor(secret);

		const chunk1 = Buffer.from("chunk1");
		const chunk2 = Buffer.from("chunk2");

		const enc1 = enc.update(chunk1);
		const enc2 = enc.update(chunk2);

		const dec1 = dec.update(enc1);
		const dec2 = dec.update(enc2);

		expect(dec1).toEqual(chunk1);
		expect(dec2).toEqual(chunk2);
	});
});

// ── States ──

describe("states", () => {
	it("has all protocol states", () => {
		expect(ProtocolState.HANDSHAKING).toBe("handshaking");
		expect(ProtocolState.STATUS).toBe("status");
		expect(ProtocolState.LOGIN).toBe("login");
		expect(ProtocolState.CONFIGURATION).toBe("configuration");
		expect(ProtocolState.PLAY).toBe("play");
	});

	it("has directions", () => {
		expect(Direction.TO_CLIENT).toBe("toClient");
		expect(Direction.TO_SERVER).toBe("toServer");
	});
});

// ── Codec ──

describe("codec", () => {
	const schema = buildProtocol();
	const protocol = schema.protocol;
	const sharedTypes = protocol.types as Record<string, unknown>;

	describe("type registry", () => {
		it("resolves primitive types", () => {
			const registry = createTypeRegistry(sharedTypes);

			// bool
			const boolType = registry.resolve("bool");
			const boolBuf = Buffer.alloc(1);
			boolType.write(true, boolBuf, 0, {});
			expect(boolType.read(boolBuf, 0, {}).value).toBe(true);
			expect(boolType.sizeOf(true, {})).toBe(1);

			// varint
			const viType = registry.resolve("varint");
			const viBuf = Buffer.alloc(5);
			const viEnd = viType.write(25565, viBuf, 0, {});
			expect(viType.read(viBuf, 0, {}).value).toBe(25565);
			expect(viType.sizeOf(25565, {})).toBe(viEnd);

			// i32
			const i32Type = registry.resolve("i32");
			const i32Buf = Buffer.alloc(4);
			i32Type.write(42, i32Buf, 0, {});
			expect(i32Type.read(i32Buf, 0, {}).value).toBe(42);

			// f64
			const f64Type = registry.resolve("f64");
			const f64Buf = Buffer.alloc(8);
			f64Type.write(3.14, f64Buf, 0, {});
			expect(f64Type.read(f64Buf, 0, {}).value).toBeCloseTo(3.14);
		});

		it("resolves UUID type", () => {
			const registry = createTypeRegistry(sharedTypes);
			const uuidType = registry.resolve("UUID");
			const uuid = "12345678-1234-1234-1234-123456789abc";
			const buf = Buffer.alloc(16);
			uuidType.write(uuid, buf, 0, {});
			expect(uuidType.read(buf, 0, {}).value).toBe(uuid);
			expect(uuidType.sizeOf(uuid, {})).toBe(16);
		});

		it("resolves pstring type", () => {
			const registry = createTypeRegistry(sharedTypes);
			// pstring is defined in protocol.json: ["pstring", {"countType":"varint"}]
			const strType = registry.resolve("string");
			const buf = Buffer.alloc(100);
			const end = strType.write("Hello", buf, 0, {});
			expect(end).toBe(6); // 1 byte varint length + 5 bytes "Hello"
			const { value, size } = strType.read(buf, 0, {});
			expect(value).toBe("Hello");
			expect(size).toBe(6);
		});

		it("resolves option type", () => {
			const registry = createTypeRegistry(sharedTypes);
			// Build an option type directly
			const optType = registry.resolve(["option", "varint"]);
			const buf = Buffer.alloc(10);

			// Write present value
			let end = optType.write(42, buf, 0, {});
			let result = optType.read(buf, 0, {});
			expect(result.value).toBe(42);
			expect(result.size).toBe(end);

			// Write absent value
			end = optType.write(null, buf, 0, {});
			result = optType.read(buf, 0, {});
			expect(result.value).toBeUndefined();
			expect(result.size).toBe(1);
		});

		it("resolves optvarint as varint alias", () => {
			const registry = createTypeRegistry(sharedTypes);
			// optvarint is just varint in protocol.json (0 means absent at app level)
			const optType = registry.resolve("optvarint");
			const buf = Buffer.alloc(5);
			optType.write(0, buf, 0, {});
			expect(optType.read(buf, 0, {}).value).toBe(0);
			optType.write(42, buf, 0, {});
			expect(optType.read(buf, 0, {}).value).toBe(42);
		});

		it("resolves restBuffer type", () => {
			const registry = createTypeRegistry(sharedTypes);
			const rbType = registry.resolve("restBuffer");
			const data = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
			const { value, size } = rbType.read(data, 2, {});
			expect(size).toBe(3);
			expect(value).toEqual(Buffer.from([0x03, 0x04, 0x05]));
		});
	});

	describe("packet codec", () => {
		it("creates codec for handshaking toServer", () => {
			const handshakeData = protocol[ProtocolState.HANDSHAKING] as Record<
				string,
				Record<string, unknown>
			>;
			const types = {
				...sharedTypes,
				...handshakeData[Direction.TO_SERVER].types,
			};
			const codec = createPacketCodec({ types });

			expect(codec.packetIds.get("intention")).toBe(0);
			expect(codec.packetNames.get(0)).toBe("intention");
		});

		it("round-trips handshake packet", () => {
			const handshakeData = protocol[ProtocolState.HANDSHAKING] as Record<
				string,
				Record<string, unknown>
			>;
			const types = {
				...sharedTypes,
				...handshakeData[Direction.TO_SERVER].types,
			};
			const codec = createPacketCodec({ types });

			const params = {
				protocolVersion: 765,
				serverHost: "localhost",
				serverPort: 25565,
				nextState: 2,
			};
			const buf = codec.write("intention", params);
			const result = codec.read(buf);

			expect(result.name).toBe("intention");
			expect(result.params.protocolVersion).toBe(765);
			expect(result.params.serverHost).toBe("localhost");
			expect(result.params.serverPort).toBe(25565);
			expect(result.params.nextState).toBe(2);
		});

		it("round-trips hello (login start) packet", () => {
			const loginData = protocol[ProtocolState.LOGIN] as Record<
				string,
				Record<string, unknown>
			>;
			const types = {
				...sharedTypes,
				...loginData[Direction.TO_SERVER].types,
			};
			const codec = createPacketCodec({ types });

			const params = {
				name: "Steve",
				profileId: "12345678-1234-1234-1234-123456789abc",
			};
			const buf = codec.write("hello", params);
			const result = codec.read(buf);

			expect(result.name).toBe("hello");
			expect(result.params.name).toBe("Steve");
			expect(result.params.profileId).toBe(
				"12345678-1234-1234-1234-123456789abc",
			);
		});

		it("round-trips status_request packet", () => {
			const statusData = protocol[ProtocolState.STATUS] as Record<
				string,
				Record<string, unknown>
			>;
			const types = {
				...sharedTypes,
				...statusData[Direction.TO_SERVER].types,
			};
			const codec = createPacketCodec({ types });

			const buf = codec.write("status_request", {});
			const result = codec.read(buf);
			expect(result.name).toBe("status_request");
		});

		it("creates codec for play toClient", () => {
			const playData = protocol[ProtocolState.PLAY] as Record<
				string,
				Record<string, unknown>
			>;
			const types = {
				...sharedTypes,
				...playData[Direction.TO_CLIENT].types,
			};
			const codec = createPacketCodec({ types });

			// Should have lots of packet mappings
			expect(codec.packetNames.size).toBeGreaterThan(50);
		});

		it("round-trips keep_alive packet", () => {
			const playData = protocol[ProtocolState.PLAY] as Record<
				string,
				Record<string, unknown>
			>;
			const serverTypes = {
				...sharedTypes,
				...playData[Direction.TO_CLIENT].types,
			};
			const clientTypes = {
				...sharedTypes,
				...playData[Direction.TO_SERVER].types,
			};
			const serverCodec = createPacketCodec({ types: serverTypes });
			const clientCodec = createPacketCodec({ types: clientTypes });

			// Server sends keep_alive
			const serverBuf = serverCodec.write("keep_alive", {
				keepAliveId: 12345n,
			});
			const received = serverCodec.read(serverBuf);
			expect(received.name).toBe("keep_alive");
			expect(received.params.keepAliveId).toBe(12345n);

			// Client echoes back
			const clientBuf = clientCodec.write("keep_alive", {
				keepAliveId: received.params.keepAliveId as bigint,
			});
			const echoed = clientCodec.read(clientBuf);
			expect(echoed.params.keepAliveId).toBe(12345n);
		});

		it("round-trips chat packet", () => {
			const playData = protocol[ProtocolState.PLAY] as Record<
				string,
				Record<string, unknown>
			>;
			const types = {
				...sharedTypes,
				...playData[Direction.TO_SERVER].types,
			};
			const codec = createPacketCodec({ types });

			const params = {
				message: "Hello world!",
				timestamp: 1234567890n,
				salt: 0n,
				offset: 0,
				acknowledged: Buffer.alloc(3, 0),
			};
			const buf = codec.write("chat", params);
			const result = codec.read(buf);

			expect(result.name).toBe("chat");
			expect(result.params.message).toBe("Hello world!");
		});
	});
});

// ── Full pipeline ──

describe("full pipeline", () => {
	it("frame → compress → encrypt → decrypt → decompress → split", () => {
		const secret = randomBytes(16);
		const enc = createEncryptor(secret);
		const dec = createDecryptor(secret);
		const splitter = createSplitter();

		// Simulate sending 3 packets
		const packets = [
			Buffer.from([0x00, 0x01, 0x02]),
			Buffer.from([0x10, 0x11]),
			Buffer.alloc(300, 0xab), // This one will get compressed
		];

		let wire = Buffer.alloc(0);
		for (const pkt of packets) {
			const compressed = compressPacket(pkt, 256);
			const framed = framePacket(compressed);
			const encrypted = enc.update(framed);
			wire = Buffer.concat([wire, encrypted]);
		}

		// Receive side
		const decrypted = dec.update(wire);
		const received = splitter.write(decrypted);
		expect(received).toHaveLength(3);

		for (let i = 0; i < packets.length; i++) {
			const decompressed = decompressPacket(received[i]);
			expect(decompressed).toEqual(packets[i]);
		}
	});
});
