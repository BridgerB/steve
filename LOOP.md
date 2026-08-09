# LOOP.md — race → debug → gym, one turning wheel

Persistent state + procedure for a self-driving loop toward `ticks.dimension = the_nether`
from a cold random spawn, zero human input. The model forgets between firings; this file
doesn't. **Read it top-to-bottom each iteration, do the phase you're on, then update the
Blocker board + Fixes log + Current phase before ending.**

## The cycle (this replaces the old "gym-first" loop)

One full turn is four phases. Each phase feeds the next; the whole thing repeats forever
until a bot reaches the nether.

```
   ┌────────────────────────────────────────────────────────────────┐
   │  1. RACE (2h)  →  2. DIAGNOSE  →  3. DEBUG+FIX (MCP)  →  4. GYM (1h)  ┐
   └──────────────────────────────────────────────────────────────────────┘
                                    ↑___________________________________________│
```

1. **RACE — run a real cold-start race for ~2 hours.** 4 bots, fresh world, no help.
   This is the ground truth: it exercises the *whole* 16-link chain under real terrain,
   contention, and server lag — things the gym can't fake. Let it run the full 2h (or
   until a bot reaches the nether = DONE). Check in every ~10 min only to keep it alive
   (relaunch dead procs, escape dead cells) — do NOT fix code mid-race.

2. **DIAGNOSE — after 2h, do a full post-mortem of the current state.** Find the
   **furthest bot** and the **exact wall it died/stalled on**: the step it looped, the
   inventory it had, the coords, the terrain, the packet/timeout it hit. Write it on the
   Blocker board. One race → one (maybe two) concrete blocker(s) to attack.

3. **DEBUG + FIX — reproduce that blocker with a live MCP bot and fix the code.** Spawn a
   debug bot via the MCP server INTO that spot with those conditions (same items, same
   block layout — use RCON to recreate it), then walk it through the *next* steps by hand
   with the MCP tools until you understand *why* it fails. If it's an interaction/protocol
   failure (a craft that times out, a bucket that won't scoop), **`sniff` the packets** to
   see what the server actually sends. Then fix the task/bot code so the next round gets
   past this wall. Update the code AS YOU GO.

4. **GYM — spend ~1 hour hammering the fixed hurdle(s) in isolation.** The gym grants a
   step its prereqs, random-teleports, and runs just that task (seconds-to-minutes per
   trial vs ~60 min per race). Run many fresh `gym-cli` trials on the step(s) you just
   fixed, confirm the fix holds across terrain/luck, and fix anything the gym surfaces
   that the single MCP repro missed. **Take those lessons back into the code.**

Then loop back to RACE with a better codebase. Every turn the chain should reach one link
further.

## Done criterion

```bash
# GOAL — any bot in the nether ends the loop:
docker exec steve-db-1 psql -U root -d local -tA -c \
  "SELECT DISTINCT bot_id,dimension FROM ticks WHERE dimension LIKE '%nether%';"
```

## The 16-link chain (skip food/sword/iron-pickaxe — not needed for the nether)

gather-wood → craft-planks → craft-table → craft-sticks → craft-wooden-pickaxe →
mine-cobblestone → craft-stone-pickaxe → craft-furnace → mine-coal → mine-iron →
smelt-iron → craft-buckets → **fill-water** → flint-and-steel → **build-nether-portal** →
**enter-nether**. `escape_water` (priority-0 override) is not a link but silently breaks
the mining/water links whenever the bot falls in water. **build-nether-portal + enter are
PROVEN in the gym given a filled water_bucket + lava** — the fight is getting the kit there.

---

## PHASE 1 — RACE (run + keep alive)

- **Launch** (spread across fresh terrain via `.race-serial`; DIRECT connect, not tunnel):
  ```bash
  STEVE_CLI=1 nohup node --import ./typecraft-resolve.mjs src/lib/steve/main.ts \
    --bots 4 --timeout 7200 > $SCR/raceN.log 2>&1 &
  ```
- **Cell quality matters more than anything.** After launch, check spawn `y` + `is_in_water`.
  The world has a real spread of terrain and the loop lives or dies on it:
  - **Ocean / mostly-water cells** (all bots at y~62, `is_in_water=1`) → dead, bots drown.
    Bump `.race-serial` (`echo '{"next":N}' > .race-serial`) to a different cell.
  - **Too-dry elevated cells** (forest hilltops) → bots reach iron but can't reach trees
    for smelt-fuel and there's no surface water to fill a bucket.
  - **MIXED cells** (some bots dry, a pond/lake nearby) → the sweet spot: dry land to
    progress + scoopable water for the bucket. Prefer these.
- **Keep alive** on the ~10-min checks: 0 bots ticking → relaunch (below); RCON dead →
  fix tunnel; server "Preparing spawn area" → wait, NEVER restart the shared server.
- **NEVER** wipe/reset the shared world or restart the MC server — the box is shared with
  ruststeve and Bridger resets it manually. `keep_inventory` is snake_case and must stay
  true (verify via `gamerule keep_inventory`).
- Relaunch after a dead cell / stall: `pkill -f 'src/lib/steve/main.ts'` first (bots
  auto-reconnect and collide otherwise), then relaunch with the next serials.

## PHASE 2 — DIAGNOSE (post-mortem)

Find the furthest bot and its wall. Telemetry is Postgres (`steve-db-1`, port 4623; `ts`
is TEXT → cast `ts::timestamptz`):
```bash
# furthest bot by kit (which links it cleared):
docker exec steve-db-1 psql -U root -d local -tA -c "SELECT bot_id,
  max(CASE WHEN item_name='iron_ingot' THEN count END) ii,
  max(CASE WHEN item_name='raw_iron' THEN count END) ri,
  bool_or(item_name='water_bucket') wb, bool_or(item_name IN ('bucket','lava_bucket')) buck,
  bool_or(item_name='obsidian') obs
  FROM inventory_snapshots WHERE bot_id LIKE 'steve-race-%'
  AND ts::timestamptz>now()-interval '2 hours' GROUP BY bot_id
  ORDER BY obs DESC,wb DESC,buck DESC,ii DESC NULLS LAST;"
# what that bot looped on (its wall):
docker exec steve-db-1 psql -U root -d local -tA -c "SELECT category,event,detail
  FROM events WHERE bot_id='<furthest>' AND ts::timestamptz>now()-interval '20 minutes'
  ORDER BY ts DESC LIMIT 40;"
```
Write the wall on the Blocker board: **step + inventory + coords + terrain + failure mode**.

## PHASE 3 — DEBUG + FIX (MCP repro + code fix)

Spawn a live debug bot via the MCP server and reproduce the wall. **`src/lib/steve/mcp.ts`**
exposes tools to Claude Code: `spawn`/`use` (a bot), `state`, `inventory`, `look`,
`navigate`, `mine`, `craft`, `eval` (run TS against the live bot; imports relative to
`src/` — `await import("./tasks/...")`, never `./src/...`), `chat`, and **`sniff`**.
- **`sniff {duration, action, filter}`** captures incoming packets during an action (runs
  the `action` TS while listening), filtering movement/chunk noise (`NOISE_PACKETS`). Use
  it to see what the server actually returns for a failing interaction. Examples of what to
  look for on the two current walls:
  - **craft clickWindow** (`Failed to craft crafting_table`/`Promise timed out`/`table_missing`):
    `sniff` with `filter:"container"` or `"slot"` while running a craft — watch whether
    `container_set_slot`/`container_set_content`/`container_ack` come back for the clicks,
    or whether the 30s `withTimeout` (typecraft `bot/crafting.ts:294`) trips because
    `windowOpen`/slot-updates never arrive under server lag.
  - **water-scoop** (`scoop_blacklist`, never a `filled water_bucket`): `sniff` while using
    the bucket on water — confirm the bot is aiming a SOURCE block (level 0) not flowing,
    and whether a `set_slot`/`block_update`(water→air) comes back. (Fix already landed:
    `pickWater` now source-filters, mirroring the cast's `isSource`.)
- If you can't reach the exact repro terrain, RCON-build it: `fill`/`setblock` the block
  layout, `give` the inventory, `tp` the bot in. Then step through with the MCP tools.
- **Fix the task/bot code** (`tasks/*/main.ts`, `bot-utils.ts`, `steps.ts`,
  `tasks/portal/cast.ts`, or typecraft `bot/crafting.ts` for protocol) so the wall is gone.
  Server-side edits need a fresh process to reload (the bot runs in-process). Log it.

## PHASE 4 — GYM (isolate + confirm the fix, harvest more lessons)

Run many fresh trials on the step(s) you just fixed; fresh-process-per-trial is robust vs
the disconnects a long-lived bot hits:
```bash
for i in $(seq 1 12); do STEP=<slug> BOT=g<slug>$i \
  node --env-file=.env --import ./typecraft-resolve.mjs gym-cli.ts 2>&1 | grep GYMRESULT; done
```
- Records to `data/gym.db` (node:sqlite, table `gym_runs`: ts,slug,pass,duration_ms,x,y,z,
  prereq,message). Pull the dominant failure + repro coords:
  ```bash
  sqlite3 data/gym.db "SELECT message,count(*) c,group_concat(x||','||y||','||z) FROM gym_runs
    WHERE slug='<slug>' AND ts>$START AND pass=0 GROUP BY message ORDER BY c DESC LIMIT 8;"
  ```
- Separate **winnable** failures (a real bug to fix) from **biome-unwinnable** spawns
  (ocean/desert — don't count them). Live view: `npm run dev` → `http://localhost:4558/gym/<slug>`.
- Every gym lesson that isn't already covered → back into the code. Then return to PHASE 1.
- The gym covers the whole path incl. `build-nether-portal` (order 18, full autonomous) and
  `enter-nether` (order 19) via the `setup?(bot,rcon,at)` hook in `gym/registry.ts`.
- `water-harness.ts` reproduces the `escapeWater` aquifer/pocket case deterministically.

---

## Blocker board (the wall the wheel is currently on — UPDATE EACH TURN)

**Furthest reach ever:** race53/751 — **10 iron_ingot + empty bucket, standing at water,
at the fill-water step.** The closest any bot has come to the nether.

**Current wall — water-scoop reliability (fill-water).** Two leaders (race52/745,
race53/751) both reached water with a bucket but the scoop failed and blacklisted the
source, never producing a `water_bucket`. Root cause found: `pickWater` handed the scoop
FLOWING water (unscoopable); **fixed** — it now source-filters (level 0) like the lava
cast. Needs a race to confirm a bot now lands the first-ever `filled water_bucket`.

**Wall #2 — craft reliability is LAG-INDUCED, not a code bug (sniff-confirmed).**
`craft-sniff.ts` ran the crafting_table craft on a QUIET flat platform: **4/4 success**,
`container_set_slot` acks return cleanly, ~2.5s per craft. So the code is correct — the
race failures (`Failed to craft crafting_table` / `Promise timed out` / `table_missing`)
come from the small Oracle box's window-sync **lag under load** (4 bots + mining + terrain):
`bot.craft` does N sequential `clickWindow` round-trips (place each ingredient, await ack)
+ a 2s result-wait + a 30s `withTimeout` (typecraft `bot/crafting.ts`); when acks are
delayed enough, an attempt trips a timeout, both craftItem retries burn, and the step/loop
gives up. NOT ruststeve contention (high fail rate with 0 other bots). **Fix direction (do
next):** cut the round-trips — send all placement clicks then verify once (a `bot.craft`
rewrite), or make craftItem far more retry-tolerant (more attempts + longer settle), since
the craft DOES succeed once the server catches up. (The `section_blocks_update` "BigInt"
flood seen while sniffing was a false alarm — the sniff tool's own `JSON.stringify`, now
fixed BigInt-safe; real bots don't hit it.)

**Other recurring walls:** smelt-interrupt (a death at mining depth strands iron IN the
furnace — keep_inventory doesn't protect furnace contents); wood-reachability in dry cells
(gather-wood times out fetching smelt-fuel); water-traps / aquifers (`escapeWater` fails
on enclosed pockets); ocean/too-dry/too-wet cell luck.

## Fixes log (newest first)

- **sniff tool BigInt-safe** — `mcp.ts` `sniff` (and `craft-sniff.ts`) now stringify
  BigInt packet fields as strings; the plain `JSON.stringify` threw on block-change/varlong
  packets and the client swallowed it, silently dropping those packets from captures.
- **craft-sniff.ts (new debug tool)** — spawns a bot on a quiet platform, gives it planks
  via RCON, and sniffs the `container_set_slot` packet flow around a crafting_table craft.
  Proved crafts are correct (4/4 quiet) → race craft failures are lag-induced.
- **water-scoop source-filter** — `tasks/bucket/main.ts` `pickWater` now prefers SOURCE
  water (level 0, `bot.blockAt(p).properties.level` missing/"0") over flowing; flowing
  water is unscoopable and was silently failing every attempt (race52/745, race53/751).
- **gather-wood blacklist-recovery** — `tasks/gather-wood/main.ts`: after an explore-relocate,
  clear the `unreachable` tree set so distant trees are re-tried from the new position
  (bots blacklisted every tree at dist ~52 and starved).
- **gather-wood-resurface (REVERTED)** — resurface-when-tree-is-above broke the early game
  (bots stalled at ~16 cobble in a craft/gather loop); reverted. The deep-mine wood problem
  is rarer than the regression it caused.
- **wood-reserve** — `steps.ts` `gather_wood.isComplete` keeps a wood reserve
  (`hasCraftingTable || logs>=1 || planks>=4`); after smelting burns the planks a bot with
  coal but 0 wood could never craft the buckets' table (deadlocked "Need crafting table").
- **water-scoop blacklist-recovery** — `tasks/bucket/main.ts`: when all found water is
  blacklisted + none fresh, clear the blacklist + retry (was a permanent "no water" loop).
- **smelt/craft resilience (earlier)** — craftPlanks Promise.race timeout + reclaimCraftingGrid;
  smelt with wood fuel; longer gather_wood/craft-window timeouts; race terrain-spread.

## Current phase

RACE (race54, bots steve-race-753..756, launched ~10:34 local 2026-08-07, mixed cell, carries
the water-scoop source-filter fix). When this race's 2h is up (or a bot stalls hard), go to
PHASE 2 DIAGNOSE, then PHASE 3 sniff-debug the craft/clickWindow wall (wall #2), then PHASE 4 gym.

## Env / operational quick-ref

- MC game DIRECT `144.24.32.76:25565` (bots connect direct; `.env` MC_HOST/PORT). RCON via
  SSH tunnel `127.0.0.1:25575` → box 25575, pass `minecraft-test-rcon`
  (`ssh -fN -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -L 25575:127.0.0.1:25575 bridger@144.24.32.76`).
- Postgres telemetry `steve-db-1` (Docker, port 4623): `ticks`, `events`, `inventory_snapshots`.
  `ts` is TEXT — cast `ts::timestamptz`. inventory_snapshots is per-slot (item_name,count).
- **Never** commit AI attribution; never push; never restart the shared MC server / wipe the world.
