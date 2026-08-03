/**
 * IDEA "mine" — reuse the mining task's robust gravel finder.
 *
 * Root problem with the baseline: it only scans 32 blocks for gravel and never
 * explores or digs, so at most random spawns there's no gravel in range → 0 flint;
 * and even when gravel is near, a small deposit + the 10% flint rate isn't enough.
 *
 * mineBlock(bot,"gravel",N) already does: memory → scan(64) → exploreRandom x3 →
 * staircaseMine (dig a descending stair looking for the block). Gravel occurs in
 * large disks both on beaches and underground, so the staircase reliably hits some.
 * We loop it in small batches, checking for flint after each batch, until we get a
 * flint or run out of budget. Bonus: after staircasing we're usually UNDERGROUND in
 * a stone tunnel, where placeStationBlock (carve-a-wall) is far more reliable than
 * on a random surface slope.
 */
import type { Bot } from "typecraft";
import {
	craftItem,
	findItem,
	getCraftingTable,
	failure,
} from "../src/lib/steve/lib/bot-utils.ts";
import { mineBlock } from "../src/lib/steve/tasks/mining/main.ts";
import type { StepResult } from "../src/lib/steve/types.ts";

export const run = async (bot: Bot): Promise<StepResult> => {
	// ~10% flint per gravel → mine in batches of 6 (≈47% chance of ≥1 flint each),
	// re-checking after every batch and stopping the instant we have flint.
	const deadline = Date.now() + 95_000;
	while (!findItem(bot, "flint") && Date.now() < deadline) {
		const r = await mineBlock(bot, "gravel", 6);
		// If mineBlock couldn't find ANY gravel (even after exploring + staircasing),
		// there's nothing more to try this run.
		if (!r.success && !findItem(bot, "flint")) break;
	}

	if (!findItem(bot, "flint")) return failure("Need flint (dig gravel)");

	const table = await getCraftingTable(bot);
	if (!table) return failure("Need crafting table");
	return craftItem(bot, "flint_and_steel", 1, table);
};
