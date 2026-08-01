# chunk

Minecraft chunk data structures — BitArray, PaletteContainer, ChunkSection, BiomeSection, and ChunkColumn. Pure data structures with no file I/O.

Targets Java Edition 1.18+ (384-block world height, -64 to 319, palette-based biomes).

## Usage

```ts
import {
  createChunkColumn,
  getBlockStateId,
  setBlockStateId,
  getBiomeId,
  setBiomeId,
  getBlockLight,
  setBlockLight,
  neededBits,
} from "typecraft";

// Create a chunk column
const col = createChunkColumn({
  minY: -64,
  worldHeight: 384,
  maxBitsPerBlock: neededBits(maxBlockStateId),
  maxBitsPerBiome: neededBits(biomeCount),
});

// Block access (x, y, z in chunk-local coords: 0-15, minY..maxY, 0-15)
setBlockStateId(col, 5, 64, 5, stoneStateId);
getBlockStateId(col, 5, 64, 5); // stoneStateId

// Biome access (4x4x4 resolution)
setBiomeId(col, 0, 0, 0, plainsId);
getBiomeId(col, 0, 0, 0); // plainsId

// Lighting
setBlockLight(col, 5, 64, 5, 15);
getBlockLight(col, 5, 64, 5); // 15
```

## Architecture

### BitArray

Packed integer array storing N-bit values in a `Uint32Array`. Uses the NoSpan layout (Minecraft 1.16+) where values never cross 64-bit word boundaries.

```ts
const arr = createBitArray(4, 4096); // 4 bits per value, 4096 entries
setBitValue(arr, 0, 15);
getBitValue(arr, 0); // 15
```

Conversions for NBT serialization:
- `bitArrayToLongArray(arr)` — to `[hi, lo][]` pairs for NBT long arrays
- `bitArrayFromLongArray(longs, bitsPerValue)` — from NBT long arrays

### PaletteContainer

Discriminated union with automatic type promotion:

| Type       | When                          | Storage                        |
| ---------- | ----------------------------- | ------------------------------ |
| `single`   | All values identical          | One value, no bit array        |
| `indirect` | Few unique values             | Local palette + compact bits   |
| `direct`   | Many unique values (>8 bits)  | Global IDs stored directly     |

`setContainerValue` automatically upgrades the container type when needed.

### ChunkSection (16x16x16 blocks)

Wraps a PaletteContainer with a `solidBlockCount` tracker.

### BiomeSection (4x4x4 biomes)

Wraps a PaletteContainer for 64 biome entries per section.

### ChunkColumn

Full vertical chunk with 24 sections (1.18+). Provides:
- Block state get/set by world coordinates
- Biome get/set (4x4x4 resolution)
- Block/sky light via nibble arrays
- Block entity storage
- Network serialization (`dumpChunkColumn`/`loadChunkColumn`)
- Anvil loading (`loadChunkSectionFromAnvil`)
