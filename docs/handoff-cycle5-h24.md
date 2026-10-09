# steve cycle 5 handoff — hour 24 (2026-10-04 01:35 → 2026-10-05 01:35 UTC, box time)

**No steve bot stood in the Nether this cycle.** The furthest any bot got was the hour-12 race: steve-race-810 reached a lava site at minute 35 and cast 5 obsidian, then crashed out on a viewer bug (fixed). The best natural screen, s5n (build C, 10c6372), reached a best-frame mean of 4.80 with 0.60 deaths per run, against base3's 3.60 and 2.00 at the same 1800 s cap. No screen met the confirmation trigger (a pass, or a best-frame median of at least 8), so there is no confirmation batch and no number to set beside base3's 0/10 [0%, 28%].

All numbers come from the box gym clone's `data/gym/batches.db`, `data/gym/attempts.jsonl` and `data/gym/telemetry.sqlite`, or from the server log where a line says so. Rates carry their Wilson 95% interval and n. Screening comparisons use `scripts/ml/compare.ts --means`, a bootstrap of the difference in means; the per-run metrics come from `src/lib/steve/ml/screen.ts`.

## 1. Headline

| Batch | Build | What | Result |
|---|---|---|---|
| base3 @1800 s | 552665d (cycle 4) | baseline | best frame median 4, mean 3.60; obsidian 4.30; deaths 2.00 (lava 1.80); n=10 |
| t60 | d544913 | tick-60 arena probe | 2/2 [34%, 100%], median 363 s wall vs 368 s at tick 20; tick 60 rejected |
| s1n | db8df55 | frame identity, natural | stopped after 3 runs (deterministic bugs, one mine) |
| s3n | 2026859 | A+B (lava safety, tunnel stand-off), natural | 0/6 [0%, 39%]; best frame 2.00; deaths 0.67 (P(better than base3) 0.998); best frame P(better) 0.043 |
| **s5n** | **10c6372** | **C (station + front-load + walk-layer deletion)** | **0/5 [0%, 43%] (+1 harness); best frame median 5, mean 4.80 (P(better than base3) 0.83); deaths 0.60 (P 1.000)** |
| s6n | f7a2dc6 / af476e3 | C + scoop-from-here | stopped after 5 (fill-walk flaw); best frame 3, 7, 1, 0, 1 |
| s7n | 8c253a6 | + fill-stance arrival, lava_already climb | 0/6 [0%, 39%]; best frame 1.50, deaths 2.50 — regression vs s5n (P(better) 0.003 / 0.012); both changes reverted |
| s8n | 0faf868 | s7n minus the two regressions, plus ghost-footing re-check and work-row lava cap | 0/6 [0%, 39%]; best frame median 6, mean 4.67 (P(better than base3) 0.75); deaths 0.67 (P 0.996); indistinguishable from s5n (P 0.48 / 0.42); block gap 149 s vs base3 96 s |
| race c5 | f945818 | 3 bots, 120 min | 0/3 Nether; one site with 5 obsidian at minute 35 |

Every arena regression this cycle passed 6/6 [61%, 100%] except s2a, which went 0/6 on a gate bug of mine and was fixed the same hour. The arena run time went from 373 s (s1a) through 377 s (s3a) and 419 s (s4a, station) to 394–429 s (s6a–s8a).

## 2. Funnel — the twelve skills

| # | Skill | Attempts | Pass rate | Median | Deaths | Source | Postcondition from truth |
|---|---|---|---|---|---|---|---|
| 1 | Wood and stone tools | race 3 bots | stone pick 3/3 [44%, 100%] | 13 min | — | race | no (bot rows) |
| 2 | Iron | race 3 bots | bucket 3/3 [44%, 100%] | 26 min | — | race | no |
| 3 | Kit craft (water, flint) | race 3 bots | water 3/3; flint and steel 1/3 [6%, 79%] | water 31 min | — | race | no |
| 4 | Lava site | race 3 bots; gym 43 natural runs | race 1/3 (min 35); gym dispatches reaching frame/obsidian in every screen | — | in 5 | race + gym | no |
| 5 | Portal cast and light | 43 natural screen runs, 1 race site | 0 natural passes; arena 36/36 [90%, 100%] across s1a/s3a–s8a | 1800 s cap | 0.6–2.5 per run by build | gym | yes: pass is the bot's own 10 obsidian plus RCON `execute … if dimension the_nether` |
| 6–11 | Fortress … crystals | 0 | 0/0 | — | — | — | no gyms |
| 12 | Dragon | 2 runs (d1, d2) | 0/2 [0%, 66%] | 62–128 s | 0 | gym | yes, RCON dragon check |

## 3. Throughput and harness

- **Tick rate 60: rejected.** typecraft's physics is a local 50 ms `setInterval`, and digging and walking are wall-clock paced. Wall seconds per arena run stayed at 363 vs 368, while game ticks per block tripled. Faster ticks also speed up lava and mobs relative to the bot.
- **Screening at 1800 s** (decision 3) and the gym escalation rule (4 identical failures end a run) cut natural runs to 361–1859 s. That is roughly 2 screens a day plus arenas. Escalated runs end early, so their best frame is a lower bound; comparisons against base3, which had no escalation, carry that confound.
- **Pass from truth** by RCON; **respawn kept within 32** of the landing.
- **Placement and pregeneration:** the race pregenerated ±256 blocks in 1986 s (16 slices of 64 chunks at about 2 min each on the 2-CPU box).

## 4. Bandit posteriors (live from s3n on; arena runs excluded by a params reset)

| Parameter | Arm: mean, trials |
|---|---|
| anchor_dy_max | 2: 0.29 n=193 · 3: 0.18 n=37 · 5: 0.17 n=16 — arm 2 leads and Thompson now picks it most |
| stall_s | 120: 0.24 n=39 · 180: 0.24 n=65 · 300: 0.28 n=142 — 300 slightly ahead, not separated |

The reward is "the attempt placed obsidian or finished", which is sparse. The arms differ by about 0.1 in mean on n in the hundreds for arm 2, so this is a tendency, not a separation.

## 5. Structural changes shipped (feat/portal-loop-5, 21 commits)

| Change | Evidence | Status |
|---|---|---|
| Phase 0 harness: screen metrics, compare `--means`, truth pass, gym escalation, respawn ≤ 32 | worked in every batch; escalation cut base2-style hot loops | shipped |
| Frame identity: origin from the stored anchor, no re-anchor within 16 of an own frame, no radius "frame present" | anchor_unreached and reanchor_prevented counters fire; no new frames at the bot | shipped |
| Spare pickaxe before each attempt | s1n-1 'Pickaxe worn out' ×4 → gone | shipped |
| Build A: lava_safe_move on the mold and anchor stances, pre-pour footing gate, ring sealing; pathfinder exclusion areas made to work | deaths 2.00 → 0.67 (s3n, P 0.998) | shipped |
| Build B: tunnel stand-off from the exposed pool | site_tunnel fires in every run | shipped |
| Build C: sealed refill station, front-loaded lava, fillBucket's walk layers deleted | best frame 4.80 vs 3.60 (s5n, P 0.83); deaths 0.60 (P 1.000); cast.ts 2596 → 2453 lines this cycle, portal module 3400 → 3345 | shipped |
| Station scoop-from-here, 1-above tolerance | arena faster (s6a ~397 s vs s5a ~451 s) | shipped, natural effect unclear (s6n confounded) |
| Fill-stance arrival beside the pool; lava_already climb | s7n regression | **reverted** |
| Ghost-footing re-check before the pour; work-row lava cap | from s7n death traces | in s8n |
| Race: region pregen, heightmap placement, RACE_BASE, viewer once per process, smelt the last raw iron, memory reset on teleport | race c5 diagnoses | shipped; the last three are untested in a race |

## 6. The race (race c5, 2026-10-04T12-11-10.420Z)

3 bots (steve-race-808, 809, 810), 120 min, tick 20, bandits live, region pregenerated, virgin forest at (-12448,-12160). The first launch landed on the clear-cut core (-3936,3968) and was stopped within 2 minutes, during pregeneration.

| Stage | Bots | Minutes (808, 809, 810) |
|---|---|---|
| stone pick | 3/3 | 32, 9, 13 |
| bucket | 3/3 | 49, 16, 26 |
| water | 3/3 | 75, 22, 31 |
| flint and steel | 1/3 | –, –, 31 |
| site anchor | 1/3 | 35 (810) |
| obsidian ≥ 1 | 1/3 | 35 (max 5) |
| portal lit / Nether | 0/3 | — |

Attempt-row deaths: 22 (11 lava, 11 without a cause). Tick time over 153 per-minute `tick query` samples (pregeneration included): mean 2.05 ms, worst p99 36.5 ms.

Why it lost:
- **810:** crashed 4× with EADDRINUSE on the web viewer after in-process reconnects and dropped out at 5667 s. Fixed: one viewer per process.
- **809:** deadlocked for 98 minutes ("no executable step" about 116k times) with 1 raw iron, 3 buckets and 0 ingots. Fixed: smelt_iron runs once the raw iron covers what the kit still needs.
- **808:** never left world spawn for 25 minutes: its heightmap tp silently failed because the landing chunk was unloaded after pregeneration, and its spawn height (y=85) passed the landing check. All 100 craft_sticks "No craft result" failures happened there. Fixed: forceload the landing, require the bot within 8 blocks, retry.
- **All bots:** remembered world-spawn resources about 17,400 blocks away (the race teleport). Fixed: memory resets on a jump of more than 500 blocks.

## 7. Late-game gyms

The dragon gym exists (`STEP=dragon`). First failure log, verbatim (d1): `d1-1 fail 128s obsidian=0 phase='dragon_perch' last='' dragon alive — out of beds after 0`. The server log shows `Gave 6 [White Bed] to Gym_dragon`, so the client inventory was reset by the cross-dimension tp. Fixed with a resync.

d2 log, verbatim: `dragon_start beds 6 obsidian 32 dim the_end` then `bed_place_fail foot 1,65,6 floor=end_stone` ×6. A probe with the End forceloaded found no bed anywhere near and the shield cell still air. No placement at all is accepted in the End: the bot is possibly position-desynced after the tp. Open; needs a probe session. Crystals, End entry, stronghold, blaze, fortress and pearls are not built.

## 8. Tick-rate experiment

| Rate | Runs | Passes | Median wall time | Game ticks per run |
|---|---|---|---|---|
| tick 60 (t60) | 2 | 2/2 [34%, 100%] | 363 s | ≈ 21,800 |
| tick 20 (cycle-4 b27) | 6 | 6/6 | 368 s | ≈ 7,360 |

**Rejected:** about 3× the game ticks per block at the same wall time; the bot is wall-clock bound.

## 9. Measurement integrity

- **Runs without a run-level row:** 3, all killed mid-run (s4n-1, s6n-6) or by design (the race).
- **Harness faults:** the SSH reset at about 19:50 left the box idle about 45 min (no measurement lost). d1/d2 Server A End placement is the open item.
- **Early stops, with their clause:**
  - s1n: deterministic bugs, cycle-5 rule.
  - s2a → the s2a gate bug of mine.
  - s4n: clause a plus a 22-min hang.
  - s6n: deterministic fill flaw.
  - The first race launch: wrong region.
- **Forceloads** were 0 after every batch.

## 10. Open problems, ranked by expected minutes saved per race

1. **Flint and steel upstream.** 2 of 3 race bots never got it in 120 min: one was the iron deadlock (fixed), one lost 30 min to the stick-craft loop and then never reached flint. Every race bot stalls here before the cast matters.
2. **Lava deaths at the pour on natural ground.** These are the ghost-footing and leaked-lava patterns; s8n measures the first fixes. Each death costs a frame resume plus minutes walking back.
3. **The station's reach on natural pools.** station_walk_fail and "not arrived" dominate the vetoes; per-block time 129 s vs 96 s at base3.
4. **The race teleport and the craft loop** (fixed, untested in a race): the race teleport silently failing, which also produced the craft_sticks loop.
5. **End placement** blocks the dragon gym entirely.
6. **Per-block time on natural ground** (s8n block gap 149 s vs 96 s at base3): three s8n runs reached 6–9 obsidian and ran out of time mid-mold. With deaths down to about 0.6 per run, speed is now what stands between a 6–8 frame and a pass. R2 (climb-order cast) and a faster station walk are the levers.

## 11. For the Rust agent

- **Client ghost blocks.** A placement the server rejects shows solid until the revert arrives, so gating a lava pour on the client's view of the footing kills the bot. Wait for the correction and re-check.
- **Safety gates against the wrong shape.** A "drop beside" check vetoes every pour from a one-wide pillar, and a lava-adjacent step exclusion makes a fill stance beside the pool unreachable. Exempt the target.
- **Teleports poison remembered positions.** Race bots act at world spawn before placement; reset memory on a large jump.
- **Iron accounting with 3 buckets.** A bot with 9 iron in buckets and 1 raw ore can deadlock if smelting needs 3 ore.
- **Web viewer port on reconnect** crashes the process if the reconnect builds a new bot in-process.
- **Tick rate does not buy wall time** for a wall-clock-paced bot.

## 12. Easier, harder, decisions

**Easier.**
- Continuous screening metrics and the per-fix counters made every regression visible within one batch. s7n's regression was read off two numbers.
- The escalation rule ended every hot loop within four dispatches.

**Harder.**
- n=5–6 screens with escalations are noisy. s6n vs s5n is not separable.
- Several of my fixes shipped deterministic flaws that only a natural run exposed (s2a gate, grass solidity, fill-stance unreachable, s7n arrival). Each cost a batch.

**What I would not do again.** I would not ship a new safety gate without an arena-plus-one-natural smoke run before the full screen. I would not bundle a "make it reachable" change with a safety layer whose value came from it being unreachable.

**Decisions needed.**
1. Whether to spend the next block on flint/upstream (race-limiting) or keep driving the natural cast (screen-limiting).
2. Whether an n=6 screen at 1800 s with escalation is the right instrument, or 10 runs at 1800 s with escalation off for the cast.

## State

- **Branch:** `feat/portal-loop-5` at the commit that adds this file, pushed; no PR (Bridger asks).
- **Box gym clone:** tracks the branch. `data/params.json` holds live arms for anchor_dy_max and stall_s; `.race-serial` is `{"next":811}`.
- **Server A:** tick 20, forceloads 0.
- **Next batch:**

```
GYM_TOTAL_S=1800 STEP=portal-natural RUNS=6 BATCH=<id> BOT=Gym_nat node --env-file=.env --import ./typecraft-resolve.mjs gym-batch.ts
```
