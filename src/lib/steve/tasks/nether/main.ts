/**
 * Nether-specific tasks - fortress finding and blaze hunting
 */

import type { Bot } from "typecraft";
import { distance, offset, vec3, windowItems } from "typecraft";
import type { Block, StepResult } from "../../types.ts";

/**
 * Search for a Nether Fortress
 * Fortresses spawn along the X axis (east-west) in the Nether
 */
export const findFortress = async (bot: Bot): Promise<StepResult> => {
	// Look for nether brick blocks - signature of fortress
	const fortressBlocks = [
		"nether_bricks",
		"nether_brick_stairs",
		"nether_brick_fence",
	];

	// First check if we can already see fortress blocks
	let fortress = bot.findBlock({
		matching: (name) => fortressBlocks.includes(name),
		maxDistance: 64,
	}) as Block | null;

	if (fortress) {
		return {
			success: true,
			message: `Found fortress at ${Math.floor(fortress.position.x)}, ${Math.floor(
				fortress.position.y,
			)}, ${Math.floor(fortress.position.z)}`,
		};
	}

	// Search pattern: move along X axis (fortresses align on X)
	console.log("  Searching for fortress along X axis...");

	const startPos = vec3(
		bot.entity.position.x,
		bot.entity.position.y,
		bot.entity.position.z,
	);
	const searchDistance = 200;
	const searchTime = 60000; // 1 minute max search
	const startTime = Date.now();

	// Head in positive X direction
	await bot.lookAt(offset(bot.entity.position, 100, 0, 0));
	bot.setControlState("forward", true);
	bot.setControlState("sprint", true);

	while (Date.now() - startTime < searchTime) {
		// Check for fortress blocks periodically
		fortress = bot.findBlock({
			matching: (name) => fortressBlocks.includes(name),
			maxDistance: 64,
		}) as Block | null;

		if (fortress) {
			bot.setControlState("forward", false);
			bot.setControlState("sprint", false);
			return {
				success: true,
				message: `Found fortress at ${Math.floor(fortress.position.x)}, ${Math.floor(
					fortress.position.y,
				)}, ${Math.floor(fortress.position.z)}`,
			};
		}

		// Check for dangerous terrain (lava lakes)
		const blockBelow = bot.blockAt(
			offset(bot.entity.position, 0, -1, 0),
		) as Block | null;
		if (
			blockBelow &&
			(blockBelow.name === "lava" || blockBelow.name === "air")
		) {
			// Stop and reassess
			bot.setControlState("forward", false);
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Try to jump or find safe path
			bot.setControlState("jump", true);
			await new Promise((resolve) => setTimeout(resolve, 200));
			bot.setControlState("jump", false);
			bot.setControlState("forward", true);
		}

		// Periodically change Y level to search different heights
		const currentDist = Math.abs(bot.entity.position.x - startPos.x);
		if (currentDist > searchDistance) {
			// Turn around and try negative X
			bot.setControlState("forward", false);
			await bot.lookAt(offset(bot.entity.position, -100, 0, 0));
			bot.setControlState("forward", true);
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	bot.setControlState("forward", false);
	bot.setControlState("sprint", false);

	return {
		success: false,
		message: "Could not find fortress within search time",
	};
};

/**
 * Find and kill blazes for blaze rods
 */
export const killBlazes = async (
	bot: Bot,
	targetRods: number,
	budgetMs = 600_000,
): Promise<StepResult> => {
	// Rewritten from ruststeve's measured blaze harness (docs/nether-design.md there):
	// never walk blindly (f30 blaze: "tried to swim in lava"), swing only within reach at a
	// 650 ms cadence (one hit per hurt-invulnerability window), fight back at wither
	// skeletons that close in, break off below 10 hp to eat, collect the rod after a kill.
	const { goTo } = await import("../../lib/bot-utils.ts");
	const { logEvent, setPhase } = await import("../../lib/logger.ts");
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const rods = () => windowItems(bot.inventory).filter((i) => i.name === "blaze_rod").reduce((a, i) => a + i.count, 0);
	const eye = () => offset(bot.entity.position, 0, 1.62, 0);
	const equipSword = async () => {
		const sw = windowItems(bot.inventory).find((i) => i.name.endsWith("_sword"));
		if (sw && bot.heldItem?.name !== sw.name) await bot.equip(sw, "hand").catch(() => {});
	};
	const eat = async () => {
		const food = windowItems(bot.inventory).find((i) => i.name.startsWith("cooked_") || i.name === "bread");
		if (!food) return;
		try {
			await bot.equip(food, "hand");
			bot.activateItem();
			await sleep(1800);
			bot.deactivateItem();
		} catch {}
		(bot as unknown as { usingHeldItem: boolean }).usingHeldItem = false;
	};
	const hostile = (names: string[], r: number) =>
		Object.values(bot.entities)
			.filter((e) => names.includes(String(e.name)) && distance(eye(), offset(e.position, 0, 0.9, 0)) <= r)
			.sort((a, b) => distance(eye(), a.position) - distance(eye(), b.position))[0];
	const t0 = Date.now();
	let swings = 0;
	let kills = 0;
	let breakoffs = 0;
	setPhase("blaze_fight");
	await equipSword();
	while (rods() < targetRods && Date.now() - t0 < budgetMs) {
		if ((bot.health ?? 0) <= 0) break;
		// Break off: back away from the nearest threat and eat.
		if ((bot.health ?? 20) < 10) {
			breakoffs++;
			const t = hostile(["blaze", "wither_skeleton"], 24);
			if (t) {
				const p = bot.entity.position;
				const dx = p.x - t.position.x || 1;
				const dz = p.z - t.position.z || 1;
				const n = Math.hypot(dx, dz);
				await goTo(bot, vec3(Math.floor(p.x + (dx / n) * 6), Math.floor(p.y), Math.floor(p.z + (dz / n) * 6)), { range: 2, timeout: 4000 }).catch(() => {});
			}
			await eat();
			await equipSword();
			logEvent("nether", "blaze_breakoff", `hp ${(bot.health ?? 0).toFixed(1)}`, bot.entity.position);
			continue;
		}
		// Melee anything within reach: wither skeletons first (they close in), then blazes.
		const close = hostile(["wither_skeleton"], 3.2) ?? hostile(["blaze"], 3.2);
		if (close) {
			await equipSword();
			const id = close.id;
			try {
				await bot.lookAt(offset(close.position, 0, close.name === "blaze" ? 0.9 : 1.2, 0), true);
				bot.attack(close as never);
				swings++;
			} catch {}
			await sleep(650);
			if (!bot.entities[id] && close.name === "blaze") {
				kills++;
				const before = rods();
				await bot.collectDrops(6, 4000, async (p) => {
					await goTo(bot, p, { range: 1, timeout: 2500 }).catch(() => {});
				}).catch(() => 0);
				logEvent("nether", "blaze_kill", `kill ${kills} swings ${swings} rods ${before} → ${rods()} hp ${(bot.health ?? 0).toFixed(1)}`, bot.entity.position);
			}
			continue;
		}
		// A blaze in view but out of reach: close in on the ground only (the pathfinder, not
		// a blind sprint); a blaze high above comes down to shoot — wait for it.
		const far = hostile(["blaze"], 20);
		if (far) {
			const dy = far.position.y - bot.entity.position.y;
			if (dy < 3) await goTo(bot, vec3(Math.floor(far.position.x), Math.floor(bot.entity.position.y), Math.floor(far.position.z)), { range: 2, timeout: 3000 }).catch(() => {});
			else await sleep(600);
			continue;
		}
		// No blaze: go to the spawner (pathfinder) and wait beside it.
		const spawner = bot.findBlock({ matching: (name) => name === "spawner", maxDistance: 48, exposed: false } as never) as Block | null;
		if (spawner && distance(bot.entity.position, spawner.position) > 5) {
			await goTo(bot, spawner.position, { range: 4, timeout: 20000 }).catch(() => {});
			continue;
		}
		await sleep(1500);
	}
	const actualRods = rods();
	logEvent("nether", "blaze_done", `rods ${actualRods} kills ${kills} swings ${swings} breakoffs ${breakoffs} ${Math.round((Date.now() - t0) / 1000)} s`, bot.entity.position);
	return {
		success: actualRods >= targetRods,
		message: `Collected ${actualRods} blaze rods`,
	};
};
