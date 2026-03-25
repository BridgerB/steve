# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project

Steve is an autonomous Minecraft bot that completes an Ender Dragon speedrun
(random seed, any%, glitchless) with zero human input. Built on `typecraft`
(custom Minecraft 1.21.11 protocol library) with TypeScript (ESM, strict mode,
Node 25).

**Current goal:** `iron_ingot` — the bot must gather wood, craft tools, mine
ore, and smelt iron.

## Commands

```bash
# Run bot race (requires nix — starts server, generates world, runs bots)
nix run . -- 20 600              # 20 bots, 10min timeout
nix run . -- 4 1800              # 4 bots, 30min timeout
nix run . -- 1 120               # 1 bot, 2min (quick test)

# Server only (for MCP or manual testing)
nix run .#server                 # Minecraft server only

# Run tests (against live Minecraft server)
nix run .#test                   # starts server + runs tests
nix run .#test -- pattern        # filter tests by name

# Type check
npm run build                    # tsc (no emit, type-checking only)

# Benchmark a single step (requires server running)
node src/bench.ts list           # list all step IDs
node src/bench.ts mine_stone 5 60

# Interactive REPL (requires server running)
node src/lib/repl.ts
echo 'return bot.entity.position' > /tmp/steve-cmd.txt
```

Environment variables: `MC_HOST`, `MC_PORT`, `MC_USERNAME`, `STEVE_BOT_MODE=1`
(child bot mode), `STEVE_TIMEOUT` (seconds).

## MCP Server

Steve has an MCP server (`src/mcp.ts`) that connects a bot to a running
Minecraft server and exposes tools for Claude Code to control it interactively.
This enables a fast feedback loop: run a function, check inventory, fix code,
repeat — seconds per iteration instead of minutes.

### Setup

```bash
# 1. Start MC server (separate terminal, stays running)
nix run .#server

# 2. Register MCP with Claude Code (one-time)
claude mcp add -s user steve -- node /mnt/developer-ssd/Developer/steve/src/mcp.ts

# 3. Start Claude Code — MCP connects automatically
claude
```

The MCP server retries connection for 60s, so start the MC server first.

### Tools

| Tool        | Purpose                                                       |
| ----------- | ------------------------------------------------------------- |
| `state`     | Full GameState: inventory counts, equipment, position, health |
| `inventory` | Slot-level item list with exact names and counts              |
| `look`      | Nearby blocks (radius), entities, dimension                   |
| `eval`      | Execute TypeScript with bot in scope (the power tool)         |
| `chat`      | Send chat message or `/command`                               |

### Eval imports

The eval file lives at `src/.mcp-eval.ts`, so **imports are relative to
`src/`**:

```ts
// Correct
const { gatherWood } = await import("./tasks/gather-wood/main.ts");
const { mineBlock } = await import("./tasks/mining/main.ts");
const { craftItem, goTo, findBlock } = await import("./lib/bot-utils.ts");

// Wrong — double src/
await import("./src/tasks/...");
```

### Agent workflow

See `AGENT.md` for the autonomous development agent guide. The agent uses MCP to
test individual functions, diagnose failures, modify code, and validate fixes
interactively. Changes are reviewed by the user before being committed upstream.

## Architecture

### Core loop

`main.ts` runs a tick loop every 5 seconds: sync state → pick next step →
execute it. Eight consecutive failures aborts. A generation counter invalidates
stale step results after death. In multi-bot mode, an orchestrator spawns N
child processes (each with `STEVE_BOT_MODE=1`) and tracks race results in
SQLite.

### State model (pure, immutable)

`types.ts` defines `GameState` = `Inventory` + `Equipment` + `WorldState` +
vitals. `state.ts` provides `syncFromBot(bot)` to snapshot the bot into a
`GameState`, and `getPhase(state)` to derive the current phase (STARTING → WOOD
→ STONE → IRON → NETHER_PREP → NETHER → STRONGHOLD → END_PREP → END → VICTORY).

### Steps system

`steps.ts` defines 30 priority-ordered `Step` objects. Each step has:

- `canExecute(state)` — precondition (materials, tools required)
- `isComplete(state)` — inventory-based success check
- `execute(bot, state)` — async task, returns `StepResult`
  (`{success, message}`)

`getNextStep(state, completedSteps)` returns the first executable, incomplete
step by priority. The `completedSteps` Set is synced from `isComplete()` every
tick — steps that regress (e.g. items lost) are automatically retried.

### Tasks

Each task lives in `src/tasks/<name>/` with `main.ts` (implementation) and
`test.ts` (integration test). Tasks use shared utilities from
`src/lib/bot-utils.ts`. All task functions take `(bot, ...)` and return
`StepResult`.

### Bot memory

A per-bot `WeakMap<Bot, BotMemory>` stores:

- **Crafting table position** — walk back if <50 blocks, recraft from planks if
  unreachable
- **Resource sightings** — ores/logs spotted via `blockSeen` events, queried by
  nearest + Y-filter (skip blocks >10Y away)

Passive memory: typecraft emits `blockSeen` for exposed blocks matching
`bot.watchBlocks` during chunk loading and block updates. Steve listens and
stores to memory. No scanning, zero CPU cost.

### Logging

`src/lib/logger.ts` writes to SQLite (WAL mode) with tables: `ticks`, `events`,
`inventory_snapshots`. All bots share one database file. Query with:

```bash
sqlite3 data/races/<run>/race.db "SELECT category, event, detail FROM events WHERE bot_id='Steve0' AND category='step' ORDER BY id"
```

### Testing

Tests use Node's built-in `--test` runner. `src/lib/test-utils.ts` provides
`runBotTest()` and `runMultiBotTest()` which connect to a live Minecraft server,
run setup commands via RCON, execute the test, and clean up.

### Key dependency

`typecraft` (local package at `../typecraft`) is a custom Minecraft protocol
library providing `Bot`, `Vec3`, `createBot`, `createWebViewer`, pathfinder,
crafting, digging, inventory management, and the `blockSeen` event system.

## Code Style

- **Const arrow functions** — `const foo = (x: number) => x * 2` not
  `function foo(x: number) { return x * 2; }`
- **Early returns** — guard clauses first, avoid deep nesting.
  `if (!bot) return;` not `if (bot) { ... }`
- **Implicit returns** — `const double = (n: number) => n * 2` when the body is
  a single expression
- **Destructuring** — `const { name, count } = item` and
  `({ x, y, z }: Vec3) =>` in parameters
- **Nullish coalescing + optional chaining** —
  `user?.profile?.name ?? "default"` not verbose null checks
- **Array methods over loops** — `.filter().map()` not `for` loops with `push`
- **Named predicates** — extract inline filter logic:
  `const isTarget = (name: string) => ...` then `.filter(isTarget)`
- **No obvious comments** — code should be self-documenting. Only comment the
  _why_, never the _what_
- **Spread over Object.assign** — `{ ...defaults, ...overrides }`
- **Template literals** — `` `pos=${x},${y}` `` not `"pos=" + x + "," + y`
- **Object shorthand** — `return { name, count, pos }` not
  `return { name: name, count: count, pos: pos }`
- **Ternary for simple conditionals** — `const status = isAlive ? "ok" : "dead"`
  not if/else assignment
- **Rest/spread for arrays** — `const [head, ...tail] = items` not `items[0]` +
  `items.slice(1)`
- **Computed property names** — `{ [key]: value }` not
  `const obj = {}; obj[key] = value`
- **Prefer `const`** — only use `let` when reassignment is necessary, never use
  `var`

## Commits

```
feat: short summary

- First change or detail
- Second change or detail
- Third change or detail
```

**Prefixes:** `feat`, `fix`, `refactor`, `chore`, `docs`

**No attribution.** Never add `Co-Authored-By` or similar.

## Design Principles

- **No X-ray mining** — the bot only knows about blocks it can see (exposed
  surfaces via `blockSeen`). Never use `exposed: false` in findBlocks.
- **Verify with inventory** — a step isn't done until `isComplete()` confirms
  items are actually in inventory. Blocks dug ≠ items collected.
- **All debug to SQLite** — use `logEvent()`, not console.log. Terminal shows
  only milestones.
- **Idempotent runs** — `nix run` generates a fresh world each time. No state
  leaks between runs.
- **No sleep for background tasks** — never use `sleep()` to wait for a
  background process. Use proper event-driven patterns.
- **No AI attribution in commits** — never add Co-Authored-By, "Generated with
  Claude", or any AI credit to commits, PRs, or public-facing content.
