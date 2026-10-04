# Cycle 4 staged changes and analysis scripts

The patch scripts below are the Part 7 designs and fixes that were built during cycle 4 but not yet measured. Each edits the source in place from the repo root (`node scripts/cycle4/<file>.ts`) and throws if its anchor text is missing. They apply cleanly, in order, on the branch head this README was committed with, and the result loads. Apply one per batch, with the arena regression of 6 between, and compare with `scripts/ml/compare.ts` against the base3 baseline rows.

| Order | Script | What it changes | Evidence for it |
|---|---|---|---|
| 1 | `01-frame-origin.ts` | The frame origin is the stored site anchor whenever it is within 16 blocks; farther fails the attempt instead of starting a second frame at the bot. Logs `obsidian_lost` when a cell cast earlier is no longer obsidian. | The anchor cell is the frame's corner; once the left column is cast the bot cannot stand there, so late re-dispatches logged "no anchor (far)" and cast new frames (p0b-6, base3-2 lost a 9/10 frame). |
| 2 | `02-front-load-lava.ts` | §7.2: every lava refill fills every spare empty bucket (one kept empty while the water bucket is missing). | Doc §7.2. |
| 3 | `03-station-wire.ts` | §7.3: the lava refill goes to `tasks/portal/station.ts` first; the old `fillBucket` stays as a fallback until the station is measured, then its walk layers are deleted. Apply after 2. | Doc §7.3. |
| 4 | `04a-typecraft-exclusion.ts` | typecraft: `MovementsConfig.exclusionAreasStep` was declared but never applied; this makes it refuse steps. Default is empty, so behaviour is unchanged until `lava-move.ts` uses it. The callers of `lavaSafeMove` are not wired yet (anchor approach, station walk, mold stances, refill returns). | Doc §7.4. |
| 5 | `05-water-invariants.ts` | §7.5: `digDownVertical(..., seal)` seals water/lava beside the block under the feet with a placed block before digging it, and stops on head-in-water at eye height; the cast's descents pass `seal`. | Doc §7.5; cycle-3 drownings on the dig-down. |

Analysis and box tools:

- `report-data.ts <dir>` — every number in the cycle-4 report, from a copy of the box's `batches.db` and `attempts.jsonl`.
- `stall-recover.ts [stall_s]` — run in the box gym clone: no-progress time beyond `stall_s` in the cycle-3 natural runs (upper bound; progress = obsidian + phase).
- `rcon-cmd.ts <command>` — one RCON command against Server A: `node --env-file=.env --import ./typecraft-resolve.mjs scripts/cycle4/rcon-cmd.ts forceload query`.
