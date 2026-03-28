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

/**
 * Chase and kill a single animal, returning true if it died
 */
const killAnimal = async (bot: Bot, animal: Entity): Promise<boolean> => {
	const start = Date.now();
	const maxTime = 15000; // 15s max per animal

	while (Date.now() - start < maxTime) {
		if (!bot.entities[animal.id]) break;

		const dist = distance(bot.entity.position, animal.position);

		// Sprint toward animal if too far
		if (dist > 2) {
			await bot.lookAt(animal.position);
			bot.setControlState("forward", true);
			bot.setControlState("sprint", true);
			const chaseStart = Date.now();
			while (
				bot.entities[animal.id] &&
				distance(bot.entity.position, animal.position) > 1.5 &&
				Date.now() - chaseStart < 5000
			) {
				await bot.lookAt(animal.position);
				await sleep(50);
			}
			bot.setControlState("forward", false);
			bot.setControlState("sprint", false);
		}

		if (!bot.entities[animal.id]) break;

		// Attack with proper cooldown (625ms for sword)
		await bot.lookAt(offset(animal.position, 0, animal.height * 0.5, 0));
		bot.attack(animal);
		await sleep(650);
	}

	const dead = !bot.entities[animal.id];

	// Walk forward to collect drops
	if (dead) {
		bot.setControlState("forward", true);
		await sleep(600);
		bot.setControlState("forward", false);
	}

	return dead;
};

/**
 * Find and kill animals for food
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
		searchAttempts < 25 &&
		(bot.health ?? 20) > 4
	) {
		const animal = findNearestEntity(bot, isNearbyAnimal(bot, blacklist));

		if (!animal) {
			searchAttempts++;
			// Head toward any visible animal at any distance
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
				await goTo(bot, farAnimal.position, {
					range: 10,
					timeout: 20000,
				});
			} else {
				logEvent("food", "searching", `attempt ${searchAttempts}, exploring`);
				const angle = searchAttempts * 1.2;
				const exploreDist = 40 + searchAttempts * 15;
				const target = {
					x: bot.entity.position.x + Math.cos(angle) * exploreDist,
					y: bot.entity.position.y,
					z: bot.entity.position.z + Math.sin(angle) * exploreDist,
				};
				await goTo(bot, target as { x: number; y: number; z: number }, {
					range: 5,
					timeout: 15000,
				});
			}
			continue;
		}

		searchAttempts = 0;
		const dist = distance(bot.entity.position, animal.position);

		if (dist > 4) {
			await goTo(bot, animal.position, { range: 1, timeout: 10000 });
		}

		await equipItem(bot, "sword", "hand");

		const killed = await killAnimal(bot, animal);
		if (killed) {
			kills++;
			await sleep(500);
			logEvent(
				"food",
				"kill",
				`${animal.name} #${kills} (food: ${countFood(bot)})`,
			);
		} else {
			blacklist.add(animal.id);
			logEvent("food", "gave_up", `${animal.name} after 10 hits`);
		}
	}

	const totalFood = countFood(bot);
	const gained = totalFood - startFood;
	return {
		success: totalFood >= targetCount || gained > 0,
		message: `Killed ${kills} animals, food: ${totalFood}/${targetCount}`,
	};
};
