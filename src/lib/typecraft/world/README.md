# world

Functional replacement for [prismarine-world](https://github.com/PrismarineJS/prismarine-world). In-memory chunk column management with world-coordinate block/biome/light access, chunk providers, auto-save, typed events, and spatial iterators.

## Usage

```ts
import { createRegistry } from "../registry/index.js";
import {
  createWorld,
  getColumn,
  worldGetBlock,
  worldSetBlockStateId,
  worldGetBlockStateId,
  onWorldEvent,
  anvilProvider,
  saveAll,
  closeWorld,
} from "./index.js";
import { openAnvilWorld } from "../anvil/index.js";

const reg = createRegistry("1.20.4");

// Create world with anvil storage
const anvil = await openAnvilWorld(reg, "./world");
const world = createWorld(reg, { provider: anvilProvider(anvil) });

// Load a chunk (auto-fetches from provider)
const column = await getColumn(world, 0, 0);

// Read/write blocks by world coordinates
const stateId = worldGetBlockStateId(world, { x: 10, y: 64, z: 10 });
worldSetBlockStateId(world, { x: 10, y: 64, z: 10 }, 1);

// Get full block info (stateId, name, properties)
const block = worldGetBlock(world, { x: 10, y: 64, z: 10 });

// Listen for events
onWorldEvent(world, "blockUpdate", (pos, oldState, newState) => {
  console.log(`Block at ${pos.x},${pos.y},${pos.z} changed`);
});

// Save and close
await saveAll(world);
await closeWorld(world);
```

## World type

```ts
type World = {
  readonly columns: Map<string, ChunkColumn>;
  readonly registry: Registry;
  readonly provider: ChunkProvider | null;
  readonly generator: ChunkGenerator | null;
  readonly savingQueue: Set<string>;
  readonly listeners: { /* typed event maps */ };
  autoSaveTimer: ReturnType<typeof setInterval> | null;
};
```

## Functions

### Lifecycle

| Function | Description |
|----------|-------------|
| `createWorld(registry, options?)` | Create world with optional provider/generator |
| `closeWorld(world)` | Save pending changes and clean up |

### Chunk management

| Function | Description |
|----------|-------------|
| `getColumn(world, chunkX, chunkZ)` | Load chunk (from cache, provider, or generator) |
| `getLoadedColumn(world, chunkX, chunkZ)` | Get chunk only if already loaded |
| `getLoadedColumns(world)` | All loaded columns as `[x, z, column]` tuples |
| `setColumn(world, chunkX, chunkZ, column)` | Insert a chunk, fires `chunkColumnLoad` |
| `unloadColumn(world, chunkX, chunkZ)` | Save and remove, fires `chunkColumnUnload` |

### Block access

All functions take world coordinates (`Vec3`). Returns `null` if the chunk isn't loaded.

| Function | Description |
|----------|-------------|
| `worldGetBlockStateId(world, pos)` | Get block state ID |
| `worldSetBlockStateId(world, pos, stateId)` | Set block state ID, fires `blockUpdate` |
| `worldGetBlock(world, pos)` | Get full `BlockInfo` (stateId, name, properties) |
| `worldSetBlock(world, pos, stateId)` | Set block with full `BlockInfo` return |
| `worldGetBlockLight(world, pos)` | Get block light level (0-15) |
| `worldSetBlockLight(world, pos, light)` | Set block light level |
| `worldGetSkyLight(world, pos)` | Get sky light level (0-15) |
| `worldSetSkyLight(world, pos, light)` | Set sky light level |
| `worldGetBiomeId(world, pos)` | Get biome ID |
| `worldSetBiomeId(world, pos, biomeId)` | Set biome ID |

### Saving

| Function | Description |
|----------|-------------|
| `saveColumn(world, chunkX, chunkZ)` | Save a single column to provider |
| `saveAll(world)` | Save all dirty columns |
| `startAutoSave(world, intervalMs)` | Start periodic auto-save |
| `stopAutoSave(world)` | Stop auto-save |

### Events

| Event | Arguments | Description |
|-------|-----------|-------------|
| `blockUpdate` | `(pos, oldStateId, newStateId)` | A block was changed |
| `chunkColumnLoad` | `(chunkX, chunkZ)` | A chunk was loaded/set |
| `chunkColumnUnload` | `(chunkX, chunkZ)` | A chunk was unloaded |

```ts
onWorldEvent(world, "blockUpdate", (pos, oldState, newState) => { ... });
offWorldEvent(world, "blockUpdate", callback);
```

### Providers

| Function | Description |
|----------|-------------|
| `anvilProvider(anvilWorld)` | Adapt an `AnvilWorld` as a `ChunkProvider` |

```ts
type ChunkProvider = {
  load(chunkX: number, chunkZ: number): Promise<ChunkColumn | null>;
  save(chunkX: number, chunkZ: number, column: ChunkColumn): Promise<void>;
};

type ChunkGenerator = (chunkX: number, chunkZ: number) => ChunkColumn;
```

## Spatial iterators

All iterators have a `.next()` method that returns `Vec3 | null` (null when exhausted).

| Iterator | Description |
|----------|-------------|
| `createManhattanIterator(startX, startZ, maxDistance)` | 2D spiral by Manhattan distance — chunk loading around a player |
| `createOctahedronIterator(start, maxDistance)` | 3D octahedron expansion — block search in all directions |
| `createRaycastIterator(pos, dir, maxDistance)` | Ray through voxel grid — block picking, line of sight. Has `.intersect(shapes, offset)` for AABB hit testing |
| `createSpiralIterator2d(start, maxDistance)` | 2D outward spiral in growing squares |

### BlockFace

```ts
BlockFace.BOTTOM  // 0
BlockFace.TOP     // 1
BlockFace.NORTH   // 2
BlockFace.SOUTH   // 3
BlockFace.WEST    // 4
BlockFace.EAST    // 5
BlockFace.UNKNOWN // -999
```
