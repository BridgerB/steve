# anvil

Read and write Minecraft Java Edition world saves in the Anvil format. Handles `.mca` region files, chunk NBT conversion, and `level.dat`.

## Usage

```ts
import {
  createRegistry,
  openAnvilWorld,
  loadChunk,
  saveChunk,
  closeAnvilWorld,
  getBlockStateId,
  setBlockStateId,
} from "typecraft";

const registry = createRegistry("1.20.4");
const world = openAnvilWorld("/path/to/world", registry);

// Load a chunk
const chunk = await loadChunk(world, 0, 0);
if (chunk) {
  console.log(getBlockStateId(chunk, 0, 64, 0));
}

// Modify and save
setBlockStateId(chunk, 0, 64, 0, stoneStateId);
await saveChunk(world, 0, 0, chunk);

await closeAnvilWorld(world);
```

### Level.dat

```ts
import { readLevelDat, writeLevelDat } from "typecraft";

const data = await readLevelDat("/path/to/world/level.dat");
console.log(data.levelName);  // "My World"
console.log(data.version);    // "1.20.4"

await writeLevelDat("/path/to/world/level.dat", {
  levelName: "Renamed World",
  version: "1.20.4",
  generatorName: "default",
  randomSeed: [12345, 67890],
});
```

### Low-level region file access

```ts
import {
  openRegionFile,
  hasChunk,
  readRegionChunk,
  writeRegionChunk,
  closeRegionFile,
} from "typecraft";

const region = await openRegionFile("r.0.0.mca");

if (hasChunk(region, 5, 3)) {
  const nbt = await readRegionChunk(region, 5, 3);
  // nbt is the raw chunk NBT root
}

await closeRegionFile(region);
```

## Module structure

| File           | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `anvil.ts`     | High-level API: `openAnvilWorld`, `loadChunk`, `saveChunk` |
| `region.ts`    | Region file I/O: sector allocation, compression    |
| `chunkNbt.ts`  | NBT ↔ ChunkColumn conversion with palette mapping  |
| `levelDat.ts`  | Read/write gzipped NBT `level.dat`                 |

## Format details

- Region files (`.mca`) use 4KB sectors with a 1024-entry offset table
- Chunks are zlib-compressed (deflate) NBT
- Supports both gzip and deflate decompression on read
- Chunk coordinates are local to the region (0-31)
- Region file path: `region/r.{regionX}.{regionZ}.mca` where `regionX = chunkX >> 5`
