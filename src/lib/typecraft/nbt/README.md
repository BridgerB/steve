# nbt

Zero-dependency NBT (Named Binary Tag) parser and writer in pure TypeScript. Replaces `prismarine-nbt` and its `protodef` dependency with ~340 lines of direct binary reading/writing.

NBT is Minecraft's binary serialization format, used for chunks, level.dat, entities, and item data.

## Usage

### Parsing

```ts
import { parseNbt, parseUncompressedNbt } from "typecraft";

// Auto-detect format + decompress gzip/deflate
const { parsed, format } = parseNbt(buffer);

// Explicit format, no decompression
const root = parseUncompressedNbt(buffer, "big");
```

### Writing

```ts
import { writeUncompressedNbt } from "typecraft";

const buffer = writeUncompressedNbt(root, "big");
```

### Building NBT structures

```ts
import { nbtCompound, nbtInt, nbtString, nbtList, nbtByteArray } from "typecraft";

const root = nbtCompound({
  xPos: nbtInt(3),
  zPos: nbtInt(7),
  Status: nbtString("full"),
  Heightmaps: nbtCompound({
    MOTION_BLOCKING: nbtByteArray([0, 1, 2, 3]),
  }),
  Sections: nbtList({
    type: "compound",
    value: [
      { Y: nbtInt(0), BlockStates: nbtByteArray([]) },
      { Y: nbtInt(1), BlockStates: nbtByteArray([]) },
    ],
  }),
});
```

All builders:

| Builder | Type | Value |
|---|---|---|
| `nbtByte(42)` | `"byte"` | `number` |
| `nbtShort(1000)` | `"short"` | `number` |
| `nbtInt(100000)` | `"int"` | `number` |
| `nbtLong([hi, lo])` | `"long"` | `[number, number]` |
| `nbtFloat(0.5)` | `"float"` | `number` |
| `nbtDouble(0.5)` | `"double"` | `number` |
| `nbtString("hello")` | `"string"` | `string` |
| `nbtByteArray([1, 2])` | `"byteArray"` | `number[]` |
| `nbtIntArray([1, 2])` | `"intArray"` | `number[]` |
| `nbtLongArray([[0, 1]])` | `"longArray"` | `[number, number][]` |
| `nbtCompound({ ... })` | `"compound"` | `Record<string, NbtTag>` |
| `nbtList({ type, value })` | `"list"` | `{ type, value[] }` |
| `nbtBool(true)` | `"short"` | `0` or `1` |

### Utilities

```ts
import { simplifyNbt, equalNbt } from "typecraft";

// Strip type wrappers for easy reading
// { type: "compound", value: { x: { type: "int", value: 5 } } }
// becomes { x: 5 }
const plain = simplifyNbt(root);

// Deep structural comparison
const same = equalNbt(a, b);
```

## Formats

| Format | Endianness | Integers | String lengths | Used by |
|---|---|---|---|---|
| `"big"` | Big-endian | Fixed-width | u16 BE | Java Edition |
| `"little"` | Little-endian | Fixed-width | u16 LE | Bedrock Edition |
| `"littleVarint"` | Little-endian | Zigzag + varint | Varint | Bedrock Edition (newer) |

`parseNbt` auto-detects the format. `parseUncompressedNbt` and `writeUncompressedNbt` take an explicit format parameter (defaults to `"big"`).

## Tag types

NBT has 12 data types (plus `"end"` as a terminator):

| ID | Type | Binary size | TypeScript value |
|---|---|---|---|
| 1 | `byte` | 1 byte | `number` |
| 2 | `short` | 2 bytes | `number` |
| 3 | `int` | 4 bytes | `number` |
| 4 | `long` | 8 bytes | `[number, number]` (high, low i32) |
| 5 | `float` | 4 bytes | `number` |
| 6 | `double` | 8 bytes | `number` |
| 7 | `byteArray` | 4 + N bytes | `number[]` |
| 8 | `string` | 2 + N bytes | `string` |
| 9 | `list` | 5 + payload | `{ type, value[] }` |
| 10 | `compound` | variable | `Record<string, NbtTag>` |
| 11 | `intArray` | 4 + 4N bytes | `number[]` |
| 12 | `longArray` | 4 + 8N bytes | `[number, number][]` |

Every value carries its type tag as a discriminated union, so TypeScript narrows correctly:

```ts
const tag: NbtTag = root.value.someField;
if (tag.type === "int") {
  tag.value; // number
}
if (tag.type === "compound") {
  tag.value; // Record<string, NbtTag>
}
```

## Files

| File | Purpose |
|---|---|
| `types.ts` | All type definitions and tag ID lookup tables |
| `read.ts` | Binary reader: buffer bytes to NbtTag (recursive, format-parametric) |
| `write.ts` | Binary writer: NbtTag to buffer bytes (mirrors read.ts) |
| `nbt.ts` | High-level API: parse, write, simplify, equal, builders |
| `index.ts` | Barrel export |
