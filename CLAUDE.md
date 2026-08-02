# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**steve** is an autonomous Minecraft Ender-Dragon speedrun bot that attempts to beat the game (random seed, any%, glitchless) with **zero human input** — plus the SvelteKit app that runs it and watches it. The bot could start in any world and reliably do what a human does to win: gather wood → tools → iron → cast a nether portal → fortress/blazes → eyes of ender → stronghold → the End → kill the dragon. **Reliability and generality matter more than raw speed** — no X-ray, no teleporting, no gimmicks, no diamond-pickaxe obsidian (obsidian is *cast* with water+lava).

It is one SvelteKit 5 project that does three things:

1. **Runs the bot in-process.** `src/lib/server/bot.ts` (`startBot`) spins the bot up inside the vite/node server — the app *is* the bot's host, not a passive viewer.
2. **The bot engine** — `src/lib/steve/` (the speedrun logic) built on the vendored **typecraft** SDK in `src/lib/typecraft/`.
3. **A live dashboard** — a "Mission Control" UI (`src/routes/+page.svelte`) + a Babylon.js first-person 3D stream, fed by the bot's telemetry in Postgres.

The bot and the typecraft SDK used to be separate repos (`upstream/steve`, `upstream/typecraft`) and this app was `eye-of-steve`; they were merged into this one project. If a doc/comment still says "eye-of-steve" or treats the dashboard as read-only, it's stale — this repo *runs* the bot.

## Commands

```bash
npm install                    # first (node_modules not committed)
docker compose up -d           # local Postgres (compose.yaml → host port 4623)
npm run dev                    # vite dev: dashboard + the in-process bot → http://localhost:4558
npm run build                  # adapter-node production build
npm run check                  # svelte-check (type-check — there is NO lint)
npm run test:unit -- --run     # vitest once; append a path to scope one file
npm run test:e2e               # playwright (installs browsers first)
npm run sync-viewer            # rebuild the typecraft Babylon viewer bundle → static/web/

# interactive debug harnesses (connect a test bot via RCON, reproduce a scenario):
node --env-file=.env --import ./typecraft-resolve.mjs water-harness.ts   # water-escape
node --env-file=.env --import ./typecraft-resolve.mjs craft-harness.ts   # table placement
```

- **Ports are name-derived** via `@bridgerb/port-from-name` (from `package.json` `name`): vite dashboard **4558**, Postgres **4623**. Renaming the package changes them.
- **Runs as TypeScript** — Node executes `.ts` directly via `--import ./typecraft-resolve.mjs` (maps the bare `typecraft` specifier to `src/lib/typecraft/index.ts`). No build step for the lib, no `dist/`.
- `DATABASE_URL` (Postgres, `.env`, gitignored — see `.env.example`) is required.

## Architecture

### The bot engine (`src/lib/steve/`)

- **Core loop** (`main.ts` / `lib/run-loop.ts`): every tick, `syncFromBot → getNextStep → execute`. The run-loop is a CSP-style go-loop parked on the world's physics tick — immutable `RunState`, a pure `reduce(rs, ev)`, epoch/generation counters that invalidate stale results after death, and a `failureBackoffTicks` so a failing step backs off instead of hot-spinning. 8 consecutive failures aborts to `exploreRandom`.
- **State model** (`types.ts` / `state.ts`): a pure immutable `GameState` (inventory + equipment + world + vitals). `syncFromBot(bot)` snapshots it; `getPhase(state)` derives the phase (STARTING → WOOD → STONE → IRON → NETHER_PREP → NETHER → STRONGHOLD → END → VICTORY).
- **Steps** (`steps.ts`): ~30 priority-ordered `Step`s (`canExecute` / `isComplete` / `execute`). `getNextStep` returns the first executable, incomplete step by priority. `completedSteps` is re-derived from `isComplete()` each tick, so a regression (items lost on death, a broken tool) auto-retries — **a step is only "done" when the world/inventory confirms it**. The `escape_water` step is priority 0 (a hard override that preempts everything until on dry land).
- **Tasks** (`tasks/<name>/`): the actual capabilities — `gather-wood`, `mining`, `craft`, `smelt`, `combat`, `food`, `bucket`, `nether`, `portal`, `stronghold`, `end` — each `main.ts` (+ `test.ts`), sharing `lib/bot-utils.ts`.
- **Bot memory**: a per-bot `WeakMap<Bot, BotMemory>` (`bot-utils.ts getMemory`) holds the crafting-table position, remembered ore/log sightings, the mine entry (for resurfacing), and water-trap XZs. Sightings come from typecraft's passive `blockSeen` events on chunk load — **no scanning, no X-ray** (`exposed:false` is banned).
- **Logging goes to Postgres, not console** — tables `events` / `ticks` / `inventory_snapshots`, written via `logEvent()`. Query with `docker exec <project>-db-1 psql -U root -d local -c "SELECT …"`. This is *the* debugging tool; `console.log` is for the vite startup banner only.

### typecraft — the vendored SDK (`src/lib/typecraft/`)

A from-scratch, functional-TS rewrite of mineflayer/prismarine as one typed package. `index.ts` is the single public surface: `createBot`, chunk/world read-write, NBT, the pathfinder (`createPathfinder`, `createGoal*`, `createMovements`), the protocol codec, RCON, recipes, and the Babylon viewer (`createWebViewer`). The bot is ~14 static `init*(bot, options)` functions (packet handlers + methods: `initGame`, `initPhysics`, `initInventory`, `initCrafting`, `initDigging`, `initPlacing`, …) instead of dynamic plugins. **Game data is generated, not vendored** (`data/` from datagen — don't hand-edit).

### The dashboard

- `src/lib/server/race.ts` — the data layer. Reads the bot's own tables with **raw tagged-template SQL** (Drizzle in `src/lib/server/db/schema.ts` is a vestigial scaffolder stub — don't use it for dashboard queries). `+page.server.ts load → getRaceData()`; the page polls `invalidateAll()` every ~5s.
- `src/routes/+page.svelte` — the Mission Control UI: top monologue log strip, left vitals rail, center 3D viewport, right speedrun ladder (done/active/todo with per-step timers + sub-tasks). Svelte 5 runes; live fields (position/health/inventory/step) merge over the DB snapshot from the SSE stream.
- `src/lib/BotWindow.svelte` + `static/web/viewer.js` (a committed ~12 MB Babylon bundle from `sync-viewer`) — the 3D first-person feed over an SSE stream from the in-process viewer. Its own chrome (header, hotbar, step) is CSS-hidden in the redesign so it renders as just the feed under the page's overlays.

## The nether portal — the current focus (`tasks/portal/`)

Obsidian is **cast, never mined** (no diamond pickaxe). `cast.ts` (`buildPortalByCasting`, `prepareCastSite`) + `enter.ts` (`enterPortal`) drive the `build_nether_portal` and `enter_nether` steps.

- **How a block is cast** (`castObsidianAt`): build a *fully-enclosed 1-block dirt cup* (4 sides + bottom solid, top open), pour a **lava** source in, then pour **water** into the block directly above → it flows down onto the lava → obsidian. The cup contains the lava so it never reaches the bot. A **safety gate** refuses to pour lava into a cup that isn't fully enclosed.
- **The frame**: a 4×5, 10-obsidian, no-corners frame anchored at the bot's feet in the X-Y plane (1 thick in Z), cast **bottom-up** so each block sits on the solid one below. Build order is deliberate (bottom row → left column bottom-up → right column → top) — **do not y-sort it** (that interleaves the columns and the bot leaps across the frame and stalls). `buildBacking` lays the wall behind, the bottom row is cast before `buildInnerFill` (the water bowl of a lower block occupies a cell the fill would take), then the gap is dug and lit with flint & steel.
- **Prerequisites** (checked at the top of `buildPortalByCasting`): a `lava_bucket`, a `water_bucket`, and **~30 dirt/cobble** for pillaring + molds. Buckets come from the `bucket` task (craft iron bucket → `fillBucket` walks *beside* a source, never on top of lava).
- **26.1.2 gotcha**: `bot.activateItem()` leaves `bot.usingHeldItem` stuck `true`, which silently blocks the *next* bucket use — `reliableUse()` deactivates and clears it every time. Any new bucket/right-click logic must go through it.

## Code style

Biome + functional TS: `const` arrow functions over `function`, early-return guard clauses, destructuring, nullish-coalescing + optional chaining, array methods over `for` loops, comment the *why* not the *what*. Svelte: 5 runes (`$state`/`$derived`/`$effect`/`$props`), tabs, single quotes. Conventional-commit prefixes (`feat`/`fix`/`refactor`/`chore`/`docs`). **Never add AI attribution anywhere. Never push without explicit approval.**

## Pitfalls / operational

- **The bot runs IN-PROCESS.** Server-side edits (`src/lib/steve/**`, `serve.ts`, `race.ts`, `bot.ts`) need a **vite restart**; `+page.svelte` hot-reloads; the viewer bundle needs `npm run sync-viewer`.
- **typecraft water physics** (`typecraft/physics/physics.ts`): **no buoyancy, `jump` is ignored in water** — the only lift is the wall-collision `outOfLiquidImpulse`. Escape by pressing forward into a bank (dig a notch if it's too tall), never by holding jump. This is why `escapeWater` is shaped the way it is; `water-harness.ts` reproduces it.
- **typecraft entity-metadata ordering is load-bearing**: the `entityMetadataType` index table must match the server registry order exactly — one off entry shifts every later type → stream desync → dropped connection. Insert at the right index in *both* the mapping table and the `entityMetadataEntry` switch.
- **Never auto-wipe/reset the world or restart the MC server.** The game box (`bridger@144.24.32.76` — SSH as `bridger`, not root; passwordless sudo; RCON localhost-only on 25575) is **shared with `ruststeve`** and both reset the same world — a wipe nukes the other project. Bridger does resets manually. MC 26.x uses **snake_case** gamerules (`keep_inventory`, not `keepInventory`); keep it **true** for long runs. When you *are* told to wipe: `sudo systemctl stop minecraft-server` → `sudo mv /var/lib/minecraft/world …` → start → re-set `keep_inventory` via mcrcon.
- **Postgres, not SQLite.** All bot telemetry is in Postgres (port 4623); the dashboard reads it. Don't add a Drizzle query for the dashboard — extend the raw SQL in `race.ts`.
