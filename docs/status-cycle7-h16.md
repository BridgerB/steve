# steve cycle 7 — status at H16 (2026-10-09 ~21:15 UTC)

Numbers come from fleet batches.db / attempts.jsonl / server logs in `data/runs/<run>/` (n, Wilson 95%). The full decision log is `docs/cycle7-results.md`.

**Gap:** the loop stopped waking between ~16:22 and 20:50 UTC, and the runners sat idle from 18:34 to 20:52. f34 (20 workers) refilled them at 20:52.

## Headline

1. **Natural portal: ~44% into the Nether** (gym `portal-natural`, 2700 s budget).
   - Before H8 it was ~2%.
   - The fix was f27 (869b276 + 3aac1ae): every cast dig now equips a carried pickaxe. `digAt` had never equipped a tool and capped digs at 6 s. The cast always holds buckets, dirt or cobble, so every stone or cobblestone dig failed silently: cup clearing, lids, walkway, and portal interiors left as cobblestone.

   | fleet | set | arm | Nether |
   |---|---|---|---|
   | f27 | A | pick | 12/24 = 50% [31%, 69%] (base 1/22; sign p 0.006) |
   | f28 | B | champion | 5/12 = 42% [19%, 68%] |
   | f29 | A | champion | 4/12 |
   | f33 | A | both arms | 14/45 |

   - Entries came on 9+ distinct set-A landings and 5 set-B landings.
2. **Race Nether entries:** 14/105 bots = 13% [8%, 21%] over races c7–c12, all confirmed by the server's "[We Need to Go Deeper]" line.

   | races | bots in the Nether |
   |---|---|
   | c7 | 1/5 |
   | c8 | 1/20 |
   | c9 | 5/20 |
   | c10 | 3/20 |
   | c11 | 3/20 |
   | c12 | 1/20 |

3. **First blaze rod** (f32): the killBlazes rewrite went 1/8 vs base 0/8.
   - New arms survive the full 600 s; base dies in 34–265 s.

## The race wall is now the cast, not the early game

Pooled funnel, c10–c12 (55 bots):

| stage | bots |
|---|---|
| stone pick | 52 |
| bucket | 46 |
| water | 45 |
| flint & steel | 44 (80%) |
| site anchor | 34 |
| obsidian ≥ 1 | 33 |
| portal lit | 5 |
| Nether | 6 |

Race bots that start casting rarely finish, while the gym finishes ~44%. Portal-step time by failure reason:

| reason | portal-step time |
|---|---|
| cast stuck at a cell | 225 min |
| lava not exposed | 197 min |
| in water | 188 min |
| died at verify | 152 min |
| site too close to its lava | 146 min |
| no progress at portal_start | 144 min |
| complete frame not lit | 99 min |
| pickaxe worn out | 42 min |

The gym kit differs from a race bot's inventory: the gym gives 2 stone pickaxes, 64 cobblestone and 16 planks. A race bot has one pickaxe, already worn, and the pickaxe-everywhere change spends it faster. Next: replay the race inventory in the gym (a race-kit natural slug) and measure the gap directly.

## Champion

`champion.json` → the f27 pick arm, plus the later safe-light, enter-first, return-dig and tunnel fixes on HEAD:

| change | fleet | result | decision |
|---|---|---|---|
| return-dig | f26 | best frame +0.39 | kept |
| falling-block tunnel | f33 | best frame +0.57; pass 8/24 vs 6/21 | not separated; kept |

## Promoted / kept since H8

| change | result |
|---|---|
| safe light | f22: base 4 of 5 complete frames unlit; f23 first set-B entry |
| enter-first + remembered portal | race c8b: a lit portal was never entered |
| return-dig to own frame | f26 |
| pickaxe on every cast dig | f27: 12/24 vs 1/22 |
| falling-block-safe tunnel | f33 |
| killBlazes rewrite | f32: first rod |

Harness fixes since H8:
- Paired compare kept one replicate per landing; now it keeps all.
- Aggregate crashed on race-only workers.

## Next (H16–H24)

- A race-kit natural slug (one worn pickaxe, no cobble kit) to find the race cast gap. Then fixes: spare pickaxe crafting before the cast; and build blocks from mining in place of a gym gift.
- Read f34: 8 races, natural ×4 and blaze on HEAD.
- Blaze: deaths at the end of the 600 s budget, ≈50% rod drop.
- Handoff report at H24.
