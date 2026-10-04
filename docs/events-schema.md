# Attempt event log schema

One JSON object per line in `data/gym/attempts.jsonl` (env `STEVE_ATTEMPTS_FILE`), append-only, mirrored into the sqlite table `attempts` in the telemetry file (`STEVE_D1_FILE`). Written by `src/lib/steve/lib/attempts.ts` `writeAttempt`; never throws into the bot. Both bots (ts, rust) write this schema.

## Writers

| Writer | skill | run_id | One row per |
|---|---|---|---|
| `lib/run-loop.ts` executor | the step id | `<raceId>-<step>-<start_ms>` | step dispatch (race, or gym when `GYM_RUN_ID` is set) |
| `tasks/portal/attempt.ts` `castAttempt` | `portal_cast` | `<raceId>-d<n>` | guarded cast attempt (race step, arena gym, each natural-gym dispatch) |
| `gym-batch.ts` | `portal_cast` for portal slugs, else the slug | `<batch>-<run>` (the gym run id) | gym run |

`scripts/ml/compare.ts` reads only the gym run-level rows (no `-dN` suffix, `context.harness` false).

## Fields

| Field | Type | Meaning |
|---|---|---|
| `run_id` | string | see the table above |
| `bot_impl` | `"ts"` | which bot wrote it |
| `build` | string | short commit of the checkout that ran |
| `world_seed` | string \| null | server seed, read via RCON by the gym harness (grading/pairing only, never a feature) |
| `skill` | string | the skill contract the attempt counts toward |
| `step_id` | string | the step / gym slug |
| `source` | `"gym"` \| `"race"` | |
| `bot` | string | username |
| `start_ms` | number | epoch ms at attempt start |
| `duration_s` | number | wall seconds |
| `outcome` | `ok` \| `timeout` \| `death` \| `failed` \| `vetoed` | `timeout` covers budget, stall and preempt cuts |
| `reason` | string | the step's message (or the guard's cut reason) |
| `death_cause` | string \| null | server death line when known |
| `pos` | [x,y,z] \| null | bot block position at the end (gym run rows: the landing) |
| `deepest_phase` | string | last cast sub-phase reached (`find_lava` … `verify`, `light`, `enter`) |
| `progress` | number | obsidian placed by the bot in this attempt |
| `params` | object | the bandit draw used (`ml/bandit.ts`); `{}` when none |
| `context` | object | features at attempt start, below |

## Context features and how each is sensed

Only what the bot legitimately sensed. The harness may grade outcomes with RCON truth; features may not use unexposed world data.

| Feature | Sensed from |
|---|---|
| `y` | own position (entity packet) |
| `health`, `food`, `air` | own status packets |
| `time_of_day` | the server time packet every client receives |
| `in_water` | own physics state |
| `cobble`, `buckets`, `lava_buckets`, `water_buckets` | own inventory |
| `lava_cells_8`, `water_cells_8` | `findBlocks` within 8 blocks with the default line-of-sight check (exposed blocks only) |
| `hostiles_seen` | hostile entities within 16 blocks from entity spawn packets (what any client renders) |
| `ground_unevenness` | spread of the top solid block over the 5×5 around the bot, within 4 blocks below and 3 above — blocks next to the bot |

Gym run rows add harness metrics to `context` (not features): `time_to_portal_s`, `dispatches`, `deaths`, `forceloads`, `mem_avail_mb`, `tick_ms`, `harness` (true when the loss was harness/disconnect, excluded from rates).
