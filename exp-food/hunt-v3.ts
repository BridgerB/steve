/**
 * Idea 3 — "pathfinder-approach + wide-reach melee burst + jump-assist + collectDrops".
 * The intended winner. Combines what the diagnostics showed actually works:
 *   - APPROACH with the pathfinder (goTo) toward the animal's CURRENT cell, with a
 *     SHORT timeout and re-targeting every loop. The pathfinder climbs terrain
 *     (raw forward stalls on a 2-block rise); short timeout + re-target converge on
 *     a moving animal instead of chasing one stale far path for 10s.
 *   - MELEE BURST once within ~7 blocks: hold forward+sprint straight at the body,
 *     JUMP-hop when horizontal progress stalls (fences / 1-block steps / the animal
 *     backing onto a lip), and SWING on the 625ms sword cooldown whenever within a
 *     GENEROUS reach (4.5 centre-to-centre — the tight 3.2 gate never fired because
 *     skittish animals hover at 3.4-4.0, so the bot circled without ever attacking).
 *   - COLLECT with bot.collectDrops(navigate) after each kill (the blind 600ms walk
 *     frequently left the meat behind).
 */
import type { Bot, Entity } from "typecraft";
import { distance, offset } from "typecraft";
import { countItems, equipItem, goTo, sleep } from "../src/lib/steve/lib/bot-utils.ts";
import type { StepResult } from "../src/lib/steve/types.ts";

const FOOD_ANIMALS = ["pig", "cow", "sheep", "chicken", "rabbit"];
const rawMeat = (bot: Bot): number =>
	countItems(bot, "beef") + countItems(bot, "mutton") + countItems(bot, "chicken") + countItems(bot, "porkchop");

const nearestAnimal = (bot: Bot, blacklist: Set<number>): Entity | null => {
	let best: Entity | null = null;
	let bd = Infinity;
	for (const e of Object.values(bot.entities)) {
		if (!e.name || !FOOD_ANIMALS.includes(e.name) || blacklist.has(e.id)) continue;
		const d = distance(bot.entity.position, e.position);
		if (d < bd) { bd = d; best = e; }
	}
	return best;
};

const horiz = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
	Math.hypot(a.x - b.x, a.z - b.z);

/** Melee burst: drive at the animal, jump-hop over rises, swing on cooldown when in
 *  reach. Returns true if the animal died. */
const meleeBurst = async (bot: Bot, animal: Entity, budgetMs: number): Promise<boolean> => {
	const deadline = Date.now() + budgetMs;
	let lastHit = 0;
	let lastPos = { x: bot.entity.position.x, z: bot.entity.position.z };
	let lastProgress = Date.now();
	bot.setControlState("sprint", true);
	try {
		while (Date.now() < deadline) {
			const live = bot.entities[animal.id];
			if (!live) break;
			const d = distance(bot.entity.position, live.position);
			await bot.lookAt(offset(live.position, 0, (live.height ?? 1) * 0.5, 0));
			bot.setControlState("forward", d > 0.9);

			const now = Date.now();
			if (horiz(bot.entity.position, lastPos) > 0.35) {
				lastPos = { x: bot.entity.position.x, z: bot.entity.position.z };
				lastProgress = now;
			}
			// Stalled while trying to close → hop (clears a 1-block rise / fence / lip).
			if (d > 1.1 && now - lastProgress > 550) {
				bot.setControlState("jump", true);
				await sleep(110);
				bot.setControlState("jump", false);
				lastProgress = now;
			}
			// Wide reach: swing whenever plausibly in range and the cooldown elapsed.
			if (d <= 4.5 && now - lastHit >= 625) {
				bot.attack(live);
				lastHit = now;
			}
			await sleep(50);
		}
	} finally {
		bot.setControlState("forward", false);
		bot.setControlState("sprint", false);
		bot.setControlState("jump", false);
	}
	return !bot.entities[animal.id];
};

const collectMeat = async (bot: Bot): Promise<void> => {
	try {
		await bot.collectDrops(12, 6000, async (p) => {
			await goTo(bot, p, { range: 1.2, timeout: 4000 });
		});
	} catch { /* best-effort */ }
};

export const hunt = async (bot: Bot): Promise<StepResult> => {
	await equipItem(bot, "sword", "hand");
	const blacklist = new Set<number>();
	let kills = 0;
	let roams = 0;
	const deadline = Date.now() + 85000;

	while (rawMeat(bot) < 1 && Date.now() < deadline && (bot.health ?? 20) > 4) {
		const animal = nearestAnimal(bot, blacklist);
		if (!animal) {
			roams++;
			if (roams > 14) break;
			const a = roams * 1.3;
			const dist = 28 + roams * 6;
			await goTo(
				bot,
				{ x: bot.entity.position.x + Math.cos(a) * dist, y: bot.entity.position.y, z: bot.entity.position.z + Math.sin(a) * dist } as never,
				{ range: 4, timeout: 8000 },
			);
			continue;
		}
		roams = 0;
		const d = distance(bot.entity.position, animal.position);
		// Pathfinder approach (terrain-aware) toward the animal's CURRENT cell, short
		// timeout so we re-target the moving animal instead of chasing a stale path.
		if (d > 7) {
			await goTo(bot, animal.position, { range: 4, timeout: 5000 });
		}
		await equipItem(bot, "sword", "hand");
		// Melee burst; re-acquire the (possibly-updated) nearest afterwards.
		const killed = await meleeBurst(bot, animal, 9000);
		if (killed) {
			kills++;
			await collectMeat(bot);
		} else if (distance(bot.entity.position, animal.position) > 12) {
			// It outran us and is far now — don't blacklist (we may re-approach), just loop.
		} else {
			blacklist.add(animal.id); // genuinely unkillable (stuck across a barrier)
		}
	}

	if (rawMeat(bot) < 1) await collectMeat(bot);
	const meat = rawMeat(bot);
	return { success: meat >= 1, message: `hunt-v3 kills=${kills} meat=${meat} roams=${roams}` };
};

export default hunt;
