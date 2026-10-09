# steve cycle 7 status, hour 0 (2026-10-09 03:45 UTC)

## Only Bridger can do (not waiting on any of them)
1. Merge the workflows-only pull request "ci: runner workflows" (not opened yet; it opens after the first gym.yml smoke passes).
2. Add the repository secrets CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, CLOUDFLARE_D1_TOKEN (live race telemetry on the dashboard). Races run without them until then.
3. Keep the Mac awake (caffeinate -dimsu is running, pid 11536).

## Headline
No steve bot has entered the Nether by its own portal. Last measured: natural cast 0/63 [0%, 6%] (cycle 5); arena 66/66 excluding the s2a gate bug.

## Phase 0: cycle 6 closed
- Race c6 was killed on Server A before any bot finished (Bridger's stop). It has no usable data, which is why there is no c6 funnel.
- l1a (local arena smoke) was killed at 2 passes of 2 runs. It ran from the edit tree, so it does not measure a single commit; it counts only as proof that the local server works.
- The box: no tmux sessions and no gym, race or bot processes of mine. Server A forceload query is empty in the overworld, the Nether and the End.
- Branch feat/portal-loop-7 created from feat/portal-loop-6 at 4b59f22 and pushed.
- caffeinate pid 11536 alive (48 min).
- The local gym server local-1 (25569/25579) is up and idle; it is the fallback.
- The worktrees ~/Developer/steve-gym-local and ~/Developer/steve-gym-base remain until the runner smoke passes.

## Decisions
- Workflow files push over SSH, so the gh token's missing `workflow` scope does not block anything.

## Runner variance floor
Not measured yet (Phase 2).

## Queue (added during hour 0–1)
1. f1 (running): noise floor + pathfinder arm, craft fix vs base, arena, dragon, race c7.
2. f2 (queued): arena challenge, per-cell top-up (1b61d5c) against a390916.
3. Capacity test (Bridger, 2026-10-09): each runner has 4 vCPU / 16 GB; find the per-runner optimum before scaling screens. Grid: concurrent bots per server K ∈ {1, 2, 3, 4, 6} × server heap ∈ {4, 6, 10} GB, each bot on its own landing of set A, arena slug (short, deterministic). Measure per run: tick mean/p99 and max (tick query every 30 s), CPU and RSS of the server and each bot process (ps every 10 s), bot physics-tick jitter, pass rate and time-to-pass against K=1. Pick the largest K whose max tick stays under 30 ms and whose pass rate and time are not worse (paired against K=1). Needs: gym-batch lock and data paths per slot, fleet-worker running K trials concurrently on one server.
