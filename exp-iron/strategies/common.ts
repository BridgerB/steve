/**
 * Shared helpers for mine-iron experiment strategies.
 */
import type { Bot } from "typecraft";
import { vec3 } from "typecraft";
import { equipItem, sleep } from "../../src/lib/steve/lib/bot-utils.ts";

export const floorY = (bot: Bot): number => Math.floor(bot.entity.position.y);
const isAir = (n: string | undefined): boolean =>
	!n || n === "air" || n === "cave_air" || n === "void_air";
const isLava = (n: string | undefined): boolean => !!n && n.includes("lava");
const isWater = (n: string | undefined): boolean => !!n && n.includes("water");

export const equipPick = async (bot: Bot): Promise<void> => {
	if (bot.heldItem?.name.endsWith("_pickaxe")) return;
	for (const t of ["stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "wooden_pickaxe"]) {
		if (await equipItem(bot, t, "hand")) return;
	}
};

const safeDig = async (bot: Bot, block: unknown, timeout = 7000): Promise<void> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			// biome-ignore lint: dig takes a Block
			bot.dig(block as never),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("dig timeout")), timeout);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

const b = (bot: Bot, x: number, y: number, z: number) => bot.blockAt(vec3(x, y, z));

/**
 * Fast, safe VERTICAL descent to (or near) targetY. Digs the single block under the
 * bot's feet and drops into it — far faster than a diagonal staircase (one dig per
 * level vs. three). Before each dig it scans the column below: stops (does NOT dig)
 * if lava is within 4 blocks, if the block below opens onto a deep air shaft (long
 * fall), or if water sits below. On a hazard it shifts one block sideways onto solid
 * rock and keeps going; if it can't, it stops and returns the current y so the caller
 * can branch-mine wherever it safely got to (iron is plentiful anywhere y16..y54).
 */
export const digDownTo = async (
	bot: Bot,
	targetY: number,
	deadline: number,
): Promise<{ y: number; stopped: string | null }> => {
	await equipPick(bot);
	const startY = floorY(bot);
	let sideTries = 0;
	while (floorY(bot) > targetY && Date.now() < deadline) {
		if ((bot.health ?? 20) < 8) return { y: floorY(bot), stopped: "low health" };
		if (bot.entity?.isInWater) return { y: floorY(bot), stopped: "in water" };
		if (!bot.heldItem?.name.endsWith("_pickaxe")) await equipPick(bot);
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		const below = b(bot, fx, fy - 1, fz);

		// Hazard scan of the column directly below.
		let lavaClose = false;
		for (let d = 1; d <= 4; d++) if (isLava(b(bot, fx, fy - d, fz)?.name)) lavaClose = true;
		const waterBelow = isWater(below?.name);
		// Air below = a cave/void: measure the drop. A short drop (<=3) is fine; a deep
		// one risks fall damage, and lava at the bottom is fatal — treat as hazard.
		let deepDrop = false;
		if (isAir(below?.name)) {
			let d = 1;
			while (d < 10 && isAir(b(bot, fx, fy - d, fz)?.name)) d++;
			const landing = b(bot, fx, fy - d, fz);
			if (d > 4 || isLava(landing?.name) || isWater(landing?.name)) deepDrop = true;
		}

		if (lavaClose || waterBelow || deepDrop) {
			// Try to sidestep onto adjacent solid rock, then keep descending there.
			const moved = await sidestepToSolid(bot);
			if (!moved || ++sideTries > 4)
				return { y: floorY(bot), stopped: lavaClose ? "lava below" : waterBelow ? "water below" : "deep drop" };
			continue;
		}
		sideTries = 0;

		if (below && !isAir(below.name)) {
			try {
				await bot.lookAt(vec3(fx + 0.5, fy - 1, fz + 0.5));
				await safeDig(bot, below);
			} catch {}
		}
		// Let gravity drop us into the hole.
		await sleep(250);
		// If we didn't descend, nudge (block was stubborn / we're stuck on an edge).
		if (Math.floor(bot.entity.position.y) >= fy) await sleep(250);
	}
	console.log(`[digDownTo] ${startY} -> ${floorY(bot)} (target ${targetY})`);
	return { y: floorY(bot), stopped: null };
};

// Walk one cell to a horizontal neighbour that has solid footing and non-hazard head,
// digging the 1x2 opening if needed. Returns whether we changed cell.
const sidestepToSolid = async (bot: Bot): Promise<boolean> => {
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];
	for (const [dx, dz] of dirs) {
		const foot = b(bot, fx + dx, fy - 1, fz + dz);
		const feet = b(bot, fx + dx, fy, fz + dz);
		const head = b(bot, fx + dx, fy + 1, fz + dz);
		if (!foot || isAir(foot.name) || isLava(foot.name) || isWater(foot.name)) continue;
		if (isLava(feet?.name) || isLava(head?.name) || isWater(feet?.name) || isWater(head?.name)) continue;
		try {
			if (feet && !isAir(feet.name)) {
				await bot.lookAt(vec3(fx + dx + 0.5, fy, fz + dz + 0.5));
				await safeDig(bot, feet);
			}
			if (head && !isAir(head.name)) {
				await bot.lookAt(vec3(fx + dx + 0.5, fy + 1, fz + dz + 0.5));
				await safeDig(bot, head);
			}
			await bot.lookAt(vec3(p.x + dx, p.y, p.z + dz));
			bot.setControlState("forward", true);
			await sleep(400);
			bot.setControlState("forward", false);
			await sleep(200);
		} catch {}
		if (Math.floor(bot.entity.position.x) !== fx || Math.floor(bot.entity.position.z) !== fz)
			return true;
	}
	return false;
};
