# Race funnels to compare against (cycle 7)

## ruststeve i5–i8 (5 bots, 240 min, tick 20)
Copied from ruststeve docs/report-2026-10-08.md §6 (read-only; its numbers come from its race.db and race-funnel.ts). Milestones of 5.

| reached | i5 | i6 | i7 | i8 |
|---|---|---|---|---|
| Craft Planks | 3 | 3 | 3 | 5 |
| Mine Iron Ore | 1 | 3 | 3 | 4 |
| Craft Buckets | 1 | 2 | 3 | 4 |
| Build Nether Portal | 0 | 2 | 3 | 3 |
| Enter Nether (valid) | 0 | 0 | 0 | 0 |

- On land at start: i5 3/5, i6 3/5, i7 5/5, i8 5/5.
- Deaths (journal): i7 3 lava; i8 6 lava, 3 drowned.
- Bot-hours past budget: i7 13.84, i8 10.28. Budgets: gather_wood 360 s, mine_iron 1,200 s, mine_coal 600 s, build_nether_portal 1,500 s, find_fortress 900 s, others 600 s.
- Largest past-budget steps: i7 gather_wood 7.77 h (bots in lakes), craft_bucket 2.43 h, build_nether_portal 2.25 h, craft_sticks 1.30 h (stale window); i8 mine_stone 3.76 h (lake), build_nether_portal 2.50 h, gather_wood 1.81 h.
- Time to the portal step: i7 39–45 min (3 bots); i8 25–97 min. Its standing best: i6 rust-race-001 entered the Nether at 177 min.

## steve race c5 (3 bots, 120 min) — docs/report-2026-10-09.md §6
Stone pickaxe 3/3, bucket 3/3, water 3/3, flint and steel 1/3, site anchor 1/3, obsidian ≥ 1 1/3 (max 5), Nether 0/3.

## Milestone mapping for c7 onward
steve's race-funnel.ts stages map to ruststeve's: craft planks ≈ (before stone pick), mine iron ore ≈ mine_iron ok, craft buckets ≈ bucket, build nether portal ≈ site anchor / portal_cast dispatch, enter nether = the_nether. The c7 table reports both stage sets side by side.
