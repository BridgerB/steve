# steve cycle 7 — the next 24 hours, in full

Written 2026-10-09 05:13 UTC (H0 = now). This file is the loop prompt's working plan. It sits under docs/steve-loop-cycle7.md (the strategist's directive) and Bridger's instructions in this session, which win where they differ: use all 20 runners, maximise each runner, never leak .env, run things plainly with full logs, search the web when unsure.

## 0. Standing rules (every turn)
1. Every turn ends with ScheduleWakeup (fallback ≤ 30 min) and, while anything runs, a Monitor on it. A turn without a wakeup is the failure that cost 3.3 days.
2. Never leave runners idle: the moment a fleet finishes, the next queued plan is pushed within 10 minutes. The backlog lives in §5; keep ≥ 2 plans ready.
3. At most 20 jobs in flight, counted with `gh run list --status in_progress --status queued` before every launch. Standard `ubuntu-24.04` only (free; 0 billable ms verified).
4. Every push goes through the pre-push `.env` scan (scripts/scan-env-leak.ts). Never print .env values. Runners get no secrets.
5. No `| tail` / filtered pipes on anything long: full logs to files, Monitors on files or on `gh run view`. Time sub-steps before guessing. Search the web when a platform behaviour is unclear.
6. Every number in a status file or report comes from a data file (batches.db, attempts.jsonl, trials.jsonl, metrics.jsonl, telemetry) with its Wilson 95% interval and n. Downloaded artifacts go to data/runs/<run-id>/ and are merged with scripts/ci/aggregate.ts into data/gym (each row tagged with gh_run).
7. Baselines are concurrent arms in the same fleet, on the same landings. A baseline arm is `exp/<name>-base` = HEAD with only the change under test reverted (old refs carry old harness code and collide run ids).
8. Arms by full sha or branch name only (parsePlan rejects short shas). Plans go through `node scripts/ci/fleet-plan.ts` locally before pushing; a plan push launches the fleet.
9. Conventional commits, no AI attribution, never push main. The only PR this cycle without Bridger asking is "ci: runner workflows" (directive §4.6).
10. Never touch ruststeve or Server B; read its committed reports only. Keep local-1 (25569/25579) and caffeinate (pid 11536) up.

## 1. State at H0
- Branch feat/portal-loop-7 @ bedae7d, pushed. Baseline branches: exp/craft-base (HEAD minus b962291), exp/topup-base (HEAD minus 1b61d5c) — rebuild both before every fleet that uses them.
- Runner system working end to end (dev1, run 37886417549): env cache gym-env-5a34b6… (230 MB, restore 3 s, server up 8–15 s), landing set A (12, identical on Mac and runner), fleet planner pure + 31 tests, shared-server units, /proc load sampler, arena 2/2 + craft 2/2 + shared 2/2 + race path all ran.
- Measured so far (runner arena smoke, pre-top-up code): 4/6 [30%, 90%]; both failures = out of build blocks at the lintel → fixed 1b61d5c (cell_topup), dev1 topup arm 1/1 with cell_topup firing.
- Running now: cap1 (run 37887151110), capacity grid 7 bot counts × 3 heaps × 12 landings = 252 trials in 90 units on 20 workers, ~35 min.
- Not built yet: iron-deadlock slug, blaze_rod slug, lake-shore landing set + water slug, refill-reach logging, champion.json/challenge.yml, bandit posterior aggregation, portal deletions, race funnel comparison vs ruststeve i7/i8.
- Known gaps: artifact storage quota (500 MB on Free) — telemetry per worker is the bulk; the race summary prints the funnel only from attempts rows; .gitignore lacks /data/.

## 2. Hour-by-hour

### H0–H0.7 — capacity (cap1) and its decision
- Monitor cap1 to completion. Download all 21 artifacts into data/runs/37887151110/, aggregate into data/runs/…/agg, run `scripts/ci/capacity-report.ts`.
- Decision rule (already coded): healthy = tick p99 max < 30 ms after start-up, machine CPU p95 < 90 %, free memory never < 1.5 GB, pass rate not below the 1-bot interval, median time within +15 % of 1 bot. Choose the healthy setup with the most trials per runner-hour → K* bots per server, H* GB heap. If two setups are within 10 % on trials/hour, take the smaller K (less interference).
- If K* = 12 is healthy (the ceiling of the grid), queue cap2 with K 16 and 20 at H* before trusting it; otherwise cap2 is not needed.
- Commit `ci/capacity.json` {k, heap_mb, trials_per_runner_hour, run id} and make it the planner default: experiments without per_server get K*, heap H* (add `default_per_server`/`default_heap_mb` to the plan schema, read from ci/capacity.json by fleet-plan.ts; tests).
- Natural trials at 1800 s are 4× longer than arena trials; if the capacity data are arena-only, the natural default is min(K*, 6) until a natural capacity check says more (queued in f5).
- Write the result into docs/status-cycle7-h0.md (the queue item 3 answer) and tell Bridger the number.
- While cap1 runs: delete data artifacts of cancelled runs (gh api DELETE /repos/BridgerB/steve/actions/artifacts/<id>) to protect the 500 MB quota; add /data/ to .gitignore; read ruststeve's report-2026-10-08.md for its i7/i8 funnel numbers (read-only) into a comparison table file.

### H0.7 — PR and the main measurement fleet (f4)
- Open the workflows-only PR "ci: runner workflows": .github/workflows/{prepare-env,gym,race,fleet}.yml with the temporary push triggers on gym.yml/race.yml removed, champion.json (initial: {"commit": null, "landing_set": "A", "note": "set by the noise-floor screen"}), and the runner profile lines in server-profile.ts. Body: what each workflow does, the free-runner evidence, how to dispatch. Post the URL in the status file. Continue on the branch; after merge, dispatch by workflow_dispatch as well as plan pushes.
- Rebuild exp/craft-base and exp/topup-base from HEAD. Launch f4 at K*/H*:
  - nat: portal-natural, GYM_TOTAL_S=1800, 12 landings, arms a, b (identical tree → the noise floor), pf (TYPECRAFT_PF_SEARCH_BUDGET=1).
  - craft: craft-stale-table (now overlapping crafts), arms fix vs exp/craft-base, 12 each.
  - arena: build-nether-portal GYM_LAVA_D=6, arms topup vs exp/topup-base, 12 each.
  - dragon: 3 runs with the End kit order (762f638).
  - c7: race, 5 bots, 240 min (one worker, ~4.2 h).
- Expected: gym part done by ~H3 (natural trials dominate), race by ~H5.

### H0.7–H3 — build while f4 runs (local, tested before any fleet uses it)
1. Iron-deadlock slug `iron-deadlock`: give the exact race c5 809 inventory (1 raw_iron, 3 buckets, 0 ingots, a furnace, fuel, tools) on landing set A; run the step machine (runLoop) from that state for 600 s; pass = flint_and_steel ≥ 1 from the server's view (clear <bot> minecraft:flint_and_steel 0). Baseline arm first. Then the fix as its own commit: ruststeve's early iron pickaxe (craft the first iron pickaxe as soon as 3 iron are mined, bounded 300 s) and/or the smelt gate; compare step gates with ruststeve's.
2. Flint and steel: before building anything, read race c5's traces for 808 and 810 (why no flint) — write the reason into the status file; build a slug only for a confirmed mechanism.
3. blaze_rod slug: kitted bot (iron sword, food, blocks, armor) tp to the cached fortress patch (world-meta fortress) in the Nether; run tasks/nether/main.ts findFortress + killBlazes; 600 s; pass = blaze_rod ≥ 1 from the server. 10 trials, baseline only.
4. Lake-shore landing set W (water): extend prepare-world/landings with a `shore` kind: a water surface cell 3–5 blocks from a bank one block above the water, 12 of them; add set W to ci/env.json (env rebuild, ~5 min). Slug `water-escape`: bot placed in the water at the shore landing, runs escapeWater; pass = standing on dry land (server: not in water, block below solid) within 120 s; record time. Arms: ledge fix vs exp/ledge-base (HEAD minus fa76014), lily on/off if a pad is present.
5. Refill-reach study logging: in station refill / fillBucket, one event per refill attempt with planned path length, arrived yes/no, reason when not, distance to pool, lava cells seen; add counters to screen.ts; one natural screen of 12 on the champion tree after it lands.
6. Bandit posterior aggregation: scripts/ci/params-from-attempts.ts — rebuild params.json from merged attempts rows (credit rule = attempt placed obsidian or finished; arena rows never credit; per source natural/race), write ci/params.json each fleet; workers already seed from it. Report posteriors per source.
7. champion.json + challenge plan generator: scripts/ci/challenge.ts <challenger-ref> writes a plan with champion vs challenger arms on set A natural 12 paired (+ arena 6 for cast changes).
8. Shrink artifacts: zstd telemetry already; drop per-trial server logs unless the trial failed; check sizes after f4.

### H3 — read f4 gym results
- Noise floor: paired a vs b on best frame, deaths, lava deaths, block gap, seconds → the variance floor (mean |a−b| and its interval). Goes in every status file from now on.
- pf: promote if P(best frame better) ≥ 0.95 with deaths not worse, beyond the noise floor; else revert the switch from default plans.
- craft: promote if fix pass rate > base with P ≥ 0.95 (or base fails ≥ 3 of 12 and fix 0); else the slug still doesn't reproduce — redesign it from the 808 trace.
- arena top-up: keep if not worse (arena is a regression gate; the fix targets a known failure).
- dragon: if kills > 0, record; if 0, read the first failure verbatim and the server inventory log lines.
- champion.json ← the tree of arm a (commit, set A, batch label, paired metrics, date).
- Launch f5 immediately (§2 H3 list below).

### H3 — f5 (baselines for the new slugs, at K*)
- iron-deadlock baseline 12 (+ fix arm if ready).
- blaze_rod baseline 10.
- water-escape: ledge fix vs base, 12 paired at set W shores.
- refill-reach study: natural 12 on champion with the logging build.
- natural capacity check: natural 12 at K* vs 1 (only if K* > 1 came from arena data).
- dragon 3 more if the kit fix was confirmed working (Part 6 item 6: "second dragon set").

### H4.5–H5 — race c7 read
- Download the race artifact; run scripts/ml/race-funnel.ts; table next to race c5 (stone pick 3/3, bucket 3/3, water 3/3, flint 1/3, site 1/3, obsidian 1/3, Nether 0/3) and ruststeve i7/i8 (5 bots, 240 min, from its report).
- Bot-hours past budget by step, time to the portal step per bot, deaths by cause, placement faults (ring placement fix ea33260 — count re-placements).
- The largest past-budget step gets a reproducing slug and a 12-paired baseline in the next fleet before any fix.

### H5–H8 — fixes measured as challengers
- Each fix is one commit on a branch `exp/<fix>`; its challenge plan = champion vs challenger, paired on set A (natural 12 for cast/upstream changes, slug-specific for slugs), plus arena 6 for any cast change (the header check enforces flags).
- Candidates in order: iron gate (from iron-deadlock), whatever c7's top past-budget step names, refill-reach fix (only after the study names the failure), flint fix (only for a confirmed mechanism).
- Promotion: P ≥ 0.95 on best frame (or the slug's pass) with deaths not worse, or any natural pass → merge into feat/portal-loop-7, update champion.json in the same commit, rebuild exp/*-base branches.
- Clause (a): cast-step changes stop a batch when the same death cause occurs twice on a path the build changed; pathfinder/movement/upstream changes run to the cap.

### H8 — status file docs/status-cycle7-h8.md
Top: Bridger-only list (merge the workflows PR; STEVE_INGEST_SECRET secret for live race telemetry; keep the Mac awake). Then: headline (Nether yes/no), capacity result, noise floor, every measured build with paired P and n, race c7 funnel, fleets run (count, jobs, failures, overhead per job median/p90, runs per wall hour), artifact/cache sizes, what is queued.

### H8–H12 — keep 20 runners full
- Rolling challengers from §5. Portal module deletions (fill-stance arrival, lava_already climb, site-level pool exclusion, zero counters across cycles 4–5) as one challenger with a paired natural 12 + arena 6; report lines before/after (3,489 now → target < 3,200).
- If the refill study is in: the one cast build of the cycle aimed at its top failure, screened 12 paired vs champion; confirmation trigger (≥ 1 natural pass or best-frame median ≥ 8) → 24 paired at 2700 s (4 shards × 6) on set A (+ set B if built).

### H12 — race c8 prep, second landing set
- Cut landing set B in prepare-env (new region, same checks); env rebuild; confirmations use A and B.
- Race c8 at H ~12–14 with everything promoted so far (one worker, 5 bots, 240 min).

### H12–H20 — late game and second races
- blaze_rod: if the baseline shows a fixable failure (fortress not found within patch, combat), build one fix as a challenger.
- Dragon second set; crystals slug if dragon kills.
- Bandits: buckets 3/4/5, anchor_dy_max, stall_s live on natural screens and races; posteriors per source refreshed in ci/params.json after every fleet.

### H16 — status file docs/status-cycle7-h16.md (same format as H8).

### H20–H24 — 24 h handoff
- docs/report-<date>.md, 2,500–3,500 words, the directive's 12 sections in order, every number with interval and n, printed in full in the terminal; ends with the state block (branch, commit, PRs, champion.json, cache keys/sizes/dates, box state, local server, Mac disk, the one command that launches the next fleet).
- Part 11 list for ruststeve: which of its four findings reproduced here and by how much (craft window, ledge lift, lily pads, sliced A*), runner numbers (overhead, variance floor, runs/hour, capacity K*), refill-reach findings, the End setup order.
- Then race c8 (if not run) and continue §5. Do not stop, do not wait for a merge.

## 3. Decision thresholds (fixed in advance)
- Promote: paired P(better) ≥ 0.95 on the primary metric with deaths not worse (P(deaths worse) < 0.5), or any natural pass.
- Reject: P(better) ≤ 0.5 after 12 paired, or a clause (a) stop on a cast change.
- Inconclusive (0.5–0.95): extend to 24 paired only if the effect exceeds the noise floor; else reject.
- Capacity: §2 H0 rule.

## 4. Failure handling
- A fleet with ≥ 3 harness-failed trials: stop launching, read every failed trial's full log and server log, fix, smoke with a dev plan on ≤ 6 workers, then relaunch.
- A worker job that dies (timeout/cancel): its trials are re-queued in the next plan with the same labels + "r".
- Cache miss: run prepare-env (push to its paths or dispatch) and wait; never build in a hot job.
- Artifact quota hit: download and delete the oldest artifacts first; lower per-trial logs.

## 5. Backlog (in launch order; refill as items land)
1. f4 (above) — ready after cap1.
2. f5 (iron-deadlock, blaze_rod, water-escape, refill study, natural capacity check, dragon set 2).
3. Challengers: iron gate; c7 top step; refill fix; deletions; pf (if not promoted, drop).
4. Confirmation batch when the trigger fires.
5. Race c8 at ~H12 with promoted fixes.
6. cap2 (K 16/20) only if K* = 12.

## 6. The loop prompt (what each wakeup runs)
/loop dont stop. steve cycle 7 is the runner cycle. Read docs/steve-loop-cycle7.md and docs/steve-cycle7-24h-plan.md. Work the 24h plan in order: check what is running (gh run list; Monitors), read and merge every finished fleet's artifacts into data/, apply the decision thresholds, launch the next plan from the backlog so all 20 runners stay busy, build the next slug or fix locally and test it before any fleet uses it, write the status file at H8/H16 and the handoff at H24. Every turn ends with a Monitor on what runs and a ScheduleWakeup. No .env leaks, no AI attribution, full logs not tails, numbers only from data files with intervals.
