# LOOP.md — perfect the gym, then chain to the Nether

Persistent state + procedure for a self-driving loop. The model forgets between
firings; this file doesn't. Read it top-to-bottom each iteration, do the work, then
**update the Reliability table + Fixes log + Current focus** before ending.

## Why this loop (the reframe)

Full raw-spawn races don't converge — a ~16-link chain stalls at a different random
hazard every time and each stall wastes ~60 min on reset. Instead: **perfect each
speedrun step in ISOLATION via the gym** (each gym run grants the step's prereqs,
random-teleports, runs just that task — seconds-to-minutes per trial), until every
critical-path piece clears the bar. Then chain them in a full race: if each link works
independently, the chain reaches the Nether.

## Goal & done criterion

Every **critical-path** gym step passes **≥50% on WINNABLE terrain** (exclude
biome-unwinnable spawns — ocean/desert with no trees, etc. — via the stored x,z), THEN
a full chain race reaches `ticks.dimension = the_nether`.
```bash
# per-step reliability (winnable rate = judgment on the failure spots' x,z):
sqlite3 data/gym.db "SELECT slug,count(*) n,sum(pass) p,round(100.0*sum(pass)/count(*)) pct FROM gym_runs WHERE ts>$START GROUP BY slug;"
# chain done:
docker exec steve-db-1 psql -U root -d local -t -A -c "SELECT DISTINCT dimension FROM ticks WHERE race_id='<RID>'"  # → the_nether
```

## Critical path = 16 links (skip food/sword/iron-pickaxe — not needed for the Nether)

gather-wood → craft-planks → craft-table → craft-sticks → craft-wooden-pickaxe →
mine-cobblestone → craft-stone-pickaxe → craft-furnace → mine-coal → mine-iron →
smelt-iron → craft-buckets → fill-water → flint-and-steel → **build-nether-portal** →
**enter-nether**. `escape_water` (priority-0 override) is not a link but silently breaks
the mining/water links whenever the bot falls in water.

## Iteration procedure

1. **Ensure env**: MC server on `144.24.32.76:25565` (`.env` has MC_HOST/PORT). RCON
   tunnel `127.0.0.1:25575` (`ssh -fN -L 25575:127.0.0.1:25575 bridger@144.24.32.76`,
   pass `minecraft-test-rcon`). Postgres `steve-db-1` (4623) for chain races only.
   **Check box load** first: RCON `list` — if many `rust-*` bots are on, contention
   makes craft/place flaky; prefer running trials when the box is light, keep concurrent
   bots low.
2. **Pick the target**: the lowest-reliability critical-path step below 50% (see
   Reliability table). Ties → hardest-first order: build-nether-portal, mine-iron,
   mine-coal, mine-cobblestone, fill-water, smelt-iron, flint-and-steel, enter-nether.
3. **Run N fresh trials** (fresh process per trial — robust vs the disconnects a single
   long-lived bot hits):
   ```bash
   for i in $(seq 1 12); do STEP=<slug> BOT=g<slug><i> node --env-file=.env --import ./typecraft-resolve.mjs gym-cli.ts 2>&1 | grep GYMRESULT; done
   ```
   (or loop `subset-test.ts`-style). Records to `data/gym.db` automatically.
4. **Diagnose**: pull the dominant failure + repro coords —
   `sqlite3 data/gym.db "SELECT message,count(*) c,group_concat(x||','||y||','||z) FROM gym_runs WHERE slug='<slug>' AND ts>$START AND pass=0 GROUP BY message ORDER BY c DESC LIMIT 8;"`
   Separate **winnable** failures (a real bug) from **biome-unwinnable** spawns (ocean/
   desert — don't count against the bar). For placement/portal, also watch a live view
   at `http://localhost:4558/gym/<slug>` (needs `npm run dev`).
5. **Fix the real blocker** in the task code (`tasks/*/main.ts`, `bot-utils.ts`,
   `steps.ts`, `tasks/portal/cast.ts`), **re-run the same N trials**, confirm winnable
   pass% crossed 50%. Server-side edits need a fresh gym-cli process (each trial is one),
   so no restart dance — just re-run.
6. **Log** in Fixes log + bump the Reliability table. If a step resists ~3 distinct
   fixes, surface it — don't spin.
7. When **all 16 links ≥50%**, run a **chain race** (`STEVE_CLI=1 node … src/lib/steve/main.ts --bots 4 --timeout 7200`) and check `ticks.dimension`. If it stalls despite reliable links, the residual is the **gym→race gap** (inter-step state, resource accounting, cumulative contention, deforestation) — diagnose from the race DB and fix.

## Tools

- **`gym-cli.ts`** — one gym trial per process: `STEP=<slug> BOT=<uniq> node --env-file=.env --import ./typecraft-resolve.mjs gym-cli.ts`. Prints `GYMRESULT {json}`; records to `data/gym.db`.
- **`data/gym.db`** (node:sqlite, table `gym_runs`: ts,slug,pass,duration_ms,x,y,z,prereq,message) — the reliability + failure-mode + reproduction store.
- **`/gym` dashboard** (`npm run dev` → `http://localhost:4558/gym`) — pass-rate/spread/difficulty/location charts, per-step history at `/gym/<slug>`, live 3D at `/gym/all`.
- **`water-harness.ts`** — deterministic `escapeWater` repro (modes tunnel/deep/pocket/lakeedge) for the aquifer/enclosed-pocket case.
- **RCON** for ad-hoc probes (`locate biome`, `data get block`, `fill … replace …` to count blocks) — read the box before assuming terrain.

## The gym now covers the whole path (Phase 0 — done)

`GymStep` has an optional `setup?(bot, rcon, at)` hook (`gym/registry.ts`), invoked by
`runGymStep` after teleport, before `run` (`gym/run.ts`). Two new exercises:
- **build-nether-portal** (order 18) — FULL autonomous: prereq `water_bucket 1 + bucket 1 + flint_and_steel 1 + dirt 32`; `run` = `prepareCastSite` then `buildPortalByCasting`; `pass` = a `nether_portal` block within 16; `timeoutMs 420000` (lava-find-dominated).
- **enter-nether** (order 19) — `setup` RCON-builds+lights a portal 4 blocks ahead; `run` = `enterPortal`; `pass` = `game.dimension` includes `nether`.

## Portal cast — where the risk is (from the deep-dive)

The cast splits in two:
- **`prepareCastSite` (find/reach lava) = the fragile crux, likely never fully
  succeeded.** No X-ray, so it needs natural lava line-of-sight within 30 OR mines down
  to cave lava within 8 passes / 6 min, AND `fillBucket` needs solid air-topped footing
  beside the source. Same capability class as mine-iron descend-and-find. Improve this
  first for build-nether-portal.
- **`castObsidianAt` + frame = deterministic given a lava source**, but physics-timing
  fragile: pillar-stalls, float-off, cup/bowl mis-placement; each gate bail (`cup_leak`,
  `bowl_leak`, `pos_fail`) burns 1 of 3 attempts; a block that drifts twice fails the
  whole frame.
- Pre-checks: frame is 4×5 OUTER, **corners optional (10 edge blocks)**; **clear all
  scaffold from the 2×3 interior before lighting**; **never dig obsidian** (iron pick
  can't, `digAt` hangs); do NOT y-sort the frame build order.
- **26.1.2 gotcha**: `activateItem()` leaves `usingHeldItem` stuck true → next bucket use
  silently no-ops. All bucket use goes through `reliableUse()` (`cast.ts`).

## Reliability table (target ≥50% winnable — UPDATE each iteration)

Rates below are STALE (pre/post-fix mixed in gym.db) — **re-baseline in Phase 1** with
fresh trials before trusting them.

| step | last winnable pass% | status |
|---|---|---|
| gather-wood | ~65% (stale) | re-baseline |
| craft-planks / table / sticks / w-pickaxe | ~40-68% (stale) | re-baseline |
| mine-cobblestone | ~19% (stale) | WEAK — flat-terrain stone dig-down |
| craft-stone-pickaxe / furnace | ~47-49% (stale) | re-baseline |
| mine-coal | ~5% (stale) | WEAK — ore-finding |
| mine-iron | ~2% (stale) | WEAK — over-descend into lava/aquifer |
| smelt-iron | ~27%→73% post-fix | re-baseline |
| craft-buckets | ~52% (stale) | re-baseline |
| fill-water | ~26% (stale) | WEAK |
| flint-and-steel | ~11%→50% post-fix | re-baseline |
| build-nether-portal | UNTESTED (new) | perfect (lava-find first) |
| enter-nether | UNTESTED (new) | perfect (should be easy) |

## Fixes log (append-only; never re-fix)

Session 1 (raw-race loop, all committed in c21109f): fixed the race orchestrator
`--bots` spawn, smelt window-desync, gather-wood nav loop, iron-economy (defer iron
pickaxe), craft-timeout contention, table walk-back, deforestation (pristine-forest
spawn), plank-threshold deadlock, table-on-leaves placement, bucket-iron counting,
craft output-strand verification, place-relocate-retry. Plus the 5-step lab winners
(smelt, mining, gather-flint, food). Learned: contention on the shared 4-core box makes
craft/place packets flaky (place fails 41→0 when the box is light); the hazard tail is
deep (water/aquifer/slow-iron); parallelism helps only at low load.

- **Phase 0 — extended the gym to the full path** (`gym/registry.ts`, `gym/run.ts`):
  added `setup?` hook + `build-nether-portal` (autonomous) + `enter-nether` (scaffolded,
  RCON builds obsidian frame + `setblock fire` to form a real portal). 19 steps load.
- **DIMENSION DETECTION FIX** (`typecraft/bot/game.ts`) — surfaced by the enter-nether
  smoke test: on this protocol-774 build the nether's dimension arrives as the integer
  REGISTRY INDEX `3`, and typecraft stored it as `String(3)="3"`, so `getPhase` /
  `enter.ts` / the **`enter_nether` goal** never recognized the nether even after
  walking through a portal. Fix: keep the registry `entry.key` in `dimensionTypes[]` and
  resolve a numeric dimension → name via that registry. **VERIFIED: enter-nether now
  PASSES — "Entered portal - now in the_nether".** (A race never reached the portal, so
  this bug was invisible until the gym isolated the step.)
- **build-nether-portal smoke test**: ran the full autonomous cast; `FAIL 362s — No lava
  pool found to cast at`. Confirms lava-finding (`prepareCastSite`) is the dominant
  blocker (Phase 2 #1) — as predicted; the deterministic cast mechanic is downstream.

- **Phase 1 re-baseline (ZERO contention) — verdict**: the CRAFT/water/smelt steps are
  already solid (craft-buckets 100%, fill-water 75%, smelt 75%); their old low rates
  were pure contention. The weak links are ALL resource-finding: mine-iron 0%, mine-coal
  25%, mine-cobblestone 11%, flint 25%, build-portal 0% (lava). So Phase 2 = perfect the
  underground-find capability.
- **Gym-fidelity fix** (`gym/run.ts`): run `escapeWater` before the step (mimics the
  race's priority-0 override), so a spawn-in-water no longer falsely tanks resource
  steps. (Doesn't cover MID-mining aquifer hits, which still show "yielding to
  escape_water" — those are ~gym artifacts; a race's escape_water handles them.)
- **mine-cobblestone collection fix** (`tasks/mining/main.ts`): the SURFACE path counted
  blocks DUG, not the drop COLLECTED, so it "succeeded" at 16 dug while cobble rolled
  away (0%). Now loops until `invCount(dropItem) >= target` (added `stone→cobblestone`
  to DROP_ITEM), 3x dig cap. **Result: ~2/3 on winnable (non-water) terrain.**
- **mine-iron coverage fix** (`branchMineOre`): at the y24 band the branch-mine bailed
  after ~4 blocks (`dug=4/0`) when boxed by the band's water/lava/caves, then paid a
  costly climb-out+relocate → never exposed ore. Now `digDownOne()` drops a level and
  keeps strip-mining down through the band (floor `max(8, level-16)`). **Result: 0% →
  50% (3/6).** Shared with mine-coal (same `branchMineOre`) — verifying.

## Current focus

mine-iron ✅50% and mine-cobblestone ✅~50%(winnable). Verifying mine-coal (should ride
the same coverage fix). Remaining weak: **mine-coal**, **flint (25%, gravel-find)**,
**build-portal (0%, lava-find)**, and the shared **descent-reliability** issue —
mine-iron's remaining fails are `dug=0` at y62-63 (digDownVertical stuck at the water
table, never reaching the band); fixing that lifts iron higher AND coal AND portal-lava.
Then re-confirm the ≥50% set and run a Phase 3 chain race → the_nether.
