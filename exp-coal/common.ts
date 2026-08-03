/**
 * Shared mining primitives for the coal bake-off. Self-contained (does NOT edit
 * tasks/mining/main.ts) — reuses only bot-utils helpers + typecraft. All digging
 * obeys the no-X-ray rule: ore is found via bot.findBlocks with the default
 * exposed:true (line-of-sight only), never by reading unexposed blocks.
 */
import type { Bot } from "typecraft";
import { distance, offset, vec3 } from "typecraft";
import {
	digExposesLava,
	digExposesWater,
	equipItem,
	findBlock,
	goTo,
	moveCloser,
} from "../src/lib/steve/lib/bot-utils.ts";
import type { Block } from "../src/lib/steve/types.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isAir = (b: Block | null): boolean =>
	!b || b.name === "air" || b.name === "cave_air" || b.name === "void_air";
export const isLava = (b: Block | null): boolean => !!b && b.name.includes("lava");
export const isWater = (b: Block | null): boolean => !!b && b.name.includes("water");
export const isLiquid = (b: Block | null): boolean => isLava(b) || isWater(b);

export const invCount = (bot: Bot, sub: string): number =>
	bot.inventory.slots
		.filter((s) => s?.name.includes(sub))
		.reduce((a, s) => a + (s as { count: number }).count, 0);

const STONE_PLUS_PICKS = new Set([
	"netherite_pickaxe",
	"diamond_pickaxe",
	"iron_pickaxe",
	"stone_pickaxe",
]);

/** Keep a stone+ pickaxe in hand (gym grants one; this just equips it). */
export const ensurePick = async (bot: Bot): Promise<boolean> => {
	if (bot.heldItem && STONE_PLUS_PICKS.has(bot.heldItem.name)) return true;
	const pick = bot.inventory.slots.find((s) => s && STONE_PLUS_PICKS.has(s.name));
	if (!pick) return false;
	await equipItem(bot, pick.name, "hand").catch(() => {});
	return true;
};

/** Dig with a hard timeout — bot.dig() can hang silently. */
export const safeDig = async (bot: Bot, block: Block, timeout = 8000): Promise<void> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			bot.dig(block),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("dig timeout")), timeout);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

/** Look at a block and dig it, refusing liquids and dig-into-flood/lava. */
export const lookDig = async (bot: Bot, b: Block | null): Promise<boolean> => {
	if (isAir(b) || isLiquid(b)) return false;
	const block = b as Block;
	if (digExposesLava(bot, block.position)) return false;
	if (digExposesWater(bot, block.position)) return false;
	try {
		await bot.lookAt(offset(block.position, 0.5, 0.5, 0.5));
		await safeDig(bot, block);
		return true;
	} catch {
		return false;
	}
};

export const floorY = (bot: Bot): number => Math.floor(bot.entity.position.y);

/**
 * Harvest one exposed coal_ore within `radius` (line-of-sight, no X-ray). Walks
 * to it, clears the block above for headroom, mines it, and vacuums the drop.
 * Returns true if a coal item was actually collected.
 */
export const mineNearbyCoal = async (bot: Bot, radius = 40): Promise<boolean> => {
	const isCoal = (n: string) => n.includes("coal_ore");
	const ore = findBlock(bot, isCoal, radius);
	if (!ore) return false;
	// Don't chase ore whose drop would fall into lava.
	let dy = 1;
	while (dy <= 8 && isAir(bot.blockAt(offset(ore.position, 0, -dy, 0)))) dy++;
	if (isLava(bot.blockAt(offset(ore.position, 0, -dy, 0)))) return false;
	const before = invCount(bot, "coal");
	try {
		if (distance(bot.entity.position, ore.position) > 3.5) {
			await goTo(bot, ore.position, { range: 2, timeout: 10000 });
		} else {
			await moveCloser(bot, ore.position, { maxDistance: 2 });
		}
		if (distance(bot.entity.position, ore.position) > 4.5) return false;
		const above = bot.blockAt(offset(ore.position, 0, 1, 0)) as Block | null;
		if (above && !isAir(above) && !isLiquid(above)) await lookDig(bot, above);
		if (await lookDig(bot, ore)) {
			await bot.collectDrops(8, 4000, async (pp) => {
				await goTo(bot, pp, { range: 1, timeout: 3000 });
			});
			await goTo(bot, ore.position, { range: 1, timeout: 2500 }).catch(() => {});
		}
	} catch {}
	return invCount(bot, "coal") > before;
};

const HORIZ: [number, number][] = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];
export const rotate = (d: [number, number]): [number, number] => [d[1], -d[0]];

/** Pick a horizontal direction with the most solid, lava-free rock ahead. */
export const pickDigDir = (bot: Bot): [number, number] => {
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	let best: [number, number] = HORIZ[0];
	let bestScore = -1;
	for (const [dx, dz] of HORIZ) {
		let solid = 0;
		let bad = false;
		for (let i = 1; i <= 4; i++) {
			const b = bot.blockAt(vec3(fx + dx * i, fy, fz + dz * i));
			const bf = bot.blockAt(vec3(fx + dx * i, fy - 1, fz + dz * i));
			if (isLava(b) || isLava(bf)) bad = true;
			if (b && !isAir(b)) solid++;
			if (bf && !isAir(bf)) solid++;
		}
		if (!bad && solid > bestScore) {
			bestScore = solid;
			best = [dx, dz];
		}
	}
	return best;
};

/**
 * Dig straight down until the feet sit in solid stone-family rock (past the
 * grass/dirt cap), or until `maxDrop` blocks or a hazard. Never digs into lava
 * or a block that would flood. Returns the resulting feet-Y.
 */
export const digDownToStone = async (bot: Bot, maxDrop = 14): Promise<number> => {
	const STONE = /stone|deepslate|granite|diorite|andesite|tuff|_ore/;
	for (let i = 0; i < maxDrop; i++) {
		const p = bot.entity.position;
		const below = bot.blockAt(offset(p, 0, -1, 0)) as Block | null;
		if (!below || isAir(below)) {
			// small drop: step down
			await bot.lookAt(offset(p, 0, -1, 0));
			bot.setControlState("forward", false);
			await sleep(200);
			continue;
		}
		if (isLiquid(below) || digExposesLava(bot, below.position) || digExposesWater(bot, below.position))
			break;
		// Already standing on stone AND at least 4 below surface → good enough.
		if (STONE.test(below.name) && i >= 3) return floorY(bot);
		await ensurePick(bot);
		if (!(await lookDig(bot, below))) break;
		await sleep(250);
	}
	return floorY(bot);
};

/**
 * Dig one 1x2 step forward in (dx,dz) and walk into it. Stays LEVEL — refuses to
 * open a cell touching lava/water or with no floor (a cave edge). Returns outcome.
 */
export const stripStep = async (
	bot: Bot,
	dx: number,
	dz: number,
): Promise<"ok" | "blocked"> => {
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	const head = bot.blockAt(vec3(fx + dx, fy + 1, fz + dz));
	const feet = bot.blockAt(vec3(fx + dx, fy, fz + dz));
	const floor = bot.blockAt(vec3(fx + dx, fy - 1, fz + dz));
	if ([head, feet, floor].some(isLava)) return "blocked";
	if (digExposesLava(bot, vec3(fx + dx, fy, fz + dz))) return "blocked";
	const touchesWater = (cx: number, cy: number, cz: number): boolean =>
		(
			[
				[1, 0, 0],
				[-1, 0, 0],
				[0, 1, 0],
				[0, -1, 0],
				[0, 0, 1],
				[0, 0, -1],
			] as const
		).some((o) => isWater(bot.blockAt(vec3(cx + o[0], cy + o[1], cz + o[2]))));
	if (
		[head, feet, floor].some(isWater) ||
		touchesWater(fx + dx, fy, fz + dz) ||
		touchesWater(fx + dx, fy + 1, fz + dz)
	)
		return "blocked";
	if (isAir(floor)) return "blocked"; // stay level, don't walk off a ledge
	await lookDig(bot, head);
	await lookDig(bot, feet);
	await bot.lookAt(vec3(p.x + dx, p.y, p.z + dz));
	bot.setControlState("forward", true);
	await sleep(380);
	bot.setControlState("forward", false);
	await sleep(180);
	if (Math.floor(bot.entity.position.x) === fx && Math.floor(bot.entity.position.z) === fz)
		return "blocked";
	return "ok";
};
