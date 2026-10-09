# steve cycle 7 — status at H8 (2026-10-09 ~12:05 UTC)

Every number below is from a fleet's batches.db / attempts.jsonl / server log in `data/runs/<run>/`, with n and a Wilson 95% interval. The running log with every decision is `docs/cycle7-results.md`.

## Headline

**Two race bots entered the Nether today, from cold starts, zero human input.** Both are confirmed by the server's "[We Need to Go Deeper]" advancement:

| race | bot | time | build | server line |
|---|---|---|---|---|
| c7 (f4, run 37890750601) | steve-race-005 | ~90 min | 303cc21 | 07:24:20 UTC |
| c8d (f11, run 37902083738) | steve-race-004 | ~220 min | f11 push (log fuel, lid, shuffle) | 11:39:30 UTC |

- Before today, no steve race bot had ever reached the Nether. Race c5 deadlocked all 3 bots on iron.
- Race Nether rate so far: **2/25 bots [2%, 25%]**. That is 1/5 in c7 and 1/20 across the four c8 races. Portal lit: 3/25.

## Champion

`champion.json` → 2e8a574 (f17 head). It beat the f4 champion 303cc21 on natural best frame: 3.17 vs 2.00, +1.17, 95% [0.35, 2.26], P(better) = 0.999, sign p = 0.022 (23 pairs). The noise floor between identical trees is P = 0.163.

The gain carries to new terrain. Landing set B (f21): best frame 5.18 vs 3.64, P = 0.847 (11 pairs).

## Promoted this cycle (paired, concurrent baselines)

| change | slug / set | result | P |
|---|---|---|---|
| craft window fix (b962291) | craft-stale-table | 12/12 vs 9/12 | 0.016 (base better) → fix |
| iron gather-wood-for-fuel (9d145cf) + log fuel | iron-deadlock | 10/12 [55%, 95%] vs 3/12 [9%, 53%] | 0.997 |
| cup lid dig | natural ×2 | best frame 3.23 vs 2.41 | 0.856 (kept, not worse) |
| shuffle lava stop (ed61b58) | natural ×2 | lava deaths 0.57 vs 1.13 | 0.986 |
| descend lava guard | natural ×2 | best frame 3.92 vs 3.25 | 0.803 (kept) |
| refill walkway | natural ×2 | best frame 2.88 vs 2.42 | 0.774 (kept) |
| pickaxe for lid/walkway/shuffle digs | natural ×2 | best frame 4.71 vs 3.52; lid digs 17/17 vs 3/21 | 0.954 |

Rejected or reverted:
- the pathfinder budget switch (P = 0.008 worse)
- the water ledge lift (slower on 10/12 landings, sign p = 0.039)

## What the data says the walls are now

1. **The last step: lighting and entering a complete frame.**
   - At the race budget (f20, 2700 s, 48 trials), 4 trials had a complete 10/10 frame and only 1 entered.
   - f20-nat-a-8 burned to death lighting from inside the fire cell. After respawning it abandoned the complete frame, finished a second one, and died walking to the pool to refill for a frame that needed no lava.
   - In race c8b a bot lit a portal and never entered: portalBuilt was proximity-only, and regressed iron steps took over.
   - Fixes:
     - 7332567: safe light; a complete frame skips the refill. Measured in f22 (set A) and f23 (set B).
     - 143f2b1: remember the lit portal; enter first. Measured by races f24.
2. **Natural pass rate is still low.** 1/48 [0.4%, 11%] at 2700 s on set A, and every natural Nether entry (9, f1–f20) is landing 5. Mean best frame went from 2.0 (303cc21) to 4.8. The failures upstream of the frame:
   - anchor in water / site out of range
   - find_lava deaths
   - the refill walk, which arrives ~45% of the time with the walkway and pickaxe
3. **Deaths.** About 2 per natural trial. Lava (mostly on refill walks), mobs at find_lava, drowning.
4. **Race early game.** About 2 of 5 bots per race stall before flint & steel. Two causes: gather_wood on treeless or underground starts (c8c), and bucket/water.

## Fleet

- 20 runners kept full since ~05:50 UTC.
- Fleets f4–f24 and races c7, c8a–d, c9a–d (running), c10a–d (queued, run 37927457031).
- Free runners only (ubuntu-24.04, public repo).
- Every push passed the .env scan.

## Harness faults found and fixed (these changed conclusions)

- **Water slug:** escape was called once and the dry check used the block under the bot's centre. The f5 "failures in both arms" were artifacts.
- **Paired compare:** it kept one replicate per landing. The f10/f12 pools had used half their trials; f12's headroom deaths were found worse only after the fix, then cleared in f13.
- **digAt never equips a tool:** the lid/walkway/shuffle digs failed while a bucket was in hand. The lid fix had been a no-op (3/21) until f18.

## Next (H8–H16)

- Read f22/f23 (safe light) and races c9 (f19) and c10 (f24). The question is whether lit and complete frames become entries.
- The complete-frame-abandoned case: after a far respawn, return to the frame instead of re-siting.
- Early-game race losses (treeless starts) once the portal funnel is measured.
- Status H16 at ~21:13 UTC; handoff report at H24.
