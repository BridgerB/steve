# AGENT.md — MCP Development Agent Guide

You are an autonomous development agent connected to a live Minecraft bot via
MCP tools. Your job is to iterate on the Steve bot's code until it reliably
achieves the current goal.

## Current Goal

**`iron_ingot`** — The bot must gather wood, craft tools, mine stone, craft
stone pickaxe, craft furnace, mine coal, mine iron ore, and smelt iron ingots.
The race orchestrator checks for `iron_ingot` in inventory to declare a win.

The step pipeline is defined in `src/steps.ts`. Current targets:

- Coal: 8 (isComplete: `coal >= 8`)
- Iron ore: 8 (isComplete: `ironOre >= 8 || ironIngots >= 8`)
- Smelt: needs `ironOre >= 3 && coal >= 2`, completes at `ironIngots >= 3`

## Your MCP Tools

You have 5 tools for interacting with the live bot:

### `state` — Read game state

Returns full `GameState`: inventory counts, equipment tiers, world state,
position, health, food. Use this to check progress after any action.

### `inventory` — Detailed slot-level inventory

Every item with slot number, exact name, count. More granular than `state`.

### `look` — Survey surroundings

Block counts in a radius, nearby entities with distances. Use to understand the
bot's environment before deciding what to do.

### `eval` — Execute TypeScript (your primary tool)

Runs arbitrary TypeScript as the body of `async (bot, state) => { ... }`. The
bot object is a live typecraft Bot instance. You can import any steve module.

**Import paths are relative to `src/`** (the eval file lives at
`src/.mcp-eval.ts`):

```ts
// Correct:
const { gatherWood } = await import("./tasks/gather-wood/main.ts");
const { mineBlock } = await import("./tasks/mining/main.ts");
const { craftItem, getCraftingTable, goTo, findBlock } = await import(
  "./lib/bot-utils.ts"
);

// Wrong:
await import("./src/tasks/..."); // double src/
```

**Examples:**

```ts
// Gather 5 logs
const { gatherWood } = await import("./tasks/gather-wood/main.ts");
return await gatherWood(bot, 5);

// Mine 3 coal
const { mineBlock } = await import("./tasks/mining/main.ts");
return await mineBlock(bot, "coal_ore", 3);

// Craft wooden pickaxe
const { craftWoodenPickaxe } = await import("./tasks/craft/main.ts");
return await craftWoodenPickaxe(bot);

// Check what's nearby
const { findBlock } = await import("./lib/bot-utils.ts");
const b = findBlock(bot, "coal_ore", 64);
return b ? { name: b.name, pos: b.position } : "none found";

// Navigate somewhere
const { goTo } = await import("./lib/bot-utils.ts");
const { vec3 } = await import("typecraft");
await goTo(bot, vec3(100, 64, 200));
return "arrived";

// Give yourself items for testing
bot.chat("/give McpBot diamond_pickaxe 1");
return "done";

// Raw bot API
return bot.entity.position;
```

Default timeout is 120s. Pass `timeout` parameter for longer operations.

### `chat` — Send chat message or slash command

Fire-and-forget. Useful for `/give`, `/tp`, `/gamemode`, `/time set day`.

## Development Workflow

### 1. Diagnose

Before changing code, understand what's failing:

- Call `state` to see current inventory/equipment
- Call `look` to see surroundings
- Use `eval` to test the specific function that's failing
- Check the result — did it return success? Did inventory actually change?

### 2. Test in Isolation

Test individual task functions with `eval` before modifying code:

```ts
// Test if mining actually collects drops
const { mineBlock } = await import("./tasks/mining/main.ts");
const before = bot.inventory.slots.filter((s) => s).map((s) =>
  `${s.name}x${s.count}`
);
const result = await mineBlock(bot, "coal_ore", 3);
const after = bot.inventory.slots.filter((s) => s).map((s) =>
  `${s.name}x${s.count}`
);
return { result, before, after };
```

### 3. Modify Code

Edit the TypeScript source files directly using the Edit tool. The changes take
effect on the next `eval` call (dynamic imports are cache-busted).

### 4. Validate

After modifying code, test again with `eval` to confirm the fix works. Check
`state` to verify inventory changed as expected.

### 5. Iterate

Repeat until the full pipeline works. Then run the end-to-end race to validate:

```bash
nix run . -- 4 600  # 4 bots, 10 min
```

## Architecture Quick Reference

- **`src/steps.ts`** — Step definitions with `canExecute`, `isComplete`,
  `execute`. Priority-ordered.
- **`src/main.ts`** — Tick loop picks next incomplete step, executes it, tracks
  completedSteps.
- **`src/state.ts`** — `syncFromBot(bot)` snapshots bot into typed `GameState`.
- **`src/lib/bot-utils.ts`** — Navigation (`goTo`, `moveCloser`), mining
  (`mineAndCollect`), crafting (`craftItem`, `getCraftingTable`), inventory
  helpers, bot memory (`rememberResource`, `getRememberedResource`).
- **`src/tasks/*/main.ts`** — Task implementations: `gather-wood`, `craft`,
  `mining`, `smelt`.
- **`src/lib/logger.ts`** — SQLite event logging. All events go to
  `logEvent(category, event, detail)`.

## Key Bot APIs (typecraft)

```ts
bot.entity.position          // Vec3 {x, y, z}
bot.health                   // 0-20
bot.food                     // 0-20
bot.heldItem                 // Item | null
bot.inventory.slots          // (Item | null)[]
bot.blockAt(pos)             // Block info at position
bot.findBlocks({matching, maxDistance, count})  // Find blocks
bot.dig(block)               // Mine a block
bot.placeBlock(block, face)  // Place a block
bot.craft(recipe, count, table?)  // Craft items
bot.activateBlock(pos)       // Right-click a block (open chest, crafting table)
bot.chat(message)            // Send chat / slash command
bot.lookAt(pos)              // Look at position
bot.setControlState(control, state)  // forward, back, left, right, jump, sprint
bot.watchBlocks              // Set<string> — blocks that emit "blockSeen" events
```

## Known Issues

These are the current blockers. Fix them in priority order:

1. **Drop collection for scattered ore** — Bot digs coal/iron but doesn't walk
   to the drop position to collect items. Strip-mine (stone) works because the
   bot walks through the cleared tunnel. Scattered ore drops land 2-4 blocks
   away.

2. **Crafting table unreachable after underground mining** — Bot mines at Y=57,
   table is on surface at Y=70. Pathfinder can't climb back within timeout.
   Current mitigation: recraft from planks if table is unreachable.

3. **Smelt step untested** — The smelt_iron step exists but has never been
   reached in a run because the bot can't accumulate enough iron ore (drop
   collection issue).

## Rules

- **Test before and after every change** — Use `eval` to verify the fix works
  before moving on.
- **Don't break working steps** — Wood gathering, planks, sticks, crafting
  table, wooden pickaxe, stone mining, and stone pickaxe all work. Don't regress
  them.
- **Verify with inventory** — A step isn't truly fixed until `state` shows the
  expected items in inventory.
- **Log to SQLite** — Use `logEvent()` for diagnostics, not console.log.
- **No X-ray mining** — The bot only knows about blocks it can see (exposed
  surfaces). Don't use `exposed: false` in findBlocks.
- **Imports are relative to `src/`** — Always use `./tasks/...` not
  `./src/tasks/...`.
- **Keep changes minimal** — Fix the specific issue, don't refactor surrounding
  code.
