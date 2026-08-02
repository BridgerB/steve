/**
 * STRATEGY "pathfind-scaffold": route out of the ocean trap with typecraft's general
 * pathfinder instead of the manual carve-a-stair escape. Hypothesis: the pathfinder
 * handles water→shore better than escapeWater IF (a) it's pointed at a genuinely-dry
 * standing target found by a WIDE scan (up to 48 blocks), and (b) it's WILLING to path
 * through the water it's already floating in — the production config has liquidCost:100
 * which makes wading almost prohibitively expensive, so we lower it here.
 *
 * Two escape mechanisms the pathfinder can use once configured:
 *   - walk UP the shore slope (no items needed) — if a genuine dry target is reachable
 *     by wading + stepping up banks, it routes there with liquidCost low.
 *   - scaffold/pillar with placeable blocks (needs items) — getPathfinder already sets
 *     scaffoldingBlocks (cobble/dirt/…); we /give cobblestone so getMoveUp can place.
 *
 * NOTE ON ITEMS: a real spawn has NOTHING, so scaffolding is only available if the bot
 * was given blocks. We give cobblestone via RCON so we can measure the best case; the
 * report notes that this path REQUIRES held blocks. Even without blocks the lowered
 * liquidCost lets it walk up a shore slope, which is the no-item fallback.
 */
import {
	getBlock,
	getPathfinder,
	goTo,
	isInWaterTrap,
	isOnDryLand,
} from "../src/lib/steve/lib/bot-utils.ts";
import { connect } from "../src/lib/steve/lib/rcon.ts";
import { logEvent } from "../src/lib/steve/lib/logger.ts";
import { type Vec3, vec3 } from "typecraft";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// LAND plants only — a bot can stand inside these in open air. Deliberately excludes
// seagrass/kelp/lily (those only grow underwater/on water, so they're never dry).
const DRY_PLANTS = new Set([
	"short_grass",
	"tall_grass",
	"fern",
	"large_fern",
	"sugar_cane",
	"snow",
	"snow_layer",
	"vine",
]);
/**
 * DRY headroom — air or a dry plant the bot can stand inside, but explicitly NOT water.
 * This is the fix over escapeWater's isPassableBlock (which counts water as passable):
 * counting water made submerged SEAFLOOR blocks pass as "dry targets", so the bot dove
 * to the sea bottom and stood there underwater forever. Requiring non-water headroom
 * means the target is genuinely above the waterline = real shore.
 */
const isDryHeadroom = (b: ReturnType<typeof getBlock>): boolean =>
	!b ||
	b.name === "air" ||
	b.name === "cave_air" ||
	DRY_PLANTS.has(b.name);
const isSolidGround = (b: ReturnType<typeof getBlock>): boolean =>
	!!b &&
	b.name !== "air" &&
	b.name !== "cave_air" &&
	!b.name.includes("water") &&
	!b.name.includes("lily") &&
	!b.name.includes("vine") &&
	!b.name.includes("leaves") &&
	b.name !== "bedrock" &&
	!DRY_PLANTS.has(b.name);

/**
 * WIDE dry-target scan — same idea as escapeWater's dryTargets() but with a larger
 * radius (R=48) so we can find real shore even when it's well out of the 16-block
 * production window. A valid target: solid top, 2 passable above, and NOT a single
 * block floating on water. Ranked by horizontal distance + climb penalty.
 */
const dryTargets = (bot: any, R = 48): Vec3[] => {
	const p = bot.entity?.position;
	if (!p) return [];
	const cx = Math.floor(p.x);
	const cy = Math.floor(p.y);
	const cz = Math.floor(p.z);
	const found: { v: Vec3; d: number }[] = [];
	for (let dx = -R; dx <= R; dx++) {
		for (let dz = -R; dz <= R; dz++) {
			if (dx === 0 && dz === 0) continue;
			const x = cx + dx;
			const z = cz + dz;
			for (let y = cy + 8; y >= cy - 6; y--) {
				const g = getBlock(bot, vec3(x, y, z));
				if (!isSolidGround(g)) continue;
				// Genuinely dry: 2 blocks of NON-water air above (this is what makes it
				// shore, not seafloor), the ground block itself not sitting in water, and
				// no water directly below (excludes a lone block floating on the surface).
				if (!isDryHeadroom(getBlock(bot, vec3(x, y + 1, z)))) break;
				if (!isDryHeadroom(getBlock(bot, vec3(x, y + 2, z)))) break;
				if (getBlock(bot, vec3(x, y - 1, z))?.name.includes("water")) break;
				found.push({
					v: vec3(x, y + 1, z),
					d: Math.abs(dx) + Math.abs(dz) + Math.abs(y + 1 - cy) * 2,
				});
				break;
			}
		}
	}
	found.sort((a, b) => a.d - b.d);
	return found.map((f) => f.v);
};

export const escape = async (bot: any): Promise<void> => {
	if (isOnDryLand(bot)) return;

	// Give the bot scaffolding material so the pathfinder's getMoveUp can place-and-jump
	// (real spawns have none — see file header). Best-effort; keep going if RCON fails.
	try {
		const rcon = await connect();
		await rcon.command(`give ${bot.username ?? "Water3"} minecraft:cobblestone 64`);
		await sleep(600); // let the SetSlot land in the client inventory
		logEvent("nav", "ps_gave_cobble");
	} catch (e) {
		logEvent("nav", "ps_give_failed", String(e));
	}

	const pf = getPathfinder(bot);
	// Make the pathfinder WILLING to wade: production liquidCost is 100 (near-refusal to
	// enter water). We're already IN water, so a high liquidCost makes every candidate
	// route start with a huge penalty and A* prefers to sit still / fail. Lower it so
	// swimming toward the nearest shore is cheap, keep scaffolding + digging on so it can
	// pillar up a bank or carve a notch if the slope is a wall.
	pf.setMovements({
		liquidCost: 1.2,
		canDig: true,
		digCost: 4,
		maxDropDown: 3,
		allow1by1towers: true,
		allowParkour: true,
		infiniteLiquidDropdownDistance: false,
	});
	logEvent("nav", "ps_movements", "liquidCost=1.2 digCost=4 scaffold=on");

	const start = Date.now();
	const BUDGET = 70000;
	let attempt = 0;

	while (Date.now() - start < BUDGET) {
		if (isOnDryLand(bot)) {
			// Confirm it sticks (don't celebrate a one-tick bob).
			bot.clearControlStates();
			await sleep(300);
			if (isOnDryLand(bot) && !isInWaterTrap(bot)) {
				logEvent("nav", "ps_escaped");
				return;
			}
		}

		const targets = dryTargets(bot);
		const target = targets[attempt % Math.max(1, Math.min(targets.length, 4))];
		if (!target) {
			logEvent("nav", "ps_no_target");
			// No dry target in range — nudge outward a little and rescan.
			await sleep(500);
			attempt++;
			continue;
		}

		const dxz = Math.round(
			Math.hypot(
				target.x - bot.entity.position.x,
				target.z - bot.entity.position.z,
			),
		);
		console.log(
			`[pathfind-scaffold] attempt=${attempt} target=${target.x},${target.y},${target.z} distXZ=${dxz} candidates=${targets.length}`,
		);
		logEvent(
			"nav",
			"ps_goto",
			`t=${target.x},${target.y},${target.z} d=${dxz} n=${targets.length}`,
		);

		// range 0 = stand ON the target block; give it a real chunk of time to route.
		const reached = await goTo(bot, target, { range: 0, timeout: 22000 });
		logEvent("nav", "ps_goto_done", `reached=${reached} dry=${isOnDryLand(bot)}`);
		console.log(
			`[pathfind-scaffold] goto reached=${reached} onDryLand=${isOnDryLand(bot)} pos=${Math.round(
				bot.entity.position.x,
			)},${Math.round(bot.entity.position.y * 10) / 10},${Math.round(bot.entity.position.z)}`,
		);
		attempt++;
		await sleep(200);
	}

	bot.clearControlStates();
	logEvent("nav", "ps_gave_up", `dry=${isOnDryLand(bot)}`);
};
