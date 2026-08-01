# src/bot/

Minecraft bot — connects to a server, tracks game state, and exposes methods for interaction. Rewrites [mineflayer](https://github.com/PrismarineJS/mineflayer) (~7,500 lines across 41 plugins) as ~3,800 lines of typed functional TypeScript.

## Usage

```ts
import { createBot } from "typecraft";

const bot = createBot({
  host: "localhost",
  port: 25565,
  username: "Bot",
  version: "1.20.4",
  auth: "offline",
});

bot.on("login", () => console.log("Logged in"));
bot.on("spawn", () => console.log("Spawned"));

bot.on("chat", (username, message) => {
  if (message === "hello") bot.chat(`Hi ${username}!`);
});

bot.on("health", () => {
  console.log(`HP: ${bot.health}, Food: ${bot.food}`);
});
```

## Architecture

`createBot(options)` returns a `Bot` — an `EventEmitter` with typed state and methods. Instead of mineflayer's 29 dynamic plugins, 14 static init functions each receive `(bot, options)` and register packet handlers + methods:

| Init function | File | Upstream | What it does |
|---|---|---|---|
| `initGame` | `game.ts` | game.js | Login/respawn, gamemode, difficulty, dimension |
| `initEntities` | `entities.ts` | entities.js | Entity lifecycle, player list, attack/mount |
| `initBlocks` | `blocks.ts` | blocks.js | World/chunk management, block queries |
| `initPhysics` | `physics.ts` | physics.js | 50ms physics loop, movement, look |
| `initStatus` | `status.ts` | health.js, experience.js, breath.js, settings.js | HP, food, XP, oxygen, player settings |
| `initInventory` | `inventory.ts` | inventory.js, simple_inventory.js | Windows, slots, equip/toss/transfer |
| `initChat` | `chat.ts` | chat.js | Send/receive chat, whisper, tab complete |
| `initCrafting` | `crafting.ts` | craft.js | Recipe lookup, crafting |
| `initDigging` | `digging.ts` | digging.js | Block mining |
| `initPlacing` | `placing.ts` | place_block.js, generic_place.js, place_entity.js | Block/entity placement |
| `initWorldState` | `world_state.ts` | rain.js, time.js, spawn_point.js | Time, weather, spawn point |
| `initSocial` | `social.ts` | team.js, scoreboard.js, boss_bar.js, tablist.js | Teams, scoreboards, boss bars |
| `initExtended` | `extended.ts` | bed.js, title.js, sound.js, particle.js, etc. | Sleep, titles, fishing, sounds |
| `initContainers` | `containers.ts` | chest.js, furnace.js, anvil.js, etc. | Specialized container UIs, creative mode |

## Bot state

The `Bot` object exposes game state as mutable properties:

```ts
bot.health           // number (0-20)
bot.food             // number (0-20)
bot.experience       // { level, points, progress }
bot.game             // { gameMode, dimension, difficulty, ... }
bot.entity           // Entity (self — position, velocity, yaw, pitch)
bot.entities         // Record<number, Entity>
bot.players          // Record<string, Player>
bot.inventory        // Window (player inventory)
bot.currentWindow    // Window | null (open container)
bot.heldItem         // Item | null
bot.controlState     // { forward, back, left, right, jump, sprint, sneak }
bot.isRaining        // boolean
bot.time             // { timeOfDay, day, isDay, ... }
bot.teams            // Record<string, Team>
bot.scoreboards      // Record<string, ScoreBoard>
bot.bossBars         // Record<string, BossBar>
bot.tablist          // { header, footer }
```

## Bot methods

### Movement & physics
- `setControlState(control, state)` — Set forward/back/left/right/jump/sprint/sneak
- `clearControlStates()` — Release all controls
- `look(yaw, pitch, force?)` — Set view direction (radians)
- `lookAt(point, force?)` — Look at a world position
- `waitForTicks(n)` — Wait for n physics ticks

### Chat
- `chat(message)` — Send chat message (auto-splits long messages)
- `whisper(username, message)` — Send `/tell` whisper
- `tabComplete(text)` — Request tab completions
- `chatAddPattern(regex, type, description?)` — Add custom chat pattern

### Inventory
- `clickWindow(slot, button, mode)` — Raw window click
- `equip(item, destination)` — Equip item to hand/armor/off-hand
- `unequip(destination)` — Remove equipment
- `toss(itemType, metadata, count)` — Drop items
- `tossStack(item)` — Drop an entire stack
- `setQuickBarSlot(slot)` — Change held slot (0-8)
- `transfer(options)` — Move items between slot ranges

### Blocks & world
- `blockAt(point)` — Get block at position
- `findBlock(options)` — Find nearest matching block
- `findBlocks(options)` — Find all matching blocks in range
- `canSeeBlock(block)` — Line-of-sight check
- `dig(block, forceLook?, digFace?)` — Mine a block
- `stopDigging()` — Cancel mining
- `placeBlock(block, faceVector)` — Place block
- `activateBlock(block)` — Right-click a block

### Containers
- `openBlock(position)` / `openEntity(entity)` — Open container
- `openChest(block)` / `openFurnace(block)` / `openAnvil(block)` / `openEnchantmentTable(block)` / `openVillager(entity)`
- `closeWindow(window)` — Close container

### Combat & entities
- `attack(entity)` — Attack entity
- `useOn(entity)` — Right-click entity
- `swingArm(hand?)` — Swing arm animation
- `mount(entity)` / `dismount()` — Vehicle control
- `nearestEntity(filter?)` — Find closest entity

### Items
- `activateItem(offhand?)` — Use held item
- `deactivateItem()` — Stop using item
- `consume()` — Eat/drink held item

### Crafting
- `recipesFor(itemType, metadata?, minCount?, table?)` — Find recipes
- `recipesAll(itemType, metadata?, table?)` — All recipes for item
- `craft(recipe, count, table?)` — Craft items

### Other
- `sleep(bedBlock)` / `wake()` — Bed interaction
- `fish()` — Cast fishing rod and wait for bite
- `setSettings(settings)` — Update client settings
- `acceptResourcePack()` / `denyResourcePack()` — Resource pack response

## Events

### Lifecycle
`login`, `spawn`, `respawn`, `game`, `death`, `end`, `kicked`, `error`, `connect`

### Chat
`chat`, `whisper`, `message`, `messagestr`, `actionBar`, `unmatchedMessage`

### Entities
`entitySpawn`, `entityGone`, `entityMoved`, `entityUpdate`, `entityEquip`, `entityAttributes`, `entityEffect`, `entityEffectEnd`, `entitySwingArm`, `entityHurt`, `entityDead`, `entitySleep`, `entityWake`, `entityCrouch`, `entityUncrouch`, `entityAttach`, `entityDetach`, `itemDrop`, `playerCollect`, `playerJoined`, `playerUpdated`, `playerLeft`

### World & blocks
`blockUpdate`, `chunkColumnLoad`, `chunkColumnUnload`, `move`, `forcedMove`, `physicsTick`, `diggingCompleted`, `diggingAborted`

### Status
`health`, `breath`, `experience`

### Social
`scoreboardCreated`, `scoreboardDeleted`, `scoreboardTitleChanged`, `scoreUpdated`, `scoreRemoved`, `scoreboardPosition`, `teamCreated`, `teamRemoved`, `teamUpdated`, `teamMemberAdded`, `teamMemberRemoved`, `bossBarCreated`, `bossBarDeleted`, `bossBarUpdated`

### UI & environment
`windowOpen`, `windowClose`, `title`, `rain`, `time`, `spawnReset`, `sleep`, `wake`, `soundEffectHeard`, `hardcodedSoundEffectHeard`, `particle`, `mount`, `dismount`

## Conversion utilities

Pure functions for Minecraft's Notchian angle/velocity encoding:

```ts
import {
  fromNotchianYaw,
  toNotchianYaw,
  fromNotchianPitch,
  toNotchianPitch,
  fromNotchVelocity,
  toRadians,
  toDegrees,
} from "typecraft";

const radians = fromNotchianYaw(90);     // Notchian degrees -> radians
const degrees = toNotchianYaw(radians);   // radians -> Notchian degrees
const vel = fromNotchVelocity({ x: 8000, y: 0, z: 0 }); // -> { x: 1, y: 0, z: 0 }
```

## Async utilities

```ts
import { sleep, createTask, once, withTimeout, clamp } from "typecraft";

await sleep(1000);                              // delay
const [entity] = await once(bot, "entitySpawn"); // wait for event
const result = await withTimeout(promise, 5000); // race against timeout

const task = createTask<string>();               // controllable promise
task.finish("done");
await task.promise; // "done"
```

## Testing

Inject a mock client to test without a server:

```ts
import { EventEmitter } from "node:events";
import { createBot } from "typecraft";

const client = Object.assign(new EventEmitter(), {
  write: (name, params) => { /* record packets */ },
  writeRaw: () => {},
  end: () => {},
  setSocket: () => {},
  setEncryption: () => {},
  setCompressionThreshold: () => {},
  state: "play",
  username: "TestBot",
  uuid: "00000000-0000-0000-0000-000000000000",
  version: "1.20.4",
  protocolVersion: 765,
  socket: null,
});

const bot = createBot({ username: "TestBot", version: "1.20.4", client });

// Simulate server packets
client.emit("login", { entityId: 1, gameMode: 0, dimension: 0, maxPlayers: 20 });
client.emit("update_health", { health: 20, food: 20, foodSaturation: 5 });
```

## Files

```
src/bot/
  createBot.ts      Factory function
  types.ts          All bot types
  events.ts         BotEventMap (typed events)
  conversions.ts    Angle/velocity math
  utils.ts          Promise helpers (sleep, createTask, once)
  game.ts           Login, respawn, gamemode
  entities.ts       Entity lifecycle, player list
  blocks.ts         World, chunks, block queries
  physics.ts        Physics loop, movement
  status.ts         Health, XP, settings
  inventory.ts      Windows, items, equip
  chat.ts           Chat messaging
  crafting.ts       Recipes
  digging.ts        Block mining
  placing.ts        Block/entity placement
  world_state.ts    Time, weather, spawn
  social.ts         Teams, scoreboards, boss bars
  extended.ts       Bed, titles, fishing, sounds
  containers.ts     Chest, furnace, anvil, creative
  index.ts          Barrel exports
```
