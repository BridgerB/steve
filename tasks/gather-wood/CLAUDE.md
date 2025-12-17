# CLAUDE.md - Gather Wood Task Debug Guide

This document provides comprehensive guidance for Claude AI to understand,
debug, and improve the gather-wood task in the Steve Minecraft bot project.

---

## TABLE OF CONTENTS

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [MCP Server Tools Reference](#3-mcp-server-tools-reference)
4. [How to Run and Test](#4-how-to-run-and-test)
5. [The Gather-Wood Task In-Depth](#5-the-gather-wood-task-in-depth)
6. [Current Issues and Debugging](#6-current-issues-and-debugging)
7. [Common Debugging Patterns](#7-common-debugging-patterns)
8. [Minecraft Mechanics Reference](#8-minecraft-mechanics-reference)
9. [Code Patterns and Conventions](#9-code-patterns-and-conventions)
10. [Manual MCP Testing Guide](#10-manual-mcp-testing-guide)
11. [Troubleshooting Checklist](#11-troubleshooting-checklist)
12. [Future Improvements](#12-future-improvements)

---

## 1. PROJECT OVERVIEW

### 1.1 Goal

The **Steve** project aims to create a Minecraft bot that can autonomously beat
the game (kill the Ender Dragon) starting from a random spawn with no human
intervention. This is inspired by the challenge described in
[this video](https://youtu.be/Wh4abvcUj8Q?si=UNdADJbpAgsPh2by&t=710).

### 1.2 Rules

- **No cuts** - continuous gameplay
- **No teleporting** - bot must walk/navigate normally
- **No prompting** - no human guidance during gameplay
- **No human input** - completely autonomous after initial start

### 1.3 Project Structure

```
/home/bridger/git/steve/
├── mcp/
│   ├── bot.ts          # Bot instance manager and helper functions
│   └── server.ts       # MCP server exposing tools to Claude
├── tasks/
│   ├── gather-wood/
│   │   ├── main.ts     # Wood gathering logic (CURRENT FOCUS)
│   │   ├── test.ts     # Test runner
│   │   ├── debug.ts    # Debug script for testing single operations
│   │   └── CLAUDE.md   # This file
│   ├── craft/
│   │   ├── main.ts     # Crafting recipes
│   │   └── test.ts
│   ├── mining/
│   │   ├── main.ts     # Block mining logic
│   │   └── test.ts
│   ├── combat/
│   │   ├── main.ts     # Combat and food gathering
│   │   └── test.ts
│   ├── smelt/
│   │   ├── main.ts     # Smelting logic
│   │   └── test.ts
│   ├── world/
│   │   ├── main.ts     # Portal building, water bucket, etc.
│   │   └── test.ts
│   ├── nether/
│   │   ├── main.ts     # Nether navigation and blaze hunting
│   │   └── test.ts
│   └── end/
│       ├── main.ts     # End dimension and dragon fight
│       └── test.ts
├── main.ts             # Main bot orchestrator
├── state.ts            # Game state management
├── steps.ts            # Step definitions for the speedrun
├── types.ts            # TypeScript type definitions
├── deno.json           # Deno configuration and tasks
├── opencode.json       # OpenCode MCP configuration
└── README.md           # Project overview
```

### 1.4 Technology Stack

- **Runtime**: Deno (TypeScript)
- **Bot Library**: mineflayer (npm:mineflayer@^4.33.0)
- **Pathfinding**: mineflayer-pathfinder (npm:mineflayer-pathfinder@^2.4.5)
- **Math**: vec3 (npm:vec3@^0.1.10)
- **MCP**: @modelcontextprotocol/sdk
- **Testing**: Deno test with @std/assert

---

## 2. ARCHITECTURE

### 2.1 MCP Server Architecture

The project uses Model Context Protocol (MCP) to expose Minecraft bot controls
as tools that Claude can call directly.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Claude AI     │────▶│   MCP Server    │────▶│  Minecraft Bot  │
│  (OpenCode)     │◀────│  (server.ts)    │◀────│  (mineflayer)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                       │
    Tool calls             bot.ts                   Game world
    (JSON-RPC)          (bot manager)              (server)
```

### 2.2 Bot Manager (mcp/bot.ts)

The bot manager handles:

1. **Connection Management**: `spawnBot()`, `disconnectBot()`, `requireBot()`
2. **Movement**: `walkDirection()`, `jump()`, `lookAt()`, `turn()`, `goTo()`
3. **Mining**: `mineBlock()` - blocks until complete
4. **Perception**: `getPosition()`, `getView()`, `getBlockAt()`
5. **Inventory**: `getInventory()`, `selectSlot()`
6. **Interaction**: `attack()`, `useItem()`, `placeBlock()`

Key implementation detail - the bot is a **singleton**:

```typescript
let bot: Bot | null = null;

export const getBot = (): Bot | null => bot;
export const requireBot = (): Bot => {
  if (!bot) {
    throw new Error("Bot not connected. Call spawn_bot first.");
  }
  return bot;
};
```

### 2.3 Task Architecture

Each task follows this pattern:

```typescript
// tasks/{task-name}/main.ts
export const taskName = async (
  bot: Bot,
  targetCount: number,
): Promise<StepResult> => {
  // Implementation
  return { success: true, message: "Task completed" };
};
```

The `StepResult` type:

```typescript
export type StepResult =
  | { success: true; message: string }
  | { success: false; message: string };
```

### 2.4 State Management

Game state is managed functionally in `state.ts`:

- `syncFromBot(bot)` - reads current bot state
- `getPhase(state)` - determines current game phase
- `updateInventory()`, `updateEquipment()`, `updateWorld()` - pure updaters

---

## 3. MCP SERVER TOOLS REFERENCE

### 3.1 Connection Tools

#### `minecraft_spawn_bot`

Connect a bot to the Minecraft server.

**Parameters:**

- `host` (string, optional): Server host (default: "localhost")
- `port` (number, optional): Server port (default: 25565)
- `username` (string, optional): Bot username (default: "MCPBot")

**Returns:**

```json
{
  "success": true,
  "message": "Bot spawned at position X, Y, Z",
  "position": { "x": 0, "y": 64, "z": 0 }
}
```

**Usage:**

```
Call minecraft_spawn_bot with no parameters for defaults
Call minecraft_spawn_bot with username="TestBot" for custom name
```

#### `minecraft_disconnect_bot`

Disconnect the bot from the server.

**Parameters:** None

**Returns:**

```json
{ "success": true, "message": "Bot disconnected" }
```

#### `minecraft_is_connected`

Check if the bot is currently connected.

**Parameters:** None

**Returns:**

```json
{ "connected": true }
```

### 3.2 Perception Tools

#### `minecraft_get_position`

Get the bot's current position and orientation.

**Parameters:** None

**Returns:**

```json
{
  "x": 123.5,
  "y": 64.0,
  "z": -456.5,
  "yaw": 90.0,
  "pitch": 0.0
}
```

**Notes:**

- Position is the exact floating-point position
- Yaw is in degrees (0 = south, 90 = west, 180 = north, 270 = east)
- Pitch is in degrees (negative = looking up, positive = looking down)

#### `minecraft_get_view`

Get comprehensive view of bot's surroundings.

**Parameters:**

- `radius` (number, optional): Scan radius in blocks (default: 8)

**Returns:**

```json
{
  "position": { "x": 123, "y": 64, "z": -456 },
  "yaw": 90.0,
  "pitch": 0.0,
  "health": 20,
  "food": 20,
  "blockAtCursor": {
    "name": "oak_log",
    "position": { "x": 125, "y": 65, "z": -456 }
  },
  "nearbyBlocks": [
    {
      "name": "grass_block",
      "position": { "x": 123, "y": 63, "z": -456 },
      "distance": 1.0
    }
  ],
  "nearbyEntities": [
    {
      "name": "pig",
      "type": "mob",
      "position": { "x": 130, "y": 64, "z": -450 },
      "distance": 8.5
    }
  ]
}
```

**Notes:**

- `nearbyBlocks` is limited to 50 blocks, sorted by distance
- `nearbyEntities` includes all entities within radius*2
- Use larger radius to find trees, ores, etc.

#### `minecraft_get_block_at`

Get the block at a specific position.

**Parameters:**

- `x` (number, required): X coordinate
- `y` (number, required): Y coordinate
- `z` (number, required): Z coordinate

**Returns:**

```json
{ "name": "oak_log" }
```

**Notes:**

- Returns `{ "name": "air" }` for empty spaces
- Use integer coordinates for block positions

### 3.3 Movement Tools

#### `minecraft_walk`

Walk in a direction for a specified duration.

**Parameters:**

- `direction` (string, required): One of "forward", "back", "left", "right"
- `duration_ms` (number, required): Duration in milliseconds

**Returns:**

```json
{
  "success": true,
  "position": { "x": 125, "y": 64, "z": -456 }
}
```

**Notes:**

- Walking is relative to current view direction
- Typical walking speed is ~4.3 blocks/second
- Use `minecraft_look_at` first to face the right direction

#### `minecraft_jump`

Make the bot jump.

**Parameters:** None

**Returns:**

```json
{ "success": true }
```

**Notes:**

- Jump height is 1.25 blocks
- Jump duration is about 300ms
- Can combine with walking for movement

#### `minecraft_look_at`

Make the bot look at a specific position.

**Parameters:**

- `x` (number, required): X coordinate to look at
- `y` (number, required): Y coordinate to look at
- `z` (number, required): Z coordinate to look at

**Returns:**

```json
{ "success": true }
```

**Notes:**

- For blocks, add 0.5 to each coordinate for center
- For entities, target their eye level (position.y + 1 for players/mobs)

#### `minecraft_turn`

Turn the bot by a number of degrees.

**Parameters:**

- `yaw_degrees` (number, required): Degrees to turn horizontally (positive =
  right)
- `pitch_degrees` (number, optional): Degrees to change vertical look angle

**Returns:**

```json
{ "success": true }
```

**Notes:**

- Use for incremental adjustments
- Pitch is clamped to -90 to +90 degrees

#### `minecraft_go_to`

Use pathfinding to navigate to a position.

**Parameters:**

- `x` (number, required): X coordinate
- `y` (number, required): Y coordinate
- `z` (number, required): Z coordinate

**Returns:**

```json
{
  "success": true,
  "position": { "x": 125.5, "y": 64.0, "z": -455.5, "yaw": 45.0, "pitch": 0.0 }
}
```

**Notes:**

- Uses mineflayer-pathfinder with GoalNear(x, y, z, 1)
- Can dig through blocks if needed (movements.canDig = true)
- May fail if path is too complex or blocked
- Returns `success: false` if pathfinding fails but may still be close

### 3.4 Mining Tools

#### `minecraft_mine_block`

Mine/dig a block at a specific position. **Blocks until complete.**

**Parameters:**

- `x` (number, required): X coordinate of block
- `y` (number, required): Y coordinate of block
- `z` (number, required): Z coordinate of block

**Returns:**

```json
{
  "success": true,
  "blockMined": "oak_log"
}
```

**Notes:**

- **Must be within 4.5 blocks** to mine
- Automatically looks at the block before mining
- Returns `{ "success": true, "blockMined": null }` if block is already air
- Tool tier affects mining speed (fist is slowest)
- Items drop at the block position and need to be collected

### 3.5 Inventory Tools

#### `minecraft_get_inventory`

Get the bot's inventory contents.

**Parameters:** None

**Returns:**

```json
{
  "items": [
    { "name": "oak_log", "count": 4, "slot": 0 },
    { "name": "wooden_pickaxe", "count": 1, "slot": 1 }
  ]
}
```

**Notes:**

- Hotbar is slots 0-8
- Main inventory is slots 9-35
- Armor slots are separate

#### `minecraft_select_slot`

Select a hotbar slot (0-8).

**Parameters:**

- `slot` (number, required): Hotbar slot number (0-8)

**Returns:**

```json
{ "success": true, "slot": 0 }
```

**Notes:**

- Changes what item the bot is holding
- Required before using tools or placing blocks

### 3.6 Interaction Tools

#### `minecraft_attack`

Attack the entity the bot is looking at.

**Parameters:** None

**Returns:**

```json
{ "success": true }
```

**Notes:**

- First tries entity at cursor
- If none, finds and attacks nearest player
- Must be within attack range (3 blocks)

#### `minecraft_use_item`

Use the currently held item.

**Parameters:** None

**Returns:**

```json
{ "success": true }
```

**Notes:**

- Behavior depends on held item
- Food: starts eating
- Bow: starts drawing
- Block: places if looking at valid surface

#### `minecraft_place_block`

Place a block at a specific position.

**Parameters:**

- `x` (number, required): X coordinate
- `y` (number, required): Y coordinate
- `z` (number, required): Z coordinate

**Returns:**

```json
{ "success": true }
```

**Notes:**

- Must have a block selected in hotbar
- Target position must be adjacent to an existing block
- Returns false if no valid adjacent block found

### 3.7 Script Execution Tools

#### `minecraft_run_script`

Run a TypeScript file and capture output.

**Parameters:**

- `path` (string, required): Path to the TypeScript file
- `timeout_ms` (number, optional): Timeout in milliseconds (default: 60000)

**Returns:**

```json
{
  "success": true,
  "exitCode": 0,
  "stdout": "Output here...",
  "stderr": ""
}
```

**Usage:**

```
Call minecraft_run_script with path="tasks/gather-wood/debug.ts"
```

#### `minecraft_run_test`

Run a Deno test file and capture results.

**Parameters:**

- `path` (string, required): Path to the test file
- `timeout_ms` (number, optional): Timeout in milliseconds (default: 120000)

**Returns:**

```json
{
  "success": true,
  "exitCode": 0,
  "stdout": "Test output...",
  "stderr": ""
}
```

**Usage:**

```
Call minecraft_run_test with path="tasks/gather-wood/test.ts"
```

#### `minecraft_chat`

Send a chat message in the game.

**Parameters:**

- `message` (string, required): Message to send

**Returns:**

```json
{ "success": true }
```

**Notes:**

- Can be used for commands if bot has op: `/give MCPBot diamond 64`
- Visible to all players on server

---

## 4. HOW TO RUN AND TEST

### 4.1 Prerequisites

1. **Minecraft Server** running on localhost:25565
   - Java Edition 1.20.x recommended
   - Set `online-mode=false` in server.properties
   - Op the test bot usernames: `/op TestWood`, `/op MCPBot`

2. **Deno** installed (version 1.40+)

3. **Dependencies** installed:
   ```bash
   cd /home/bridger/git/steve
   deno install
   ```

### 4.2 Running the MCP Server

```bash
# Start the MCP server (required for Claude to use minecraft_* tools)
cd /home/bridger/git/steve
deno task mcp
```

This runs `deno run -A --no-check mcp/server.ts` and outputs to stderr:

```
Minecraft Bot MCP Server running on stdio
```

The MCP server is configured in `opencode.json`:

```json
{
  "mcp": {
    "minecraft": {
      "type": "local",
      "command": ["deno", "run", "-A", "--no-check", "mcp/server.ts"],
      "enabled": true
    }
  }
}
```

### 4.3 Running Tests

#### Run gather-wood test (single bot)

```bash
cd /home/bridger/git/steve
deno test -A --no-check tasks/gather-wood/test.ts
```

Or via MCP:

```
Call minecraft_run_test with path="tasks/gather-wood/test.ts"
```

#### Run gather-wood test (multiple bots)

```bash
# 10 bots, 1000 blocks apart
deno test -A --no-check tasks/gather-wood/test.ts -- --bots=10 --spacing=1000
```

#### Run debug script

```bash
cd /home/bridger/git/steve
deno run -A --no-check tasks/gather-wood/debug.ts
```

Or via MCP:

```
Call minecraft_run_script with path="tasks/gather-wood/debug.ts"
```

### 4.4 Running the Main Bot

```bash
cd /home/bridger/git/steve
deno task start
```

This starts the full speedrun bot that progresses through all phases.

### 4.5 Test Configuration

The test in `tasks/gather-wood/test.ts`:

- Uses bot username "TestWood" (single) or "Wood0", "Wood1", etc. (multi)
- Requires bots to be opped for `/clear` command
- 60 second timeout per bot
- Target: 4 logs
- Passes if bot collects >= 4 logs

---

## 5. THE GATHER-WOOD TASK IN-DEPTH

### 5.1 File: tasks/gather-wood/main.ts

This is the main implementation of wood gathering.

### 5.2 Algorithm Overview

The current strategy uses a **bottom-up mining approach**:

```
Phase 1: Mine from the side
┌───┐
│ L │ ← Log at y+3 (mine later from below)
├───┤
│ L │ ← Log at y+2 (mine later from below)
├───┤
│ L │ ← Log at y+1 (mine from side)
├───┤
│ L │ ← Log at y+0 (mine from side)
└───┘
  ▲
  Bot stands here (adjacent to tree)

Phase 2: Mine from below
     ┌───┐
     │ L │ ← Mine this (looking up)
     ├───┤
     │ L │ ← Mine this (looking up)
     ├───┤
     │ A │ ← Air (was log)
     ├───┤
     │ A │ ← Air (was log)
     └───┘
       ▲
       Bot stands here (inside tree column)
```

### 5.3 Key Functions

#### `countLogs()`

Counts all log items in inventory:

```typescript
const countLogs = () =>
  bot.inventory.items()
    .filter((i: { name: string }) => i.name.includes("_log"))
    .reduce((sum: number, i: { count: number }) => sum + i.count, 0);
```

#### `isLog(block)`

Checks if a block is any type of log:

```typescript
const logTypes = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
];
const isLog = (block: { name: string } | null) =>
  block && logTypes.includes(block.name);
```

#### `mineAndCollect(pos)`

Mines a block and collects the drop:

1. Re-fetch block at position (world may have changed)
2. Check distance (must be <= 4.5 blocks)
3. Look at block center
4. Call `bot.dig(block, true)` - forceLook enabled
5. Verify block is gone
6. Walk to drop position to collect

**Current implementation:**

```typescript
const mineAndCollect = async (pos: Vec3): Promise<boolean> => {
  const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
  if (!block || !isLog(block)) return true; // Already gone

  const blockCenter = new Vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
  const dist = bot.entity.position.distanceTo(blockCenter);

  if (dist > 4.5) return false; // Too far

  await bot.lookAt(blockCenter);
  await bot.dig(block, true);

  // Walk to collect drop
  const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 0);
  await botAny.pathfinder.goto(goal);

  return true;
};
```

#### `goTo(pos)`

Navigate to a position with stuck detection:

```typescript
const goTo = async (pos: Vec3): Promise<boolean> => {
  const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 2);

  // Track position to detect stuck
  let lastPos = bot.entity.position.clone();
  let stuckTime = 0;
  const stuckThreshold = 2000; // 2 seconds

  // Check every 100ms if bot moved
  const stuckChecker = setInterval(() => {
    if (bot.entity.position.distanceTo(lastPos) < 0.05) {
      stuckTime += 100;
      if (stuckTime >= stuckThreshold) {
        botAny.pathfinder.stop();
      }
    } else {
      lastPos = bot.entity.position.clone();
      stuckTime = 0;
    }
  }, 100);

  try {
    await botAny.pathfinder.goto(goal);
    return true;
  } catch {
    return bot.entity.position.distanceTo(pos) <= 3;
  } finally {
    clearInterval(stuckChecker);
  }
};
```

#### `findLogsInColumn()`

Scans a vertical column for all logs:

```typescript
const findLogsInColumn = (): Vec3[] => {
  const logs: Vec3[] = [];
  const startY = Math.max(1, log.position.y - 10);
  const endY = Math.min(255, log.position.y + 30);

  for (let y = startY; y <= endY; y++) {
    const pos = new Vec3(treeX, y, treeZ);
    const block = bot.blockAt(pos);
    if (block && isLog(block)) {
      logs.push(pos);
    }
  }
  return logs; // Sorted by Y (lowest first)
};
```

### 5.4 Main Loop Logic

```typescript
while (countLogs() < targetCount) {
  // 1. Find any log within 64 blocks
  const log = bot.findBlock({
    matching: (block) => logTypes.includes(block.name),
    maxDistance: 64,
  });

  if (!log) {
    // Explore in random direction
    continue;
  }

  // 2. Identify tree column
  const treeX = log.position.x;
  const treeZ = log.position.z;

  // 3. Find all logs in column
  const logsInColumn = findLogsInColumn();

  // 4. Go to adjacent position
  const adjacent = [
    new Vec3(treeX + 1, lowestLogY, treeZ),
    new Vec3(treeX - 1, lowestLogY, treeZ),
    new Vec3(treeX, lowestLogY, treeZ + 1),
    new Vec3(treeX, lowestLogY, treeZ - 1),
  ];
  await goTo(closestAdjacent);

  // 5. Phase 1: Mine bottom logs from side
  for (const logPos of logsInColumn) {
    if (logPos.y <= groundY + 1) {
      await mineAndCollect(logPos);
    }
  }

  // 6. Phase 2: Move into tree column, mine remaining from below
  // Walk into the cleared space
  await bot.lookAt(treeCenter);
  bot.setControlState("forward", true);
  // Wait until close to tree center...
  bot.setControlState("forward", false);

  // Mine remaining logs looking up
  while (logsInColumn.length > 0) {
    await mineAndCollect(logsInColumn[0]);
  }
}
```

### 5.5 Test Output Example

```
Running gather-wood test...
  Found tree at column (28, -25)
  Found 4 logs in column (y=73 to y=76)
  Phase 1: Mining bottom logs from side (groundY=71)
    Mining oak_log at y=73, dist=2.31
    Dig completed
    Block mined, collecting drop...
    Have 1 logs
  Mined log at y=73, have 1/4 logs
    Mining oak_log at y=74, dist=2.85
    Dig completed
    Block mined, collecting drop...
    Have 2 logs
  Mined log at y=74, have 2/4 logs
  Phase 2: Moving under tree to mine 2 remaining logs
  Now at (28.5, 71.0, -25.5), tree at (28, -25)
    Mining oak_log at y=75, dist=4.00
    Dig completed
    Block mined, collecting drop...
    Have 3 logs
  Mined log at y=75, have 3/4 logs
    Mining oak_log at y=76, dist=5.00
    Dig completed
    Block mined, collecting drop...
    Have 4 logs
  Mined log at y=76, have 4/4 logs
Gathered 4 logs
```

---

## 6. CURRENT ISSUES AND DEBUGGING

### 6.1 Issue: Phase 2 Positioning

**Problem:** After mining the bottom logs in Phase 1, the bot tries to move into
the tree column for Phase 2 but often ends up too far away to mine the logs
above.

**Symptoms:**

```
Phase 2: Moving under tree to mine 4 remaining logs
  Mining oak_log at y=73, dist=5.20
  Too far to mine (5.20 > 4.5)
Failed to mine log at y=73
```

**Root Cause:** The pathfinder's `GoalNear(x, y, z, 0)` doesn't guarantee the
bot will be exactly at the tree column. It may stop at an adjacent block.

**Current Fix Attempt:** Instead of pathfinding, we now:

1. Look at the tree column center
2. Walk forward until we're within 0.5 blocks of tree center (XZ plane)

**Code:**

```typescript
const treeCenter = new Vec3(
  treeX + 0.5,
  bot.entity.position.y + 0.5,
  treeZ + 0.5,
);
await bot.lookAt(treeCenter);

const targetDist = 0.5;
const maxWalkTime = 2000;
const startTime = Date.now();

bot.setControlState("forward", true);
while (Date.now() - startTime < maxWalkTime) {
  const dx = (treeX + 0.5) - bot.entity.position.x;
  const dz = (treeZ + 0.5) - bot.entity.position.z;
  const distXZ = Math.sqrt(dx * dx + dz * dz);

  if (distXZ < targetDist) break;
  await new Promise((r) => setTimeout(r, 50));
}
bot.setControlState("forward", false);
```

### 6.2 Issue: Item Collection

**Problem:** Sometimes logs are mined but not collected. The inventory shows 0
logs after a successful dig.

**Symptoms:**

```
Dig completed
Block mined, collecting drop...
Have 0 logs
```

**Root Cause:** Items drop at the block position but the bot doesn't always walk
close enough to pick them up.

**Debugging Steps:**

1. Check if item entity spawned (use `bot.on("itemDrop", ...)`)
2. Check distance to dropped item
3. Verify bot walks to correct position
4. Check if another entity (player, mob) collected it first

**Code to detect drops:**

```typescript
bot.on("itemDrop", (entity) => {
  console.log(`ITEM DROP: ${entity.name} at ${entity.position}`);
});

bot.on("playerCollect", (collector, collected) => {
  console.log(`COLLECT: ${collector.username} collected ${collected.name}`);
});
```

### 6.3 Issue: Mining Distance

**Problem:** `bot.dig()` fails with "Error: cannot reach" if bot is more than
~4.5 blocks from block center.

**Solution:** Always check distance before mining:

```typescript
const blockCenter = new Vec3(x + 0.5, y + 0.5, z + 0.5);
const dist = bot.entity.position.distanceTo(blockCenter);
if (dist > 4.5) {
  // Move closer first
}
```

### 6.4 Issue: Pathfinder Getting Stuck

**Problem:** The pathfinder sometimes gets stuck trying to navigate complex
terrain.

**Symptoms:**

- Bot doesn't move for extended periods
- Pathfinder never completes (hangs)

**Solution:** Implement stuck detection:

```typescript
const stuckThreshold = 2000; // 2 seconds
let lastPos = bot.entity.position.clone();
let stuckTime = 0;

const checker = setInterval(() => {
  const moved = bot.entity.position.distanceTo(lastPos) > 0.05;
  if (moved) {
    lastPos = bot.entity.position.clone();
    stuckTime = 0;
  } else {
    stuckTime += 100;
    if (stuckTime >= stuckThreshold) {
      botAny.pathfinder.stop();
    }
  }
}, 100);
```

### 6.5 Issue: Tree Not Found

**Problem:** `bot.findBlock()` returns null even when trees are visible.

**Possible Causes:**

1. Trees are beyond maxDistance (64 blocks)
2. Chunk not loaded
3. Wrong block type (e.g., "stripped_oak_log" instead of "oak_log")

**Debugging:**

```typescript
// Increase search radius
const log = bot.findBlock({
  matching: (block) => logTypes.includes(block.name),
  maxDistance: 128,
});

// Or use get_view to see nearby blocks
const view = getView(16);
const logs = view.nearbyBlocks.filter((b) => b.name.includes("_log"));
```

---

## 7. COMMON DEBUGGING PATTERNS

### 7.1 Manual MCP Testing Workflow

When debugging, use MCP tools directly to isolate problems:

```
1. Connect bot:
   minecraft_spawn_bot

2. Check surroundings:
   minecraft_get_view with radius=16

3. Find a tree in nearbyBlocks output

4. Navigate to tree:
   minecraft_go_to with x=treeX y=treeY z=treeZ

5. Check position:
   minecraft_get_position

6. Look at log:
   minecraft_look_at with x=logX+0.5 y=logY+0.5 z=logZ+0.5

7. Mine the log:
   minecraft_mine_block with x=logX y=logY z=logZ

8. Check inventory:
   minecraft_get_inventory

9. Walk to collect:
   minecraft_walk with direction="forward" duration_ms=1000

10. Check inventory again:
    minecraft_get_inventory
```

### 7.2 Using the Debug Script

The `tasks/gather-wood/debug.ts` script tests a single mine operation with
extensive logging:

```bash
deno run -A --no-check tasks/gather-wood/debug.ts
```

Output shows:

- Bot spawn position
- Nearest log found
- Distance calculations
- Look direction changes
- Dig timing
- Item collection attempts
- Final inventory state

### 7.3 Adding Console Logging

When debugging, add detailed logs:

```typescript
console.log(`=== PHASE 1 START ===`);
console.log(`Bot position: ${bot.entity.position}`);
console.log(`Tree column: (${treeX}, ${treeZ})`);
console.log(`Logs in column: ${logsInColumn.map((l) => l.y).join(", ")}`);

for (const logPos of logsInColumn) {
  const dist = bot.entity.position.distanceTo(logPos);
  console.log(`Log at y=${logPos.y}, distance=${dist.toFixed(2)}`);
}
```

### 7.4 Checking Block States

```typescript
// Before mining
const before = bot.blockAt(new Vec3(x, y, z));
console.log(`Before: ${before?.name} at (${x}, ${y}, ${z})`);

// After mining
await bot.dig(block, true);
await new Promise((r) => setTimeout(r, 100));
const after = bot.blockAt(new Vec3(x, y, z));
console.log(`After: ${after?.name} at (${x}, ${y}, ${z})`);

if (after?.name !== "air") {
  console.log(`ERROR: Block still there!`);
}
```

### 7.5 Inventory Debugging

```typescript
const items = bot.inventory.items();
console.log(`Inventory (${items.length} stacks):`);
for (const item of items) {
  console.log(`  Slot ${item.slot}: ${item.count}x ${item.name}`);
}

const logs = items.filter((i) => i.name.includes("_log"));
const totalLogs = logs.reduce((sum, i) => sum + i.count, 0);
console.log(`Total logs: ${totalLogs}`);
```

---

## 8. MINECRAFT MECHANICS REFERENCE

### 8.1 Coordinate System

```
  +Y (up)
   │
   │
   │
   └───────── +X (east)
  /
 /
+Z (south)
```

- Y increases going up (sky is high Y, bedrock is Y=0)
- Block positions are integers
- Entity positions are floating point (center of hitbox at feet level)

### 8.2 Block Positions vs Entity Positions

**Block Position:** Integer coordinates for the block

- Block at (10, 64, -20) occupies space from (10.0, 64.0, -20.0) to (11.0, 65.0,
  -19.0)

**Block Center:** Add 0.5 to each coordinate

- Center of block (10, 64, -20) is (10.5, 64.5, -19.5)

**Entity Position:** Floating point at feet level

- Player at (10.5, 64.0, -19.5) is standing on block (10, 63, -20)

### 8.3 Mining Mechanics

**Mining Range:** ~4.5 blocks from player eyes to block center

- Player eye height is position.y + 1.62
- Check distance: `bot.entity.position.distanceTo(blockCenter)`

**Mining Time:** Depends on:

- Tool type (correct tool mines faster)
- Tool tier (diamond > iron > stone > wood > fist)
- Block hardness
- Enchantments (efficiency)

**Logs:** Can be mined with fist (takes ~3 seconds) or axe (faster)

### 8.4 Item Drops

- Items drop as entities at the block position
- Items have a small velocity when spawned
- Collection range: ~1.5 blocks from player position
- Items despawn after 5 minutes

### 8.5 Tree Structure

**Oak Tree:**

```
   [L]     ← y+4 (leaves + sometimes log)
 [LLL]    ← y+3 (leaves)
[LLLLL]   ← y+2 (leaves + log)
 [LLL]    ← y+1 (leaves + log)
   L      ← y+0 (log, ground level)
```

- Logs are always in a vertical column
- Leaves surround the top logs
- Some trees have branches (multiple log columns)
- Big trees (jungle, dark oak) have different structures

### 8.6 Pathfinder Goals

mineflayer-pathfinder provides several goal types:

```typescript
import { goals } from "mineflayer-pathfinder";

// Get within range blocks of XYZ
new goals.GoalNear(x, y, z, range);

// Get to exact block
new goals.GoalBlock(x, y, z);

// Get within range of XZ (ignores Y)
new goals.GoalXZ(x, z);

// Follow an entity
new goals.GoalFollow(entity, range);

// Look at position
new goals.GoalLookAtBlock(pos);
```

---

## 9. CODE PATTERNS AND CONVENTIONS

### 9.1 Async/Await Pattern

All bot operations are async:

```typescript
// Good
await bot.lookAt(pos);
await new Promise((r) => setTimeout(r, 100)); // Small delay
await bot.dig(block, true);

// Bad - missing await
bot.lookAt(pos); // Won't wait for completion
bot.dig(block, true); // Starts but doesn't wait
```

### 9.2 Error Handling

Always wrap bot operations in try/catch:

```typescript
try {
  await bot.dig(block, true);
} catch (e) {
  console.log(`Dig error: ${e}`);
  // Handle error - maybe move closer, try again, etc.
}
```

### 9.3 Type Assertions

mineflayer types are incomplete, use `any` when needed:

```typescript
// deno-lint-ignore no-explicit-any
const botAny = bot as any;

// Access pathfinder
botAny.pathfinder.goto(goal);

// Access movements
const movements = new Movements(bot as any);
```

### 9.4 Vec3 Usage

```typescript
import { Vec3 } from "vec3";

// Create a position
const pos = new Vec3(10, 64, -20);

// Offset (returns new Vec3)
const center = pos.offset(0.5, 0.5, 0.5);

// Distance
const dist = pos.distanceTo(other);

// Clone (important for storing position)
const saved = bot.entity.position.clone();

// Equality check
if (pos.equals(other)) { ... }
```

### 9.5 Control States

```typescript
// Enable control
bot.setControlState("forward", true);

// Wait
await new Promise((r) => setTimeout(r, 1000));

// Disable control
bot.setControlState("forward", false);

// Available controls: forward, back, left, right, jump, sprint, sneak
```

### 9.6 Inventory Access

```typescript
// Get all items
const items = bot.inventory.items();

// Filter by name
const logs = items.filter((i) => i.name.includes("_log"));

// Count specific item
const count = logs.reduce((sum, i) => sum + i.count, 0);

// Check for item
const hasAxe = items.some((i) => i.name.includes("_axe"));
```

---

## 10. MANUAL MCP TESTING GUIDE

### 10.1 Testing Mining a Single Log

This is the most important test for debugging gather-wood:

```
Step 1: Connect the bot
> minecraft_spawn_bot

Result: Bot spawned at position X, Y, Z

Step 2: Get surroundings
> minecraft_get_view with radius=16

Result: Look for oak_log, birch_log, etc. in nearbyBlocks

Step 3: Note a log position
Example: oak_log at {x: 125, y: 72, z: -34}

Step 4: Navigate near the log
> minecraft_go_to with x=126 y=72 z=-34

(Go to adjacent position, not the log itself)

Step 5: Check position
> minecraft_get_position

Verify you're close to the log (distance < 4)

Step 6: Look at the log
> minecraft_look_at with x=125.5 y=72.5 z=-33.5

(Add 0.5 for block center)

Step 7: Mine the log
> minecraft_mine_block with x=125 y=72 z=-34

Result: { success: true, blockMined: "oak_log" }

Step 8: Check inventory
> minecraft_get_inventory

Should show oak_log in items (may need to walk to collect first)

Step 9: Collect drop if needed
> minecraft_walk with direction="forward" duration_ms=500

Step 10: Check inventory again
> minecraft_get_inventory

Should now show the log
```

### 10.2 Testing Phase 2 (Mining from Below)

```
Step 1: Find a tall tree (4+ logs)
> minecraft_get_view with radius=16

Step 2: Note the tree column position
Example: logs at (100, 70-73, 50)

Step 3: Navigate to the base
> minecraft_go_to with x=101 y=70 z=50

Step 4: Mine bottom log from side
> minecraft_mine_block with x=100 y=70 z=50

Step 5: Mine second log from side
> minecraft_mine_block with x=100 y=71 z=50

Step 6: Walk into tree column
> minecraft_look_at with x=100.5 y=71 z=50.5
> minecraft_walk with direction="forward" duration_ms=500

Step 7: Check position
> minecraft_get_position

Should be at approximately x=100.5, z=50.5

Step 8: Mine log above (looking up)
> minecraft_look_at with x=100.5 y=72.5 z=50.5
> minecraft_mine_block with x=100 y=72 z=50

Step 9: Continue for remaining logs
> minecraft_mine_block with x=100 y=73 z=50

Step 10: Verify inventory
> minecraft_get_inventory
```

### 10.3 Testing Pathfinding

```
Step 1: Spawn bot
> minecraft_spawn_bot

Step 2: Get current position
> minecraft_get_position

Example: x=50, y=64, z=100

Step 3: Navigate to distant point
> minecraft_go_to with x=80 y=64 z=130

Step 4: Check result position
> minecraft_get_position

Should be near (80, 64, 130) if successful

Step 5: Test navigation to specific block
> minecraft_get_view with radius=10

Find a specific block, navigate to it
```

### 10.4 Testing Control States

```
Step 1: Spawn and get position
> minecraft_spawn_bot
> minecraft_get_position

Step 2: Look in a direction
> minecraft_look_at with x=1000 y=64 z=0

(Looking east)

Step 3: Walk forward
> minecraft_walk with direction="forward" duration_ms=2000

Step 4: Check new position
> minecraft_get_position

Should have moved ~8 blocks east

Step 5: Test turning
> minecraft_turn with yaw_degrees=90

Now facing south

Step 6: Walk forward again
> minecraft_walk with direction="forward" duration_ms=2000

Step 7: Check position
> minecraft_get_position

Should have moved south
```

---

## 11. TROUBLESHOOTING CHECKLIST

### 11.1 Bot Won't Connect

- [ ] Minecraft server is running
- [ ] Server is on localhost:25565
- [ ] `online-mode=false` in server.properties
- [ ] No other bot with same username connected

### 11.2 Bot Can't Find Trees

- [ ] Trees exist within 64 blocks
- [ ] Chunks are loaded (bot needs to be in world a moment)
- [ ] Using correct log type names
- [ ] Try increasing maxDistance

### 11.3 Mining Fails

- [ ] Bot is within 4.5 blocks of block center
- [ ] Bot is looking at the block (`bot.lookAt()` called)
- [ ] Block still exists (hasn't been mined already)
- [ ] Using integer coordinates for block position

### 11.4 Items Not Collected

- [ ] Bot walks to block position after mining
- [ ] Waiting long enough after walking (items need time to be picked up)
- [ ] No other entity collecting items
- [ ] Inventory not full

### 11.5 Pathfinder Gets Stuck

- [ ] Destination is reachable (not blocked by walls)
- [ ] Using GoalNear with reasonable range (not 0)
- [ ] Stuck detection implemented
- [ ] Movements configured correctly (canDig, allowParkour)

### 11.6 Test Times Out

- [ ] 60 second timeout may be too short for complex tasks
- [ ] Bot may be stuck (add logging)
- [ ] Server may be lagging
- [ ] Check for infinite loops

### 11.7 MCP Server Not Working

- [ ] Running `deno task mcp` in correct directory
- [ ] `opencode.json` exists and is configured
- [ ] No TypeScript errors in mcp/*.ts files
- [ ] Check stderr output for errors

---

## 12. FUTURE IMPROVEMENTS

### 12.1 Immediate Fixes Needed

1. **Phase 2 Positioning**
   - Current: Walking forward toward tree center
   - Better: Calculate exact position needed, use precise movement
   - Consider: Pillar up instead of mining from below?

2. **Item Collection Reliability**
   - Add retry logic if item not collected
   - Track item entities explicitly
   - Wait for `playerCollect` event

3. **Stuck Detection**
   - Add global timeout for entire tree
   - Detect when bot is in same position for too long
   - Add escape hatch (abandon tree, find new one)

### 12.2 Algorithm Improvements

1. **Tree Selection**
   - Prefer shorter trees (fewer logs to mine)
   - Avoid trees near water/lava
   - Avoid trees on cliffs

2. **Mining Strategy**
   - Consider pillar scaffolding (place blocks to climb)
   - Consider using jump + mine for logs at height
   - Mine multiple trees in parallel (if multi-bot)

3. **Pathfinding**
   - Custom movement costs for different terrain
   - Cache paths to common destinations
   - Fall back to simple walking when pathfinder fails

### 12.3 Code Quality

1. **Better Error Messages**
   - Include position information
   - Include distance information
   - Include block state information

2. **Logging Levels**
   - Debug level for detailed output
   - Info level for progress
   - Error level for failures

3. **Unit Tests**
   - Test individual helper functions
   - Mock bot for testing without server
   - Test edge cases (no trees, stuck, etc.)

### 12.4 Performance

1. **Reduce API Calls**
   - Cache block lookups
   - Batch operations where possible
   - Use events instead of polling

2. **Parallel Operations**
   - Mine while walking when possible
   - Look ahead for next tree while mining current

### 12.5 Other Tasks to Implement

After gather-wood is reliable, the following tasks need work:

1. **Crafting** - Place crafting table, craft items
2. **Mining** - Find caves, mine stone/coal/iron
3. **Smelting** - Place furnace, smelt ores
4. **Combat** - Kill mobs for food/ender pearls
5. **Nether** - Build portal, find fortress, kill blazes
6. **Stronghold** - Triangulate with eyes of ender
7. **End** - Destroy crystals, kill dragon

---

## APPENDIX A: COMPLETE TOOL LIST

| Tool                       | Description              | Key Parameters             |
| -------------------------- | ------------------------ | -------------------------- |
| `minecraft_spawn_bot`      | Connect bot              | host, port, username       |
| `minecraft_disconnect_bot` | Disconnect               | -                          |
| `minecraft_is_connected`   | Check connection         | -                          |
| `minecraft_get_position`   | Get position/orientation | -                          |
| `minecraft_get_view`       | Get surroundings         | radius                     |
| `minecraft_get_block_at`   | Get block at position    | x, y, z                    |
| `minecraft_walk`           | Walk in direction        | direction, duration_ms     |
| `minecraft_jump`           | Jump                     | -                          |
| `minecraft_look_at`        | Look at position         | x, y, z                    |
| `minecraft_turn`           | Turn by degrees          | yaw_degrees, pitch_degrees |
| `minecraft_go_to`          | Pathfind to position     | x, y, z                    |
| `minecraft_mine_block`     | Mine block               | x, y, z                    |
| `minecraft_get_inventory`  | Get inventory            | -                          |
| `minecraft_select_slot`    | Select hotbar slot       | slot                       |
| `minecraft_attack`         | Attack entity            | -                          |
| `minecraft_use_item`       | Use held item            | -                          |
| `minecraft_place_block`    | Place block              | x, y, z                    |
| `minecraft_run_script`     | Run TS file              | path, timeout_ms           |
| `minecraft_run_test`       | Run test file            | path, timeout_ms           |
| `minecraft_chat`           | Send chat message        | message                    |

---

## APPENDIX B: KEY FILE LOCATIONS

| File                                                 | Purpose              |
| ---------------------------------------------------- | -------------------- |
| `/home/bridger/git/steve/mcp/bot.ts`                 | Bot instance manager |
| `/home/bridger/git/steve/mcp/server.ts`              | MCP server           |
| `/home/bridger/git/steve/tasks/gather-wood/main.ts`  | Wood gathering logic |
| `/home/bridger/git/steve/tasks/gather-wood/test.ts`  | Test runner          |
| `/home/bridger/git/steve/tasks/gather-wood/debug.ts` | Debug script         |
| `/home/bridger/git/steve/deno.json`                  | Deno config          |
| `/home/bridger/git/steve/opencode.json`              | MCP config           |
| `/home/bridger/git/steve/types.ts`                   | Type definitions     |
| `/home/bridger/git/steve/state.ts`                   | State management     |
| `/home/bridger/git/steve/steps.ts`                   | Speedrun steps       |

---

## APPENDIX C: COMMAND REFERENCE

```bash
# Start MCP server
cd /home/bridger/git/steve && deno task mcp

# Run main bot
cd /home/bridger/git/steve && deno task start

# Run gather-wood test
cd /home/bridger/git/steve && deno test -A --no-check tasks/gather-wood/test.ts

# Run gather-wood test with multiple bots
cd /home/bridger/git/steve && deno test -A --no-check tasks/gather-wood/test.ts -- --bots=10

# Run debug script
cd /home/bridger/git/steve && deno run -A --no-check tasks/gather-wood/debug.ts

# Run all tests
cd /home/bridger/git/steve && deno task test
```

---

## APPENDIX D: LOG TYPES

```typescript
const logTypes = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
];
```

Note: Stripped logs (e.g., `stripped_oak_log`) are NOT included.

---

## APPENDIX E: COMMON ERROR MESSAGES

| Error                   | Cause                        | Solution                              |
| ----------------------- | ---------------------------- | ------------------------------------- |
| "Bot not connected"     | Called tool without spawning | Call `minecraft_spawn_bot` first      |
| "Bot already connected" | Tried to spawn twice         | Call `minecraft_disconnect_bot` first |
| "cannot reach"          | Too far to mine              | Move closer (< 4.5 blocks)            |
| "No block at position"  | Block is air                 | Check block exists first              |
| "Connection timeout"    | Server not running           | Start Minecraft server                |
| "GoalNotReached"        | Pathfinding failed           | Try different path or manual walk     |

---

## APPENDIX F: DISTANCE CALCULATIONS

```typescript
// Distance from bot to block (for mining range check)
const blockCenter = new Vec3(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
const distance = bot.entity.position.distanceTo(blockCenter);

// Mining range is approximately 4.5 blocks
if (distance <= 4.5) {
  // Can mine
}

// Distance on XZ plane only (for horizontal positioning)
const dx = targetX - bot.entity.position.x;
const dz = targetZ - bot.entity.position.z;
const distXZ = Math.sqrt(dx * dx + dz * dz);
```

---

## APPENDIX G: TEST BOT SETUP

For tests to work, bots need certain permissions:

```
# In Minecraft server console:
/op TestWood
/op MCPBot
/op Wood0
/op Wood1
# ... etc for multi-bot tests
```

The `/clear` command is used before each test to ensure empty inventory.

---

## APPENDIX H: SAMPLE DEBUG SESSION

```
> minecraft_spawn_bot
{"success":true,"message":"Bot spawned at position 50, 64, 100","position":{"x":50,"y":64,"z":100}}

> minecraft_get_view with radius=12
{
  "position": {"x":50,"y":64,"z":100},
  "health": 20,
  "food": 20,
  "nearbyBlocks": [
    {"name":"oak_log","position":{"x":55,"y":65,"z":98},"distance":5.4},
    {"name":"oak_log","position":{"x":55,"y":66,"z":98},"distance":5.7},
    {"name":"oak_log","position":{"x":55,"y":67,"z":98},"distance":6.2},
    ...
  ]
}

> minecraft_go_to with x=54 y=65 z=98
{"success":true,"position":{"x":54.2,"y":65.0,"z":98.1}}

> minecraft_get_position
{"x":54.23,"y":65.0,"z":98.14,"yaw":45.2,"pitch":0}

> minecraft_look_at with x=55.5 y=65.5 z=98.5
{"success":true}

> minecraft_mine_block with x=55 y=65 z=98
{"success":true,"blockMined":"oak_log"}

> minecraft_get_inventory
{"items":[]}

> minecraft_walk with direction="forward" duration_ms=500
{"success":true,"position":{"x":55,"y":65,"z":98}}

> minecraft_get_inventory
{"items":[{"name":"oak_log","count":1,"slot":0}]}
```

---

END OF DOCUMENT

Last Updated: December 2024 Author: Claude AI (with human collaboration)
Project: Steve - Ender Dragon Speedrun Bot Focus: gather-wood task debugging
