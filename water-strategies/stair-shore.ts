/**
 * STAIR-SHORE — a committed dig-a-staircase-up-the-bank ocean escape.
 *
 * The production escapeWater carves a staircase too, but it flakes: it re-derives the
 * dig direction from a target that re-locks every tick, so it chips one block here and
 * one there and never cuts a whole exit; and it false-completes on a momentary bob to
 * the surface. This strategy fixes both:
 *   1. Pick the nearest SHORE column once (nearest solid top at/above the water line)
 *      and COMMIT to the single cardinal direction toward it — never re-pick unless we
 *      make zero progress for a long time.
 *   2. GROUND the bot before every dig. typecraft water physics have NO buoyancy and
 *      IGNORE jump, so a bot pressing forward floats; digging while floating is 5×
 *      (underwater) × 5× (off-ground) = 25× slower and never finishes. clearControlStates
 *      + wait lets the buoyancy-free bot sink onto the floor (onGround=true), where dirt/
 *      sand breaks in a few seconds.
 *   3. Each step: dig the block AHEAD at head-height and the one above it (leaving the
 *      block ahead-below as the stair to step onto) + our own headroom, then press
 *      FORWARD into it — the wall-collision outOfLiquidImpulse (~0.3) hops us up onto the
 *      cut step. Repeat, same direction, until isOnDryLand.
 */
import { vec3 } from "typecraft";
import { getBlock, isOnDryLand } from "../src/lib/steve/lib/bot-utils.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Solid, standable terrain — the shore we climb toward and the step we stand on.
// Excludes water/lava, passable plants (seagrass/kelp on the ocean floor), and bedrock.
const isSolid = (b: ReturnType<typeof getBlock>): boolean =>
	!!b &&
	b.name !== "air" &&
	b.name !== "cave_air" &&
	b.name !== "bedrock" &&
	!b.name.includes("water") &&
	!b.name.includes("lava") &&
	!b.name.includes("seagrass") &&
	!b.name.includes("kelp") &&
	!b.name.includes("lily") &&
	!b.name.includes("grass") &&
	!b.name.includes("vine");

// Diggable by hand (no tool) — anything solid-ish that isn't fluid/bedrock. Plants are
// passable so digging them is pointless; skip them so we don't waste dig cycles.
const diggable = (b: ReturnType<typeof getBlock>): boolean =>
	!!b &&
	b.name !== "air" &&
	b.name !== "cave_air" &&
	b.name !== "bedrock" &&
	!b.name.includes("water") &&
	!b.name.includes("lava") &&
	!b.name.includes("seagrass") &&
	!b.name.includes("kelp") &&
	!b.name.includes("lily");

const digAt = async (
	bot: any,
	b: ReturnType<typeof getBlock>,
): Promise<boolean> => {
	if (!diggable(b)) return false;
	const pos = (b as { position: { x: number; y: number; z: number } }).position;
	try {
		await bot.lookAt(vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5), true);
		await Promise.race([
			(bot.dig(b as never, true) as Promise<void>).catch(() => {}),
			sleep(5000), // grounded-underwater dirt/sand is a few seconds; give it room
		]);
		bot.stopDigging();
	} catch {
		/* ignore */
	}
	return true;
};

// Let the buoyancy-free bot sink onto the floor so onGround=true and digs actually land.
const ground = async (bot: any): Promise<void> => {
	bot.clearControlStates();
	for (let i = 0; i < 10; i++) {
		if (bot.entity?.onGround) return;
		await sleep(100);
	}
};

// Nearest shore column: the closest (x,z) whose highest solid block sits AT/ABOVE our
// feet level (a bank to climb, not the pit floor) with air above it. Returns the
// committed CARDINAL direction toward it (dominant axis) plus the target for logging.
const findShore = (
	bot: any,
): { dir: [number, number]; target: { x: number; y: number; z: number } } | null => {
	const p = bot.entity?.position;
	if (!p) return null;
	const cx = Math.floor(p.x);
	const cy = Math.floor(p.y);
	const cz = Math.floor(p.z);
	let best: { x: number; y: number; z: number; dx: number; dz: number } | null =
		null;
	let bestD = Infinity;
	const R = 14;
	for (let dx = -R; dx <= R; dx++) {
		for (let dz = -R; dz <= R; dz++) {
			if (dx === 0 && dz === 0) continue;
			const x = cx + dx;
			const z = cz + dz;
			for (let y = cy + 6; y >= cy; y--) {
				const g = getBlock(bot, vec3(x, y, z));
				if (!isSolid(g)) continue;
				// A shore is solid AT/ABOVE our feet (y>=cy) with walkable air on top.
				if (isSolid(getBlock(bot, vec3(x, y + 1, z)))) break;
				const d = Math.abs(dx) + Math.abs(dz) + Math.abs(y + 1 - cy);
				if (d < bestD) {
					bestD = d;
					best = { x, y, z, dx, dz };
				}
				break;
			}
		}
	}
	if (!best) return null;
	const dir: [number, number] =
		Math.abs(best.dx) >= Math.abs(best.dz)
			? [Math.sign(best.dx) || 1, 0]
			: [0, Math.sign(best.dz) || 1];
	return { dir, target: { x: best.x, y: best.y, z: best.z } };
};

export const escape = async (bot: any): Promise<void> => {
	const t0 = Date.now();
	const BUDGET = 70000;

	await ground(bot);
	let shore = findShore(bot);
	// No shore found in range → fall back to the first diggable wall cardinal so we at
	// least start carving; a re-scan below will correct once we've moved.
	let dir: [number, number] = shore?.dir ?? [1, 0];
	if (!shore) {
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		const cards: [number, number][] = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		];
		dir =
			cards.find(([dx, dz]) => diggable(getBlock(bot, vec3(fx + dx, fy, fz + dz)))) ??
			[1, 0];
	}
	console.log(
		`stair-shore: committed dir=${dir[0]},${dir[1]} target=${JSON.stringify(shore?.target ?? null)}`,
	);

	let bestY = Math.floor(bot.entity.position.y);
	let anchorX = bot.entity.position.x;
	let anchorZ = bot.entity.position.z;
	let lastProgress = Date.now();

	while (Date.now() - t0 < BUDGET) {
		// Completion — STOP IN PLACE the instant we're genuinely dry. Don't push
		// forward here: this shore is a long shallow beach, and any extra forward drive
		// once dry marches the bot straight off the sand into the next inland pond.
		// isOnDryLand already rejects a bob over deep water (it demands onGround + solid
		// support + no water at head), so settle a beat and re-confirm, then quit.
		if (isOnDryLand(bot)) {
			bot.clearControlStates();
			await sleep(500);
			if (isOnDryLand(bot)) {
				console.log(`stair-shore: ON DRY LAND after ${Date.now() - t0}ms`);
				return;
			}
		}

		await ground(bot);
		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		const [dx, dz] = dir;

		const aheadStep = getBlock(bot, vec3(fx + dx, fy, fz + dz)); // left as the stair
		const aheadHead = getBlock(bot, vec3(fx + dx, fy + 1, fz + dz));
		const aheadTop = getBlock(bot, vec3(fx + dx, fy + 2, fz + dz));
		console.log(
			`stair-shore: at ${fx},${fy},${fz} og=${bot.entity.onGround} step=${aheadStep?.name} head=${aheadHead?.name} top=${aheadTop?.name}`,
		);

		// Clear our own headroom so the impulse has room to lift us, then cut the step
		// ahead (head-height + above), leaving aheadStep as the block we climb onto.
		await digAt(bot, getBlock(bot, vec3(fx, fy + 1, fz)));
		await digAt(bot, getBlock(bot, vec3(fx, fy + 2, fz)));
		await digAt(bot, aheadHead);
		await digAt(bot, aheadTop);

		// Press INTO the bank: forward gives the outOfLiquidImpulse that hops us up the
		// cut step. Hold jump ONLY while submerged (it's ignored underwater but fires the
		// final hop the instant we surface) — NOT on land, where a held jump bunny-hops
		// the bot so onGround never registers and it sails straight across a dry beach
		// into the next pond, never latching isOnDryLand. Poll for dry land every 100ms
		// through the burst so we stop the moment we hit a narrow grass strip.
		await bot.lookAt(vec3(fx + dx + 0.5, fy + 1, fz + dz + 0.5), true);
		bot.setControlState("forward", true);
		if (bot.entity.isInWater) bot.setControlState("jump", true);
		for (let t = 0; t < 8; t++) {
			await sleep(90);
			if (isOnDryLand(bot)) {
				bot.clearControlStates();
				await sleep(400);
				if (isOnDryLand(bot)) {
					console.log(`stair-shore: ON DRY LAND after ${Date.now() - t0}ms`);
					return;
				}
				break;
			}
			// Drop jump as soon as our head clears the surface so we settle onto land.
			if (!bot.entity.isInWater) bot.setControlState("jump", false);
		}
		bot.clearControlStates();

		const np = bot.entity.position;
		const ny = Math.floor(np.y);
		const moved = Math.hypot(np.x - anchorX, np.z - anchorZ);
		if (ny > bestY || moved > 1.5) {
			bestY = Math.max(bestY, ny);
			anchorX = np.x;
			anchorZ = np.z;
			lastProgress = Date.now();
		} else if (Date.now() - lastProgress > 12000) {
			// Truly stuck on this heading — the initial shore pick may have been wrong.
			// Re-scan ONCE-in-a-while (not every tick) and re-commit.
			const s2 = findShore(bot);
			if (s2) {
				dir = s2.dir;
				console.log(
					`stair-shore: RE-COMMIT dir=${dir[0]},${dir[1]} target=${JSON.stringify(s2.target)}`,
				);
			}
			lastProgress = Date.now();
		}
	}

	bot.clearControlStates();
	console.log(`stair-shore: gave up after ${Date.now() - t0}ms`);
};
