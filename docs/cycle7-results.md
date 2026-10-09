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
