# registry

Typed wrapper around [minecraft-data](https://github.com/PrismarineJS/minecraft-data) providing block, biome, and version lookups for a specific Minecraft version.

## Usage

```ts
import { createRegistry } from "typecraft";

const registry = createRegistry("1.20.4");

// Block lookups
const stone = registry.blocksByName.get("stone");
console.log(stone.defaultState); // 1
console.log(stone.minStateId);   // 1
console.log(stone.maxStateId);   // 1

// Lookup by state ID (e.g. oak_stairs with specific facing/shape)
const block = registry.blocksByStateId.get(2880);
console.log(block.name);   // "oak_stairs"
console.log(block.states); // [{ name: "facing", type: "enum", ... }, ...]

// Biome lookups
const plains = registry.biomesByName.get("plains");
console.log(plains.id);          // 1
console.log(plains.temperature); // 0.8

// Version checks
registry.isNewerOrEqualTo("1.18"); // true
registry.isOlderThan("1.21");     // true
```

## API

### `createRegistry(version: string): Registry`

Creates a registry for a Minecraft version (e.g. `"1.20.4"`, `"1.18"`).

### `Registry`

| Field              | Type                                    | Description                        |
| ------------------ | --------------------------------------- | ---------------------------------- |
| `version`          | `VersionInfo`                           | Version metadata                   |
| `blocksById`       | `ReadonlyMap<number, BlockDefinition>`  | Blocks by numeric ID               |
| `blocksByName`     | `ReadonlyMap<string, BlockDefinition>`  | Blocks by name (e.g. `"stone"`)    |
| `blocksByStateId`  | `ReadonlyMap<number, BlockDefinition>`  | Blocks by block state ID           |
| `blocksArray`      | `readonly BlockDefinition[]`            | All blocks                         |
| `biomesById`       | `ReadonlyMap<number, BiomeDefinition>`  | Biomes by numeric ID               |
| `biomesByName`     | `ReadonlyMap<string, BiomeDefinition>`  | Biomes by name (e.g. `"plains"`)   |
| `biomesArray`      | `readonly BiomeDefinition[]`            | All biomes                         |
| `isNewerOrEqualTo` | `(version: string) => boolean`          | Version comparison                 |
| `isOlderThan`      | `(version: string) => boolean`          | Version comparison                 |
| `supportFeature`   | `(feature: string) => boolean`          | Feature flag check                 |

### `BlockDefinition`

Key fields: `id`, `name`, `displayName`, `defaultState`, `minStateId`, `maxStateId`, `states`, `hardness`, `resistance`, `transparent`, `emitLight`, `filterLight`, `diggable`, `stackSize`, `boundingBox`, `drops`.

### `BiomeDefinition`

Key fields: `id`, `name`, `displayName`, `category`, `temperature`, `rainfall`, `dimension`, `color`, `precipitation`.
