# item

Functional replacement for [prismarine-item](https://github.com/PrismarineJS/prismarine-item). Readonly `Item` type with pure functions — no classes, no mutation.

## Item type

```ts
type Item = {
  type: number;              // numeric item ID
  count: number;             // stack size
  metadata: number;          // legacy damage/variant
  nbt: NbtCompound | null;   // enchantments, display, etc.
  name: string;              // "diamond_sword"
  displayName: string;       // "Diamond Sword"
  stackSize: number;         // max stack (1, 16, 64)
  maxDurability: number | null;
};
```

## Usage

```ts
import { createRegistry } from "../registry/index.js";
import { createItemByName, setEnchants, getEnchants, setCustomName } from "./index.js";

const reg = createRegistry("1.20.4");

// Create
const sword = createItemByName(reg, "diamond_sword", 1);

// Enchant (returns new item)
const enchanted = setEnchants(reg, sword, [
  { name: "sharpness", level: 5 },
  { name: "looting", level: 3 },
]);

// Read enchantments
getEnchants(reg, enchanted);
// → [{ name: "sharpness", level: 5 }, { name: "looting", level: 3 }]

// Custom name
const named = setCustomName(enchanted, "Excalibur");
```

## Functions

All "set" functions return a new `Item` — the original is never mutated.

| Function | Needs registry? | Description |
|----------|:-:|---|
| `createItem(reg, id, count, metadata?, nbt?)` | yes | Create from numeric ID |
| `createItemByName(reg, name, count, metadata?, nbt?)` | yes | Create from name |
| `getEnchants(reg, item)` | yes | Read enchantments |
| `setEnchants(reg, item, enchants)` | yes | Set enchantments |
| `getCustomName(item)` | no | Get display name or null |
| `setCustomName(item, name)` | no | Set display name |
| `getCustomLore(item)` | no | Get lore lines or null |
| `setCustomLore(item, lines)` | no | Set lore lines |
| `getDurabilityUsed(reg, item)` | yes | Get damage taken, or null |
| `setDurabilityUsed(reg, item, val)` | yes | Set damage taken |
| `getRepairCost(item)` | no | Get anvil repair cost (default 0) |
| `setRepairCost(item, cost)` | no | Set anvil repair cost |
| `getBlocksCanPlaceOn(item)` | no | Adventure mode place restriction |
| `setBlocksCanPlaceOn(item, blocks)` | no | Set place restriction |
| `getBlocksCanDestroy(item)` | no | Adventure mode destroy restriction |
| `setBlocksCanDestroy(item, blocks)` | no | Set destroy restriction |
| `getSpawnEggMobName(reg, item)` | yes | Mob name from spawn egg |
| `itemsEqual(a, b, matchCount?, matchNbt?)` | no | Compare items (null-safe) |
| `toNotch(reg, item)` | yes | Serialize to network format |
| `fromNotch(reg, notch)` | yes | Deserialize from network format |

## Version handling

Functions that need the registry use `supportFeature()` to handle version differences automatically:

- **Enchantments**: `ench` key with numeric IDs (1.8) vs `Enchantments` with string IDs (1.13+)
- **Durability**: stored in `metadata` (1.8) vs NBT `Damage` tag (1.13+)
- **Network format**: `blockId` format (1.8) vs `present` flag format (1.13+)
- **Enchanted books**: always use `StoredEnchantments` instead of the regular enchant key

## Registry data

The registry provides item, enchantment, and food lookups:

```ts
reg.itemsByName.get("diamond_sword")    // → ItemDefinition
reg.itemsById.get(834)                  // → ItemDefinition
reg.enchantmentsByName.get("sharpness") // → EnchantmentDefinition
reg.foodsByName.get("apple")            // → FoodDefinition
```
