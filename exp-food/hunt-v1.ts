/**
 * Idea 1 — "continuous-chase + collectDrops".
 *
 * Fixes vs production killAnimal:
 *  - Hold forward+sprint CONTINUOUSLY while swinging (production stops moving for
 *    650ms between hits, so a panicking animal outruns it and dist>2 → re-chase
 *    loop never lands the finishing blow).
 *  - Attack whenever within melee reach (3.2), gated only by the 625ms sword
 *    cooldown — face the body centre each tick so hits register.
 *  - After a kill, actively collect drops with bot.collectDrops(navigate) instead
 *    of a blind 600ms forward walk (production frequently leaves the meat behind).
 *  - Pre-approach far animals with the pathfinder so terrain doesn't strand it.
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

/** Chase + melee one animal with forward held continuously; true if it died. */
const killAnimal = async (bot: Bot, animal: Entity): Promise<boolean> => {
	const deadline = Date.now() + 18000;
	let lastHit = 0;
	bot.setControlState("sprint", true);
	try {
		while (Date.now() < deadline) {
			const live = bot.entities[animal.id];
			if (!live) break; // gone → died (or despawned)
			const d = distance(bot.entity.position, live.position);
			// Aim at the body centre and keep driving toward it.
			await bot.lookAt(offset(live.position, 0, (live.height ?? 1) * 0.5, 0));
			bot.setControlState("forward", d > 1.1);
			// Swing whenever in reach and the sword cooldown has elapsed.
			if (d <= 3.2 && Date.now() - lastHit >= 625) {
				bot.attack(live);
				lastHit = Date.now();
			}
			await sleep(60);
		}
	} finally {
		bot.setControlState("forward", false);
		bot.setControlState("sprint", false);
	}
	return !bot.entities[animal.id];
};

/** Sweep for dropped meat at/around the kill site. */
const collectMeat = async (bot: Bot): Promise<void> => {
	try {
		await bot.collectDrops(10, 6000, async (p) => {
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
			// Nothing tracked — roam outward to load new chunks / close on a far herd.
			roams++;
			if (roams > 12) break;
			const a = roams * 1.3;
			const dist = 24 + roams * 6;
			await goTo(
				bot,
				{ x: bot.entity.position.x + Math.cos(a) * dist, y: bot.entity.position.y, z: bot.entity.position.z + Math.sin(a) * dist } as never,
				{ range: 4, timeout: 8000 },
			);
			continue;
		}
		roams = 0;
		// Close the gap with the pathfinder if far (terrain-aware), then melee.
		if (distance(bot.entity.position, animal.position) > 6) {
			await goTo(bot, animal.position, { range: 2, timeout: 9000 });
		}
		await equipItem(bot, "sword", "hand");
		const killed = await killAnimal(bot, animal);
		if (killed) {
			kills++;
			await collectMeat(bot);
		} else {
			blacklist.add(animal.id);
		}
	}

	// One last sweep in case meat is lying nearby uncollected.
	if (rawMeat(bot) < 1) await collectMeat(bot);

	const meat = rawMeat(bot);
	return { success: meat >= 1, message: `hunt-v1 kills=${kills} meat=${meat} roams=${roams}` };
};

export default hunt;
