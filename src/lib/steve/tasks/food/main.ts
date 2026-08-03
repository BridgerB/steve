/**
 * Food tasks - hunting animals for food
 */

import type { Bot, Entity } from "typecraft";
import { distance, offset } from "typecraft";
import {
	countItems,
	equipItem,
	findNearestEntity,
	goTo,
	sleep,
} from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { StepResult } from "../../types.ts";

const FOOD_ANIMALS = ["pig", "cow", "sheep", "chicken", "rabbit"];

const countFood = (bot: Bot): number =>
	countItems(bot, "cooked_") +
	countItems(bot, "beef") +
	countItems(bot, "porkchop") +
	countItems(bot, "mutton") +
	countItems(bot, "chicken") +
	countItems(bot, "rabbit") +
	countItems(bot, "bread") +
	countItems(bot, "apple");

const isNearbyAnimal = (bot: Bot, blacklist: Set<number>) => (e: Entity) =>
	!!e.name &&
	FOOD_ANIMALS.includes(e.name) &&
	!blacklist.has(e.id) &&
	distance(bot.entity.position, e.position) < 128;

/** Actively collect nearby dropped meat (server auto-pickup within ~1 block). */
const collectMeat = async (bot: Bot): Promise<void> => {
	try {
		await bot.collectDrops(12, 6000, async (p) => {
			await goTo(bot, p, { range: 1.2, timeout: 4000 });
		});
	} catch {
		/* best-effort */
	}
};

/**
 * Chase and kill a single animal. Drives forward+sprint CONTINUOUSLY (no stop
 * between swings, so a fleeing animal can't outrun us), jump-hops when horizontal
 * progress stalls (2-block rises / fences / a lip the animal backs onto), and swings
 * on the sword cooldown whenever within a GENEROUS reach — skittish animals hover at
 * 3.4-4.0 centre-to-centre, so a tight 3.2 gate never fired. CRUCIAL: every look uses
 * force:true — a non-forced bot.lookAt() never resolves while stationary and hangs
 * the whole loop (the old task froze staring at the animal for the full 90s).
 */
const killAnimal = async (bot: Bot, animal: Entity): Promise<boolean> => {
	const deadline = Date.now() + 18000;
	let lastHit = 0;
	let lastPos = { x: bot.entity.position.x, z: bot.entity.position.z };
	let lastProgress = Date.now();
	bot.setControlState("sprint", true);
	try {
		while (Date.now() < deadline) {
			const live = bot.entities[animal.id];
			if (!live) break; // gone → dead (or despawned)
			const dist = distance(bot.entity.position, live.position);
			await bot.lookAt(offset(live.position, 0, (live.height ?? 1) * 0.5, 0), true);
			bot.setControlState("forward", dist > 0.9);

			const now = Date.now();
			const moved = Math.hypot(
				bot.entity.position.x - lastPos.x,
				bot.entity.position.z - lastPos.z,
			);
			if (moved > 0.35) {
				lastPos = { x: bot.entity.position.x, z: bot.entity.position.z };
				lastProgress = now;
			}
			if (dist > 1.1 && now - lastProgress > 550) {
				bot.setControlState("jump", true);
				await sleep(110);
				bot.setControlState("jump", false);
				lastProgress = now;
			}
			if (dist <= 4.5 && now - lastHit >= 625) {
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

/**
 * Find and kill animals for food.
 */
export const gatherFood = async (
	bot: Bot,
	targetCount: number,
): Promise<StepResult> => {
	await equipItem(bot, "sword", "hand");
	const startFood = countFood(bot);
	let kills = 0;
	let searchAttempts = 0;
	const blacklist = new Set<number>();

	while (
		countFood(bot) < targetCount &&
		searchAttempts < 40 &&
		(bot.health ?? 20) > 4
	) {
		const animal = findNearestEntity(bot, isNearbyAnimal(bot, blacklist));

		if (!animal) {
			searchAttempts++;
			const farAnimal = findNearestEntity(
				bot,
				(e) =>
					!!e.name && FOOD_ANIMALS.includes(e.name) && !blacklist.has(e.id),
			);
			if (farAnimal) {
				logEvent(
					"food",
					"searching",
					`attempt ${searchAttempts}, heading to ${farAnimal.name} at ${distance(bot.entity.position, farAnimal.position).toFixed(0)}`,
				);
				await goTo(bot, farAnimal.position, { range: 6, timeout: 8000 });
			} else {
				logEvent("food", "searching", `attempt ${searchAttempts}, exploring`);
				const angle = searchAttempts * 1.5;
				const exploreDist = 30 + searchAttempts * 8;
				const target = {
					x: bot.entity.position.x + Math.cos(angle) * exploreDist,
					y: bot.entity.position.y,
					z: bot.entity.position.z + Math.sin(angle) * exploreDist,
				};
				await goTo(bot, target as { x: number; y: number; z: number }, {
					range: 5,
					timeout: 8000,
				});
			}
			continue;
		}

		searchAttempts = 0;

		// Pathfinder approach toward the animal's CURRENT cell — SHORT timeout + a
		// loose range so we re-target the moving animal each loop instead of chasing
		// one stale far path (goTo range:1 to a wandering animal diverges and the old
		// task never reached the melee code). The pathfinder climbs terrain the raw
		// chase can't; the melee burst then finishes with jump-assist + wide reach.
		if (distance(bot.entity.position, animal.position) > 7) {
			await goTo(bot, animal.position, { range: 4, timeout: 5000 });
		}

		await equipItem(bot, "sword", "hand");

		const killed = await killAnimal(bot, animal);
		if (killed) {
			kills++;
			await collectMeat(bot);
			logEvent(
				"food",
				"kill",
				`${animal.name} #${kills} (food: ${countFood(bot)})`,
			);
		} else if (distance(bot.entity.position, animal.position) <= 12) {
			// Genuinely stuck (barrier between us) — skip it. If it merely outran us it
			// stays selectable and we re-approach next loop.
			blacklist.add(animal.id);
			logEvent("food", "gave_up", `${animal.name}`);
		}
	}

	// Final sweep for any meat lying uncollected.
	if (countFood(bot) < targetCount) await collectMeat(bot);

	const totalFood = countFood(bot);
	const gained = totalFood - startFood;
	const explored = searchAttempts > 0;
	return {
		success: totalFood >= targetCount || gained > 0 || explored,
		message: `Killed ${kills} animals, food: ${totalFood}/${targetCount} (searched ${searchAttempts})`,
	};
};
