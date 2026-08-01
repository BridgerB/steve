# window

Functional replacement for [prismarine-windows](https://github.com/PrismarineJS/prismarine-windows). Manages Minecraft inventory windows (player inventory, chests, furnaces, crafting tables, etc.) with pure functions operating on a mutable `Window` type.

## Usage

```ts
import { createRegistry } from "../registry/index.js";
import {
  createWindowFromType,
  getWindowTypes,
  updateSlot,
  acceptClick,
  findInventoryItem,
  windowItems,
} from "./index.js";
import { createItemByName } from "../item/index.js";

const reg = createRegistry("1.20.4");

// Create a window from a known type
const win = createWindowFromType(reg, 0, "minecraft:generic_9x3", "Chest");

// Put items in slots
const sword = createItemByName(reg, "diamond_sword", 1);
updateSlot(win, 0, sword);

// Simulate a click (mode 0 = normal mouse, button 0 = left)
acceptClick(reg, win, { mode: 0, mouseButton: 0, slot: 0 });

// Search inventory
const slot = findInventoryItem(win, sword.type, null);

// List all items in inventory section
const items = windowItems(win);
```

## Window type

```ts
type Window = {
  id: number;                          // protocol window ID
  type: number | string;               // window type (numeric 1.14+, string pre-1.14)
  title: string;                       // display title
  slots: (Item | null)[];              // slot array, null = empty
  inventoryStart: number;              // first player inventory slot
  inventoryEnd: number;                // last player inventory slot + 1
  hotbarStart: number;                 // first hotbar slot (inventoryEnd - 9)
  craftingResultSlot: number;          // crafting output slot, or -1
  requiresConfirmation: boolean;       // false only for chests pre-1.14
  selectedItem: Item | null;           // cursor item (mouse hold)
  onSlotUpdate: SlotUpdateHandler | null;  // callback on slot change
};
```

## Functions

### Construction

| Function | Description |
|----------|-------------|
| `createWindow(id, type, title, slotCount, inventoryRange, craftingResultSlot, requiresConfirmation)` | Create a window with explicit slot layout |
| `createWindowFromType(registry, id, type, title, slotCount?)` | Create from a known window type name |
| `getWindowTypes(registry)` | Get all window type definitions for the version |

### Slot management

| Function | Description |
|----------|-------------|
| `updateSlot(win, slot, newItem)` | Set a slot, fires `onSlotUpdate` |
| `fillAndDump(win, reg, sourceSlot, start, end)` | Fill matching stacks, then dump to empty slot |
| `fillSlotsWithItem(win, reg, targetSlots, sourceSlot)` | Fill target slots from source |
| `fillSlotWithItem(win, reg, target, source)` | Transfer items between two slots |
| `fillSlotWithSelectedItem(win, reg, slot)` | Place cursor item into a slot |
| `dumpItem(win, sourceSlot, start, end)` | Move item to first empty slot in range |
| `splitSlot(win, reg, slot)` | Right-click split: leave half, pick up half |
| `swapSelectedItem(win, slot)` | Swap cursor item with slot |
| `dropSelectedItem(win, untilEmpty)` | Drop one or all of cursor item |

### Click handling

Simulates the client-side inventory click behavior per [wiki.vg](https://wiki.vg/Protocol#Click_Window).

| Function | Mode | Description |
|----------|:----:|-------------|
| `acceptClick(reg, win, click)` | all | Route to the correct handler |
| `mouseClick(reg, win, click)` | 0 | Left/right click on slots |
| `shiftClick(reg, win, click)` | 1 | Shift+click transfer |
| `numberClick(reg, win, click)` | 2 | Number key swap |
| `middleClick(reg, win, click)` | 3 | Creative middle-click duplicate |
| `dropClick(reg, win, click)` | 4 | Q-drop items |

### Search

All search functions return **slot indices** (not items). Returns `null` if not found.

| Function | Description |
|----------|-------------|
| `findItemRange(win, start, end, itemType, metadata, notFull?, nbt?)` | Find first matching item in range |
| `findItemsRange(win, start, end, itemType, metadata, notFull?, nbt?, withEmpty?)` | Find all matching slots |
| `findItemRangeName(win, start, end, itemName, metadata, notFull?)` | Find by item name |
| `findInventoryItem(win, itemType, metadata, notFull?)` | Search player inventory |
| `findContainerItem(win, itemType, metadata, notFull?)` | Search container section |

### Empty slots

| Function | Description |
|----------|-------------|
| `firstEmptySlotRange(win, start, end)` | First empty slot in range |
| `lastEmptySlotRange(win, start, end)` | Last empty slot in range |
| `firstEmptyHotbarSlot(win)` | First empty hotbar slot |
| `firstEmptyContainerSlot(win)` | First empty container slot |
| `firstEmptyInventorySlot(win, hotbarFirst?)` | First empty inventory slot |

### Counting and listing

| Function | Description |
|----------|-------------|
| `sumRange(win, start, end, itemType, metadata?)` | Total count of item in range |
| `countRange(win, start, end, itemType, metadata?)` | Number of stacks in range |
| `windowCount(win, itemType, metadata?)` | Total count in inventory section |
| `containerCount(win, itemType, metadata?)` | Total count in container section |
| `itemsRange(win, start, end)` | List non-null items in range |
| `windowItems(win)` | List items in inventory section |
| `containerItems(win)` | List items in container section |
| `emptySlotCount(win)` | Empty slots in inventory section |

### Misc

| Function | Description |
|----------|-------------|
| `transactionRequiresConfirmation(win)` | Whether clicks need server confirmation |
| `clearWindow(win, blockId?, count?)` | Clear slots (optionally filter by item type) |

## Version handling

Window types differ between versions:

- **1.14+**: Numeric protocol IDs, `village&pillageInventoryWindows` feature. Window types include `minecraft:generic_9x1` through `9x6`, crafting, furnace variants, anvil, beacon, etc.
- **Pre-1.14**: String type names like `minecraft:chest`, `minecraft:furnace`. Slot count passed explicitly.

`getWindowTypes(registry)` and `createWindowFromType(registry, ...)` handle this automatically.

## Slot update callback

Instead of EventEmitter (upstream), use the `onSlotUpdate` callback:

```ts
win.onSlotUpdate = (slot, oldItem, newItem) => {
  console.log(`Slot ${slot} changed`);
};
```
