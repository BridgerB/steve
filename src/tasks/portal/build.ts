/**
 * Portal building - find a valid natural opening and place obsidian frame
 *
 * NEVER digs. Searches for a spot where the frame fits in existing air
 * with solid ground underneath. Builds bottom-up so each block always
 * has a reference below it.
 */

import type { Bot } from "typecraft";
import { vec3, windowItems } from "typecraft";
import { goTo } from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { StepResult } from "../../types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NON_SOLID = new Set([
	"air",
	"cave_air",
	"void_air",
	"short_grass",
	"tall_grass",
	"leaf_litter",
	"fern",
	"large_fern",
	"dead_bush",
	"poppy",
	"dandelion",
	"azure_bluet",
	"oxeye_daisy",
	"cornflower",
	"lily_of_the_valley",
	"blue_orchid",
	"allium",
	"red_tulip",
	"nether_portal",
	"snow",
	"bush",
	"torch",
	"wall_torch",
]);

const isSolid = (bot: Bot, x: number, y: number, z: number): boolean => {
	const b = bot.blockAt(vec3(x, y, z));
	return b != null && !NON_SOLID.has(b.name);
};

const isAir = (bot: Bot, x: number, y: number, z: number): boolean => {
	const b = bot.blockAt(vec3(x, y, z));
	if (!b) return true; // null = unloaded chunk section, likely air above ground
	return NON_SOLID.has(b.name);
};

/**
 * Check if a portal frame fits at (ox, oy, oz) extending in the given axis.
 * axis=0: extends in +X (4 wide), axis=1: extends in +Z (4 wide)
 *
 * Requirements:
 * - 4 solid ground blocks at Y-1
 * - All 10/14 frame positions are air
 * - All 6 interior positions (2x3) are air
 */
const portalFits = (
	bot: Bot,
	ox: number,
	oy: number,
	oz: number,
	axis: 0 | 1,
): boolean => {
	for (let d = 0; d < 4; d++) {
		const x = axis === 0 ? ox + d : ox;
		const z = axis === 1 ? oz + d : oz;

		// Solid ground under bottom row
		if (!isSolid(bot, x, oy - 1, z)) return false;

		// All 5 rows must be air
		for (let dy = 0; dy < 5; dy++) {
			if (!isAir(bot, x, oy + dy, z)) return false;
		}
	}
	return true;
};

/** Search for a valid portal spot near the bot */
const findPortalSpot = (
	bot: Bot,
): { x: number; y: number; z: number; axis: 0 | 1 } | null => {
	const bx = Math.floor(bot.entity.position.x);
	const by = Math.floor(bot.entity.position.y);
	const bz = Math.floor(bot.entity.position.z);

	for (let r = 3; r <= 16; r++) {
		for (let dx = -r; dx <= r; dx++) {
			for (let dz = -r; dz <= r; dz++) {
				if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
				for (let dy = -3; dy <= 3; dy++) {
					for (const axis of [0, 1] as const) {
						if (portalFits(bot, bx + dx, by + dy, bz + dz, axis))
							return { x: bx + dx, y: by + dy, z: bz + dz, axis };
					}
				}
			}
		}
	}
	return null;
};

/** Find an adjacent solid block to place against */
const findRef = (bot: Bot, x: number, y: number, z: number) => {
	const dirs = [
		{ dx: 0, dy: -1, dz: 0, face: vec3(0, 1, 0) },
		{ dx: -1, dy: 0, dz: 0, face: vec3(1, 0, 0) },
		{ dx: 1, dy: 0, dz: 0, face: vec3(-1, 0, 0) },
		{ dx: 0, dy: 0, dz: -1, face: vec3(0, 0, 1) },
		{ dx: 0, dy: 0, dz: 1, face: vec3(0, 0, -1) },
		{ dx: 0, dy: 1, dz: 0, face: vec3(0, -1, 0) },
	];
	for (const { dx, dy, dz, face } of dirs) {
		const b = bot.blockAt(vec3(x + dx, y + dy, z + dz));
		if (b && !NON_SOLID.has(b.name)) return { block: b, face };
	}
	return null;
};

export const buildNetherPortal = async (bot: Bot): Promise<StepResult> => {
	const obsidianCount = windowItems(bot.inventory)
		.filter((i) => i.name === "obsidian")
		.reduce((sum, i) => sum + i.count, 0);

	if (obsidianCount < 10)
		return {
			success: false,
			message: `Need 10+ obsidian, have ${obsidianCount}`,
		};

	if (!windowItems(bot.inventory).find((i) => i.name === "flint_and_steel"))
		return { success: false, message: "Need flint and steel" };

	const useCorners = obsidianCount >= 14;

	for (let i = 0; i < 30; i++) {
		if (bot.entity.onGround) break;
		await sleep(200);
	}
	if (!bot.entity.onGround) return { success: false, message: "Not on ground" };

	const spot = findPortalSpot(bot);
	if (!spot)
		return { success: false, message: "No valid portal location nearby" };

	const { x: ox, y: oy, z: oz, axis } = spot;
	logEvent("portal", "spot_found", `${ox},${oy},${oz} axis=${axis}`);

	// Walk to the portal area
	const midX = axis === 0 ? ox + 1.5 : ox;
	const midZ = axis === 1 ? oz + 1.5 : oz;
	await goTo(bot, vec3(midX, oy, midZ), { range: 3, timeout: 10000 });

	// Build frame: bottom row, left column, right column, top row
	const frame: { x: number; y: number; z: number }[] = [];

	const pos = (d: number, dy: number) => ({
		x: axis === 0 ? ox + d : ox,
		y: oy + dy,
		z: axis === 1 ? oz + d : oz,
	});

	// Bottom row
	for (let d = 0; d < 4; d++) frame.push(pos(d, 0));
	// Left column
	for (let dy = 1; dy <= 4; dy++) frame.push(pos(0, dy));
	// Right column
	for (let dy = 1; dy <= 4; dy++) frame.push(pos(3, dy));
	// Top middle
	frame.push(pos(1, 4));
	frame.push(pos(2, 4));

	// Remove corners if not enough obsidian
	const filtered = useCorners
		? frame
		: frame.filter((p) => {
				const d = axis === 0 ? p.x - ox : p.z - oz;
				const dy = p.y - oy;
				const isCorner = (d === 0 || d === 3) && (dy === 0 || dy === 4);
				return !isCorner;
			});

	try {
		for (const p of filtered) {
			const existing = bot.blockAt(vec3(p.x, p.y, p.z));
			if (existing?.name === "obsidian") continue;

			const obs = windowItems(bot.inventory).find((i) => i.name === "obsidian");
			if (!obs) return { success: false, message: "Ran out of obsidian" };

			await bot.equip(obs, "hand");
			await bot.lookAt(vec3(p.x + 0.5, p.y + 0.5, p.z + 0.5));

			const ref = findRef(bot, p.x, p.y, p.z);
			if (!ref)
				return {
					success: false,
					message: `No reference at ${p.x},${p.y},${p.z}`,
				};

			try {
				await bot.placeBlock(ref.block, ref.face);
			} catch {}
			await sleep(100);
		}

		// Light portal
		const flint = windowItems(bot.inventory).find(
			(i) => i.name === "flint_and_steel",
		);
		if (!flint) return { success: false, message: "Lost flint and steel" };

		await bot.equip(flint, "hand");
		await sleep(200);

		const lightPos = pos(1, 0);
		const bottom = bot.blockAt(vec3(lightPos.x, lightPos.y, lightPos.z));
		if (!bottom) return { success: false, message: "Can't find bottom frame" };

		await bot.activateBlock(bottom.position, vec3(0, 1, 0));
		await sleep(1000);

		const interiorPos = pos(1, 1);
		const interior = bot.blockAt(
			vec3(interiorPos.x, interiorPos.y, interiorPos.z),
		);
		if (interior?.name === "nether_portal") {
			logEvent("portal", "build_success", `at ${ox},${oy},${oz}`);
			return {
				success: true,
				message: `Portal built at ${ox},${oy},${oz}`,
				portalPos: { x: interiorPos.x, y: interiorPos.y, z: interiorPos.z },
			} as StepResult & { portalPos: { x: number; y: number; z: number } };
		}

		return { success: false, message: "Frame placed but failed to light" };
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : "Build failed",
		};
	}
};
