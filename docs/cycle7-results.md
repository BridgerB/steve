# Cycle 7 measured results (running log)

Every row comes from a fleet's batches.db / attempts.jsonl / trials.jsonl (downloaded to data/runs/<run>/), with its Wilson 95% interval and n. Paired = same landing set, same landing index, arms in the same fleet.

## Capacity (cap1, run 37887151110, 252 arena trials, landing set A)
Bots sharing a server do not hurt each other: pass 10–11/12 at 8 bots against 11/12 at 1 bot, median time 385–389 s against 380 s. 8 bots per runner: 65–66 trials per runner-hour against 9.5–10.3 for one bot (~7×); typical tick p99 15–22 ms, machine CPU p95 14–34%. 12 bots: 83–94 trials/runner-hour but typical tick p99 45–49 ms, CPU p95 81–84%. Decision: 8 per server, 6 GB (ci/capacity.json); natural trials 6 per server until checked. Full table: data/runs/37887151110/capacity-report.md.

## First natural-terrain portal (f1, run 37885057543)
f1-nat-b-5, landing 5 of set A: own frame at 18551,63,20685, 10 obsidian cast 04:45:55–04:50:56 UTC, lit 04:52:47, entered the Nether at 604 s (server dimension check). Natural on that tree: 1/5 [4%, 62%] before the fleet was cancelled.

## Water: ledge-lift port fix (fa76014), f5 run 37892960524, lake-shore set W, 12 paired
- Ledge fix 10/12 = 83% [55%, 95%]; baseline (exp/ledge-base) 9/12 = 75% [47%, 91%]. Paired: better on 1 landing, worse on 0; P(better) 0.82, not separated.
- Escape time where both escaped: within ~1 s on most landings; the fix rescued one landing (base never, fix 18 s) and cut one from 68 s to 40 s; one went 7 s → 17 s.
- Decision: keep (faithful port of vanilla physics, not worse). Set W is mostly flush banks (8 of 11 locally), which the old physics also escapes.
- Open: 2 landings (20734,20094 and 18784,24640) fail in both arms with "still in water" after 8–15 s: escapeWater gives up long before its 120 s budget.

## f4 gym, run 37890750601 (report: data/runs/37890750601/report.md), landing set A, 12 paired unless noted
- **Noise floor (nat a vs nat b, identical tree):** both 0/12 [0%, 24%]; best frame 3.42 vs 2.42 obsidian, P = 0.163; lava deaths P = 0.015 (so a "significant" lava-death difference between two identical trees happens — lava deaths need a bigger margin than P ≥ 0.95 alone); seconds P = 0.997 (tree-vs-tree time is dominated by landing luck, not code). Decision: a natural challenger must beat the noise floor on best frame, not on time.
- **pf (TYPECRAFT_PF_SEARCH_BUDGET=1):** 0/12, best frame 1.58 vs 3.42, P(better) = 0.008. Rejected; dropped from default plans.
- **craft (craft-stale-table, overlapping crafts):** fix 12/12 = 100% [76%, 100%] vs base 9/12 = 75% [47%, 91%], P(base better) = 0.016. Promoted (b962291 stays).
- **arena top-up (1b61d5c):** 9/12 = 75% [47%, 91%] vs base 10/12 = 83% [55%, 95%], P(base better) = 0.821, not separated. Kept per the not-worse rule. The 5 failures all stopped at 9/10 obsidian: 2 stuck on the same mold cell in both arms (19296,88,21857 and 19360,68,21281: landing-specific), 1 death at verify, 2 move_vetoed mold stances (footing air / not arrived). Lintel shortfall no longer appears.
- **iron deadlock (race c5 809's inventory, 600 s step machine):** gate 2/12 [5%, 46%] vs base 0/12 [0%, 24%]. Base reproduces the deadlock exactly (ore=1 ingots=0, smelt waiting for 3 ore, flint needing an ingot; 11,903 deadlock events). The gate arm's failures exposed a second deadlock: no fuel at smelt time (coal 0, planks 0, logs 0, gather_wood complete). Fix 9d145cf (needsSmeltFuel reopens gather_wood); measured in f6.
- **dragon (3 runs):** 0/3. See below.
- **blaze (10 runs, baseline):** 0/10 [0%, 28%]. See below.

## Dragon kit (decision 3, 762f638), f4
The kit order works: in every trial the server confirmed the bot in the End with 6 beds (cycle 5: 0 beds server-side, 0/6). The fight itself: death by an enderman 1 s after start, death by dragon's breath at 39 s; after a death the attempt continued in the overworld (should end).

## Blaze rod baseline, f4
Fortress found in ~5 s; the bot burns to death from blaze fireballs and wither skeletons in ~12 s (and walked into lava locally). Combat and fire, not navigation.

## Harness faults found and fixed this cycle
- MC 26.x pause-when-empty stalled forceloaded chunks (153 s vs 3.8 s for 4 chunks).
- Telemetry WAL deleted at pack time: shared-unit event trails of f4 and f5 lost (0a31adf); outcomes unaffected.
- 26.x attack packet: bot.attack was undecodable, kicked on first swing (f99fd3f).
- Bandit not live on runners (pinned defaults) until ci/params.json (f683719).
- Arena dirt shortfall at the lintel (1b61d5c per-cell top-up).

## f5 natural, run 37892960524, set A, 12 paired
- natk1 (1 bot per server) 1/12 = 8% [1%, 35%] vs refill (6 per server) 0/12 [0%, 24%]; best frame 2.58 vs 2.42, P = 0.588; deaths 1.50 vs 2.33, P = 0.943. Not separated: natural stays at 6 per server. The pass was landing 5 again (715 s; f1's pass was also landing 5).
- **The "portal_start" stall is a refill-walk lock** (f5-natk1-a-7, full telemetry): perched one block above the floor beside the frame, every pathfinder walk to a station stand 3–6 blocks away failed (pf_no_progress / pf_partial, 20 s each; 265 vetoed fill_lava moves in ~15 min). The one walk that started on the floor arrived in 1.7 s. The phase label stays "portal_start" because castObsidianAt's pillar/refill runs before its own setPhase. Fix efa9d77 (lava-safe shuffle fallback); measured in f8.

## f7 water, run 37895016008, set W, 12 paired, fixed slug (ca5840e)
- The f5 "both arms fail" landings were the harness: one escapeWater call where the race re-dispatches, and a dry-land check on the block under the bot's centre (overhangs the water on a bank lip). Fixed slug: both arms 12/12 = 100% [76%, 100%].
- Ledge lift (fa76014) slower on 10 of 12 landings: sign p = 0.039, mean +9.0 s, 95% [−20.3, +2.2]. Reverted (87e2c67).

## Dragon, f7 + f8 (6 runs each)
- f7 (death ends attempt, breath dodge): 0/6; 3 of 3 inspected deaths "slain by Enderman" before any bed (gaze level after the tp).
- f8 (+ gaze down, fend endermen, 1c12fe9): 0/6; 1 enderman death, 4 dragon's breath, 1 own-bed explosion. Next: bed placement retries in place with held=none or a floor of air after a dodge, standing in the breath; the fountain stand is in the dragon's path.

## f8 arena, run 37897412661, shuffle vs base, 12 paired
- Both 10/12 = 83% [55%, 95%], pass P = 0.497, seconds P(better) = 0.136. Kept (not worse). The shuffle arm cast landing 7 (19360,68,21281), which stuck at 9/10 in both f4 arms and f8 base; it lost landing 9 to a pillar jam (15 pillar_steps "placed dirt" with feet fixed at 72), unrelated to the refill walk.

## Iron, f6 run 37894072875 (fuel fix 9d145cf vs base)
- fuel 1/10 vs base 1/11 so far: no effect. The fuel arm gathered 5 logs, then sat 600 s at ore=1 logs=5 planks=0 coal=0: smelt_iron's fuel gate counted only coal and planks. Fix: logs count (f9).

## Iron log fuel, f9 run 37897574738, 12 paired (iron-deadlock slug)
- logfuel 10/12 = 83% [55%, 95%] vs base (exp/logfuel-base) 3/12 = 25% [9%, 53%]; better on 8, worse on 1; P(better) = 0.997, sign p = 0.039. **Promoted.** With 9d145cf (gather wood when ore has no fuel) the c5 809 deadlock is resolved; f6's fuel arm alone was 1/12 vs 1/12.

## f7 head vs champion, run 37895016008, set A, 12 paired
- natural: head 1/12 (landing 5, 772 s) vs champ 0/12; best frame 2.92 vs 2.17, P = 0.845. arena: head 11/12 = 92% [65%, 99%] vs champ 8/12 = 67% [39%, 86%], P = 0.926; head slower 27 s (95% [−53.0, −4.4]). Neither reaches 0.95: champion unchanged.
- Always-stuck cells, every arm, every fleet: landing 8 (20030,38,21334) and landing 4 (20717,8,20168) are **lidded cups** — aim_fail with the ray stopping in the bot's own cell. RCON on local-1 after a local repro: 20030,39,21334 is copper_ore (natural rock the chamber skipped: "cleared 55 skipped 18 of 84"). Fix: dig a lid before the pour (f10). Landing 11 (20037,17,22129) is the refill-walk lock.

## f8 natural, run 37897412661, shuffle vs base, 12 paired
- both 0/12; best frame 2.83 vs 2.17, P = 0.778; deaths P = 0.620. Kept (not worse). When the shuffle fires it arrives 3 of 43 times: the lava guard refuses the digs it needs, and some walks end in death. The refill-walk lock remains the main natural wall; station walk_grid logging added to read it.

## f10 arena, run 37900099447, lid vs base, 12 paired
- lid 10/12 vs base 11/12, P(better) = 0.175, not separated; the lid dig never fired in the arena (no natural rock over arena cups). Natural arms pending.

## f10 natural, run 37900099447, lid vs base, 2 replicates × 12 landings
- both 0/24 [0%, 14%]; best frame (paired by landing) 3.17 vs 2.00, P = 0.880; deaths equal (2.25 vs 2.25). Kept: landing 8 got past its lidded cell (4–5 obsidian vs 1).
- **Deaths are now the dominant natural outcome**: 137 deaths in 48 trials (~2.9 per trial). Lava ~60 (lava_fill 14, verify 11, find_lava 11, water 7, lava 6, anchor 5, portal_start 5), mobs ~25 (15 at find_lava), drowning 14, inWall 7. The "verify" lava deaths are 3–10 blocks from the cell: they happen on the refill walk under a stale phase label. One read in full (nat-lid-5 d4): the station shuffle stepped off a ledge into the pool → fix ed61b58 (shuffle never steps toward lava).
- Landing 11 (refill-walk lock) walk_grid, local repro: the bot in a 2-high pocket at y16, the stand one up beside it, the cell over the head solid → no step-up jump. Fix: shuffle digs its own headroom and fires whenever off the stand (f12). Local rerun: past landing 11's 1/10 for the first time (2 obsidian, one headroom dig, one arrival).

## Paired-compare fix (replicates), f10 and f12 recomputed
compare.ts keyed rows by landing only, so the f10/f12 "nat + nat2" pools used 12 of 24 trials. Fixed (occurrence-keyed); recomputed with 22 pairs:
- f10 lid vs base: 0/24 vs 0/23; best frame 3.23 vs 2.41, P = 0.856; deaths 2.32 vs 2.18, P = 0.363. Kept.
- f12 headroom vs base: 0/23 vs 0/23; best frame 2.23 vs 2.59, P = 0.335; **deaths 2.50 vs 1.82, P(better) = 0.037; lava deaths 1.00 vs 0.64, P = 0.034** — worse. The headroom commit also makes the shuffle fire whenever off the stand, before the shuffle had a lava step-guard (ed61b58, f13). Decision deferred to f13 (lava stop vs base, base = headroom without the guard): revert headroom if the guard does not bring deaths back to the f12 base level.

## f13, run 37903558057, shuffle lava stop (ed61b58) vs base, 2 replicates
- natural (23 pairs): 0/23 vs 1/24 (base nat2-5, landing 5, 1518 s); best frame 3.35 vs 3.30, P = 0.528; deaths 1.35 vs 1.96 (better on 16, worse on 6; P = 0.912); **lava deaths 0.57 vs 1.13, P(better) = 0.986**, 95% [0.04, 1.09]. Kept. Caveat: the f4 noise floor produced a lava-death P of 0.015 between identical trees, so this is at the edge of that floor; the direction matches the mechanism read in f10.
- arena: 9/12 vs 10/12, P = 0.283, not separated.
- Headroom decision (deferred from f12): with the guard, deaths 1.35 sit below f12's no-headroom base (1.82): headroom stays.

## f14, run 37905541655, refill walkway vs base, 2 replicates
- natural (24 pairs): 0/24 vs 0/24; best frame 2.88 vs 2.42, P = 0.774; deaths 2.13 vs 1.75, P = 0.169; refill walks arrived 45% vs 37%. Kept (not separated). The walkway itself arrived 4 of 51: nearly every failure never left the start cell, which sat one block above the path; the walk sneaked, and sneaking refuses a ledge. Fix ffefa95 (sneak only on level steps), f16.
- arena: 10/12 each; the walkway never fired in the arena.

## f15, run 37907607494, descend lava guard vs base, 2 replicates
- natural (24 pairs): 0/24 vs 1/24 (base nat-5, landing 5, 653 s); **best frame 3.92 vs 3.25, P = 0.803** (highest natural mean this cycle); deaths 1.79 vs 2.21, P = 0.821; lava deaths equal. Kept.
- arena: 11/12 vs 11/12.
- Landing 5 has entered the Nether 5 times (f1, f5, f7, f13, f15), and no other landing ever has: the others fail upstream (anchor, find_lava, refill).

## RACE c7: FIRST RACE NETHER ENTRY (f4 worker 1, run 37890750601, build 303cc21, 5 bots, 240 min, base -20000,20000)
- **steve-race-005 entered the Nether at ~90 min** from a cold start, zero human input. Server: "steve-race-005 has made the advancement [We Need to Go Deeper]" at 07:24:20 UTC (race start 05:54). Its path on the server: Stone Age 06:02, Getting an Upgrade 06:04, Acquire Hardware 06:15, Hot Stuff 06:48, Nether 07:24. Bot log: `[LIGHT] lit@-19,4,15 fireCell=nether_portal`. It took 29 portal dispatches (deaths at anchor, lava_fill, water, find_lava; "pool unreachable"; "site 2 from its lava" ×8) before the frame closed.
- Funnel (race-funnel.ts, data/runs/37890750601/fleet-w1/race-funnel.txt): stone pick 5/5 (3–12 min); bucket 4/5; water 4/5; flint & steel 3/5 (35, 77, 38 min); site anchor 2/5; obsidian ≥ 1 2/5; portal lit 1/5; in Nether 1/5 [4%, 62%].
- Two bots never got flint and steel (002: no bucket kit; 004: no water). Race c5 (old code): 0/3 past the iron deadlock. Deaths: 26 rows (6 inWall, 4 lava, 3 mob, 13 uncaused). 26 water re-placements at the start, 5 process exits.
- This ran on 303cc21, before the iron fuel fixes (9d145cf, f9 log fuel), the lid, walkway, lava guards. Races c8a–d (f11) run the current code.

## f16, run 37910944659, walkway level-step sneak vs base, 2 replicates
- natural (24 pairs): 0/24 each; best frame 3.58 vs 3.17, P = 0.791; deaths 2.13 vs 1.58, P = 0.101; lava deaths 0.67 vs 0.33, P = 0.083. Not separated (trending worse on deaths); walkway arrivals 6/58 vs 3/61.
- **Root cause found in walkway_stuck:** the head cell was still stone/andesite/copper ore after the walkway "dug" it. digAt never equips a tool (6 s cap); refills run holding a bucket. The cup-lid dig had the same bug: across f10–f16 cup_lid_cleared logged "was X now X" 20 of 21 times (landing 8's copper ore 5 of 5). So the lid fix, the walkway and the shuffle were mostly no-ops. Fix: digWithPick (f18).

## f17, run 37913768424: HEAD vs the f4 champion (303cc21), 2 replicates — NEW CHAMPION
- natural (23 pairs): head 2/23 (landing 5: 564 s and 1622 s) vs champ 0/24; **best frame 3.17 vs 2.00, +1.17, 95% [0.35, 2.26], P(better) = 0.999, sign p = 0.022** (noise floor between identical trees: P = 0.163); deaths 1.52 vs 1.96, P = 0.825; lava deaths equal.
- arena: 8/12 vs 9/12, P = 0.278, not separated; seconds equal.
- champion.json → 2e8a574 (the f17 head arm).

## f18, run 37915476688, pickaxe for lid/walkway/shuffle digs vs base, 2 replicates — PROMOTED
- natural (21 pairs): 0/21 vs 1/24 (base nat-5, 1355 s); **best frame 4.71 vs 3.52, +1.19, 95% [−0.19, 2.43], P(better) = 0.954** (highest natural mean this cycle); deaths equal; lava deaths 0.57 vs 0.76, P = 0.797. Lid digs now work 17/17 (base 3/21); walkway arrivals 11/32 (base 3/64).
- arena: 11/12 vs 10/12, P = 0.708.
- Five digpick trials reached 9/10 obsidian (landings 1, 7, 8) and ran out of the 1800 s natural budget; the race gives the portal step 2700 s. f20 measures HEAD at GYM_TOTAL_S = 2700 (4 replicates × 12).

## f20, run 37919767363: HEAD (champion + digpick) at the race budget (GYM_TOTAL_S = 2700), 4 replicates × 12, set A
- **1/48 = 2% [0.4%, 11%]** (landing 5, 523 s). Mean best frame 4.79; histogram 0:16, 1:1, 3:1, 4:1, 5:2, 6:5, 7:7, 8:6, 9:5, **10:4** — four trials had a complete frame, one entered.
- The last step is now the wall. f20-nat-a-8 read in full: frame 1 checked 10/10, then the bot lit it from the approach row with its hitbox inside the fire cell and burned to death in 11 s (inFire); after respawn on the surface 31 away it could not path back down (anchor_unreached) and built a second frame 80 blocks away; frame 2 checked 10/10, portal_unlit, and the next dispatch "resumed" it by walking to the pool to refill lava and died in it. Fix 7332567 (site_complete skips the refill; light only with the hitbox clear of the frame plane; step out of fire; light_interior logged), measured in f22.
- Open: a complete frame abandoned after a far respawn (site return fails underground).

## f21, run 37921265690: landing set B (new terrain), HEAD vs 303cc21 at 2700 s, 12 paired
- both 0/12; **best frame 5.18 vs 3.64, +1.55, P(better) = 0.847**; lava deaths 0.64 vs 1.27, P = 0.864; deaths 2.09 vs 2.27. The cycle-7 gain carries to new landings (direction; not separated at n = 11). Head trials 2, 4, 5, 6 cast 10–11 obsidian with no portal: the last-step wall again. f23 = the light fix on set B.

## Races c8a–d (f11, run 37902083738, build at f11's push: log fuel, lid, shuffle; no pickaxe digs), 4 races × 5 bots × 240 min
| race | stone pick | bucket | flint & steel | site anchor | obsidian ≥ 1 | portal lit | Nether |
|---|---|---|---|---|---|---|---|
| c8a (w1) | 4/5 | 3/5 | 3/5 | 3/5 | 1/5 | 0/5 | 0/5 |
| c8b (w2) | 5/5 | 4/5 | 4/5 | 4/5 | 3/5 | 1/5 (89 min) | 0/5 |
| c8c (w3) | 3/5 | 2/5 | 1/5 | 1/5 | 1/5 | 0/5 | 0/5 |
| c8d (w4) | 4/5 | 4/5 | 4/5 | 4/5 | 3/5 | 1/5 (220 min) | **1/5 (220 min)** |
- **c8d: steve-race-004 entered the Nether at 220 min** (server "[We Need to Go Deeper]" 11:39:30 UTC). Pooled c8: Nether 1/20 = 5% [1%, 24%]; portal lit 2/20; flint & steel 12/20.
- c8b steve-race-004 lit at 89 min and never entered: portalBuilt only held while a portal block was within 6 of the bot; regressed iron steps (lower priority numbers) took over; it later drowned. Fix 143f2b1 (remember the lit portal; enter_nether first). Validated by races, not the gym (the natural slug enters directly).
- Early-game losses: c8c bots 002/003 spent the race in gather_wood timeouts ("Returning to surface for wood (y=36 → 64)") and water escapes — treeless/underground starts.

## f22, run 37924991079: safe lighting (7332567) vs base, set A, 2 replicates at 2700 s
- natural (22 pairs): 1/22 each (light: landing 5, 1745 s; **base: landing 2, 2097 s — the first natural Nether entry on any landing but 5**); best frame 5.68 vs 5.77 (highest means yet), P = 0.460; deaths 1.91 vs 1.59, P = 0.191; lava deaths equal. Kept (not separated; mechanism).
- Lighting: base had 5 complete 10/10 frames, **4 portal_unlit**, 1 lit; light arm 1 complete frame, interior clear, lit. Lighting a complete frame failed 4 of 5 times on the old code — the light_interior event (light arm only) will say why as frames accumulate.
- arena: 10/12 vs 9/12.
