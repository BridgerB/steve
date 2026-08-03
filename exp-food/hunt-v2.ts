/**
 * Idea 2 — "pure raw chase" (NO pathfinder at all).
 *
 * The production task freezes because it relies on goTo(range:1) to close on a
 * wandering animal; when the A* can't reach a moving target it loops forever and
 * the bot never moves. This idea removes the pathfinder from the hot loop: it just
 * faces the nearest animal and drives forward+sprint straight at it, jumping when
 * it stops making progress (fences, 1-block steps, water edges), swinging on the
 * sword cooldown whenever within reach, then walks over the drop to collect it.
 */
import type { Bot, Entity } from "typecraft";
import { distance, offset } from "typecraft";
import { countItems, equipItem, sleep } from "../src/lib/steve/lib/bot-utils.ts";
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

/** Drive straight at an animal, jump-hopping over obstacles; true if it dies. */
const chaseAndKill = async (bot: Bot, animal: Entity): Promise<boolean> => {
	const deadline = Date.now() + 20000;
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
			bot.setControlState("forward", d > 1.0);

			// Stuck detection: if we haven't moved horizontally in ~700ms while trying
			// to close, hop (clears fences, 1-block steps, animal pathing into a lip).
			const now = Date.now();
			const moved = horiz(bot.entity.position, lastPos);
			if (moved > 0.4) { lastPos = { x: bot.entity.position.x, z: bot.entity.position.z }; lastProgress = now; }
			if (d > 1.2 && now - lastProgress > 700) {
				bot.setControlState("jump", true);
				await sleep(120);
				bot.setControlState("jump", false);
				lastProgress = now;
			}

			if (d <= 3.2 && now - lastHit >= 625) {
				bot.attack(live);
				lastHit = now;
			}
			await sleep(55);
		}
	} finally {
		bot.setControlState("forward", false);
		bot.setControlState("sprint", false);
		bot.setControlState("jump", false);
	}
	return !bot.entities[animal.id];
};

/** Walk over the kill site to vacuum up drops (server auto-pickup within ~1 block). */
const collectAt = async (bot: Bot, pos: { x: number; y: number; z: number }): Promise<void> => {
	const deadline = Date.now() + 4000;
	while (Date.now() < deadline) {
		if (rawMeat(bot) >= 1) return;
		// Aim at the nearest dropped item if one is tracked, else the kill site.
		const items = Object.values(bot.entities).filter((e) => e.name === "item");
		const target = items.sort((a, b) => distance(bot.entity.position, a.position) - distance(bot.entity.position, b.position))[0];
		const p = target?.position ?? pos;
		await bot.lookAt({ x: p.x, y: bot.entity.position.y, z: p.z } as never);
		bot.setControlState("forward", horiz(bot.entity.position, p) > 0.6);
		await sleep(120);
	}
	bot.setControlState("forward", false);
};

export const hunt = async (bot: Bot): Promise<StepResult> => {
	await equipItem(bot, "sword", "hand");
	const blacklist = new Set<number>();
	let kills = 0;
	let idle = 0;
	const deadline = Date.now() + 85000;

	while (rawMeat(bot) < 1 && Date.now() < deadline && (bot.health ?? 20) > 4) {
		const animal = nearestAnimal(bot, blacklist);
		if (!animal) {
			// Nothing tracked: walk a straight leg outward to reveal a herd.
			idle++;
			if (idle > 18) break;
			const yaw = idle * 0.9;
			await bot.lookAt({ x: bot.entity.position.x + Math.cos(yaw) * 10, y: bot.entity.position.y, z: bot.entity.position.z + Math.sin(yaw) * 10 } as never);
			bot.setControlState("sprint", true);
			bot.setControlState("forward", true);
			await sleep(2500);
			bot.setControlState("forward", false);
			bot.setControlState("sprint", false);
			continue;
		}
		idle = 0;
		const killPos = { ...animal.position };
		const killed = await chaseAndKill(bot, animal);
		if (killed) {
			kills++;
			await collectAt(bot, killPos);
		} else {
			blacklist.add(animal.id);
		}
	}

	const meat = rawMeat(bot);
	return { success: meat >= 1, message: `hunt-v2 kills=${kills} meat=${meat} idle=${idle}` };
};

export default hunt;
