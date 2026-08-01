/**
 * Obsidian casting + nether portal building with buckets (no diamond pickaxe).
 *
 * Each obsidian block is cast in place: a fully-enclosed 1-block cup holds a lava
 * source, then water poured into the block directly above flows down and turns it
 * to obsidian. The cup contains the lava so it never reaches the bot. The portal
 * frame is cast bottom-up so each block sits on the (already solid) one below.
 *
 * Key 26.1.2 fix: bot.activateItem() leaves bot.usingHeldItem stuck `true`, which
 * silently blocks every subsequent bucket use. reliableUse() clears it each time.
 */

import type { Bot } from "typecraft";
import { distance, offset, vec3, type Vec3 } from "typecraft";
import { getBlock, goTo, sleep, walkToXZ } from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";
import type { Block, StepResult } from "../../types.ts";

const isAir = (n?: string): boolean => !n || n === "air" || n === "cave_air";
const SOFT = new Set([
	"short_grass",
	"tall_grass",
	"fern",
	"snow",
	"snow_layer",
	"dead_bush",
]);
const isReplaceable = (n?: string): boolean => isAir(n) || (!!n && SOFT.has(n));
const isSolid = (n?: string): boolean =>
	!!n && !isReplaceable(n) && !n.includes("water") && !n.includes("lava");

const equip = async (bot: Bot, name: string): Promise<boolean> => {
	// Prefer the item if it's already in the hotbar — selecting a hotbar slot is
	// reliable, whereas the click-move below is flaky and used to leave the wrong
	// item held (e.g. a pickaxe), so a place/use silently no-op'd.
	const hot = bot.inventory.slots.findIndex(
		(x, i) => i >= 36 && i <= 44 && x?.name === name,
	);
	if (hot >= 0) {
		bot.setQuickBarSlot(hot - 36);
		await sleep(120);
		return true;
	}
	const s = bot.inventory.slots.findIndex((x) => x?.name === name);
	if (s < 0) return false;
	try {
		await bot.clickWindow(s, 0, 0);
		await bot.clickWindow(36, 0, 0);
		bot.setQuickBarSlot(0);
	} catch {
		/* ignore */
	}
	await sleep(250);
	return true;
};

const count = (bot: Bot, name: string): number =>
	bot.inventory.slots
		.filter((s) => s?.name === name)
		.reduce((a, s) => a + (s as { count: number }).count, 0);

/**
 * Use the held item (a bucket) reliably. bot.activateItem() leaves usingHeldItem
 * set on 26.1.2, which blocks the next use — so deactivate and clear it.
 */
const reliableUse = async (bot: Bot, look: Vec3): Promise<void> => {
	await bot.lookAt(look);
	await sleep(350);
	bot.activateItem();
	await sleep(750);
	try {
		bot.deactivateItem();
	} catch {
		/* ignore */
	}
	(bot as unknown as { usingHeldItem: boolean }).usingHeldItem = false;
	await sleep(200);
};

/** Place a cobblestone block at `pos` (against any solid neighbour). */
const placeCobble = async (bot: Bot, pos: Vec3): Promise<boolean> => {
	if (isSolid(getBlock(bot, pos)?.name)) return true;
	if (!(await equip(bot, buildBlockName(bot)))) return false;
	const faces: Vec3[] = [
		vec3(0, -1, 0),
		vec3(1, 0, 0),
		vec3(-1, 0, 0),
		vec3(0, 0, 1),
		vec3(0, 0, -1),
		vec3(0, 1, 0),
	];
	for (const f of faces) {
		const ref = getBlock(bot, offset(pos, f.x, f.y, f.z));
		if (!ref || !isSolid(ref.name)) continue;
		try {
			await bot.placeBlockWithOptions(ref, vec3(-f.x, -f.y, -f.z), {
				forceLook: true,
			});
			await sleep(200);
			if (isSolid(getBlock(bot, pos)?.name)) return true;
		} catch {
			/* try next face */
		}
	}
	return false;
};

/** Place a block at `pos`, first building a foundation straight down to a solid
 *  block when `pos` floats in air with no neighbour to place against (e.g. a
 *  side-column's outer cup wall). */
const ensureSolid = async (
	bot: Bot,
	pos: Vec3,
	depth = 0,
): Promise<boolean> => {
	if (isSolid(getBlock(bot, pos)?.name)) return true;
	if (await placeCobble(bot, pos)) return true;
	if (depth >= 4) return false;
	if (await ensureSolid(bot, offset(pos, 0, -1, 0), depth + 1)) {
		return placeCobble(bot, pos);
	}
	return false;
};

/** Dig the block at `pos` (used to open the portal gap / remove molds). */
const digAt = async (bot: Bot, pos: Vec3): Promise<void> => {
	const b = getBlock(bot, pos) as Block | null;
	if (!b || isAir(b.name)) return;
	try {
		await bot.lookAt(offset(b.position, 0.5, 0.5, 0.5));
		await bot.dig(b as Block);
		await sleep(150);
	} catch {
		/* ignore */
	}
};

const feetY = (bot: Bot): number => Math.floor(bot.entity.position.y);

/** Dig straight down to bring the bot's feet to `targetFeetY` (removes a pillar). */
const descendToY = async (bot: Bot, targetFeetY: number): Promise<void> => {
	const s = bot.entity.position;
	for (let g = 0; g < 24 && feetY(bot) > targetFeetY; g++) {
		const p = bot.entity.position;
		const f = feetY(bot);
		// Dig every non-obsidian cell under the bot's footprint, not just the
		// centre cell — otherwise the bot wedges on an adjacent block and the
		// "descend" silently does nothing (the stuck-at-feet-75 bug).
		const cells: [number, number][] = [];
		for (const dx of [-0.3, 0.3]) {
			for (const dz of [-0.3, 0.3]) {
				const cx = Math.floor(p.x + dx);
				const cz = Math.floor(p.z + dz);
				if (!cells.some(([a, b]) => a === cx && b === cz)) cells.push([cx, cz]);
			}
		}
		for (const [cx, cz] of cells) {
			const b = getBlock(bot, vec3(cx, f - 1, cz));
			if (b && isSolid(b.name) && b.name !== "obsidian") {
				await digAt(bot, vec3(cx, f - 1, cz));
			}
		}
		await sleep(420);
	}
	const e = bot.entity.position;
	logEvent(
		"cast",
		"descend",
		`${s.x.toFixed(1)},${s.z.toFixed(1)}->${e.x.toFixed(1)},${e.z.toFixed(1)} feet=${feetY(bot)}`,
	);
};

/** The cheap building block we have most of (dirt preferred, then cobblestone). */
const buildBlockName = (bot: Bot): string =>
	count(bot, "dirt") > 0 ? "dirt" : "cobblestone";

/**
 * Walk in a straight line toward (tx, tz) at ground level, digging any
 * non-obsidian block directly in the way. Bounded to a few blocks — never
 * wanders off across the arena like the A* pathfinder does in a cluttered frame.
 */
const shuffleTo = async (bot: Bot, tx: number, tz: number): Promise<void> => {
	bot.setControlState("sneak", false);
	bot.setControlState("jump", false);
	const s = bot.entity.position;
	let prevDist = Infinity;
	for (let i = 0; i < 48; i++) {
		const p = bot.entity.position;
		const dx = tx - p.x;
		const dz = tz - p.z;
		const dist = Math.hypot(dx, dz);
		if (dist < 0.3) break;
		// Dig any non-obsidian block one step ahead (feet + head height).
		const fx = Math.floor(p.x + (dx / dist) * 0.6);
		const fz = Math.floor(p.z + (dz / dist) * 0.6);
		const fy = Math.floor(p.y);
		for (const dy of [0, 1]) {
			const b = getBlock(bot, vec3(fx, fy + dy, fz));
			if (b && isSolid(b.name) && b.name !== "obsidian") {
				await digAt(bot, vec3(fx, fy + dy, fz));
			}
		}
		// Step toward the target in short bursts. Jump when not making progress
		// (climbs out of 1-deep holes) OR when in water (hold jump = swim up to the
		// surface so we can move out instead of bobbing helplessly). Bot floats in
		// water and the controls go sideways, so swimming up + forward is the only
		// reliable escape.
		const px = Math.floor(p.x);
		const pz = Math.floor(p.z);
		const feetN = getBlock(bot, vec3(px, Math.floor(p.y), pz))?.name;
		const headN = getBlock(bot, vec3(px, Math.floor(p.y) + 1, pz))?.name;
		const inWater =
			(feetN ?? "").includes("water") || (headN ?? "").includes("water");
		const stuck = dist > prevDist - 0.05;
		prevDist = dist;
		await bot.lookAt(vec3(tx, p.y, tz));
		bot.setControlState("forward", true);
		if (stuck || inWater) bot.setControlState("jump", true);
		await sleep(Math.min(200, dist * 220));
		bot.setControlState("jump", false);
		bot.setControlState("forward", false);
		await sleep(110);
	}
	bot.setControlState("forward", false);
	bot.setControlState("jump", false);
	const e = bot.entity.position;
	logEvent(
		"cast",
		"shuffle",
		`t=${tx.toFixed(1)},${tz.toFixed(1)} ${s.x.toFixed(1)},${s.z.toFixed(1)}->${e.x.toFixed(1)},${e.z.toFixed(1)}`,
	);
};

/**
 * Raise the bot's feet to `targetFeetY` by sneaking, looking straight down, and
 * placing a block underneath each jump. Sneaking stops the bot walking off the
 * 1-wide pillar — this reliably rises one block per iteration on 26.1.2.
 */
export const pillarUp = async (
	bot: Bot,
	targetFeetY: number,
): Promise<boolean> => {
	bot.setControlState("sneak", true);
	// Lock onto ONE cell (the one we start in) and re-center to its middle every
	// jump. Pillaring from a cell edge makes the placed block land in the wrong
	// column or fail (placing inside our own hitbox) — that's the "jumping in
	// place, never rising" stall seen at the higher columns.
	const cellX = Math.floor(bot.entity.position.x);
	const cellZ = Math.floor(bot.entity.position.z);
	try {
		for (let g = 0; g < 24 && feetY(bot) < targetFeetY; g++) {
			await walkToXZ(bot, cellX + 0.5, cellZ + 0.5, {
				targetDist: 0.15,
				maxTime: 900,
			});
			bot.setControlState("sneak", true); // walkToXZ clears it; re-arm for the jump
			const px = cellX;
			const pz = cellZ;
			const f = feetY(bot);
			// Validate + clear the climb path AHEAD (this cell, two blocks up) before
			// rising into it — the previous column's back wall / stray scaffold lands
			// in this column and otherwise blocks every jump (the stuck-jumping).
			for (const dy of [2, 3]) {
				const b = getBlock(bot, vec3(px, f + dy, pz));
				if (b && isSolid(b.name) && b.name !== "obsidian") {
					await digAt(bot, vec3(px, f + dy, pz));
				}
			}
			if (!(await equip(bot, buildBlockName(bot)))) break;
			await bot.lookAt(vec3(px + 0.5, f - 1.5, pz + 0.5));
			await sleep(150);
			bot.setControlState("jump", true);
			await sleep(380);
			const ref = getBlock(bot, vec3(px, f - 1, pz));
			try {
				if (ref && isSolid(ref.name)) await bot.placeBlock(ref, vec3(0, 1, 0));
			} catch {
				/* retry next loop */
			}
			await sleep(250);
			bot.setControlState("jump", false);
			await sleep(450);
			logEvent(
				"cast",
				"pillar_step",
				`g=${g} f=${f}->${feetY(bot)} placed=${getBlock(bot, vec3(px, f, pz))?.name} above2=${getBlock(bot, vec3(px, f + 2, pz))?.name} ref=${ref?.name} held=${bot.heldItem?.name}`,
			);
		}
	} finally {
		// Leave sneak ON — the caller clears it once the whole block is poured, so
		// the bot can't walk off the 1-wide pillar mid-build.
	}
	return feetY(bot) >= targetFeetY;
};

/**
 * Find the nearest fluid source the bot can actually SEE — no X-ray. Uses
 * bot.findBlocks, whose default `exposed` requires both an exposed face and an
 * unobstructed line-of-sight raycast (canSeeBlock), so a pool behind rock is
 * invisible until the bot physically digs through to it. Prefers a source with
 * air directly above (pourable / scoopable surface).
 */
const findFluidSource = (
	bot: Bot,
	fluid: "water" | "lava",
	maxDistance = 30,
): Vec3 | null => {
	const positions = bot.findBlocks({
		matching: (n: string) => n === fluid,
		maxDistance,
		count: 64,
	});
	if (positions.length === 0) return null;
	const withAir = positions.filter((p) =>
		isAir(getBlock(bot, vec3(p.x, p.y + 1, p.z))?.name),
	);
	const pick = withAir.length ? withAir : positions;
	const o = bot.entity.position;
	let best: Vec3 | null = null;
	let bestD = Infinity;
	for (const p of pick) {
		const d = distance(o, vec3(p.x, p.y, p.z));
		if (d < bestD) {
			bestD = d;
			best = vec3(p.x, p.y, p.z);
		}
	}
	return best;
};

/** Find a nearby fluid source and fill an empty bucket from it. */
const fillBucket = async (
	bot: Bot,
	fluid: "water" | "lava",
): Promise<boolean> => {
	if (count(bot, "bucket") < 1) return false;
	const src = findFluidSource(bot, fluid, 24);
	if (!src) return false;
	// Stand on solid footing BESIDE the source (never on top — lava would burn).
	let stand: Vec3 | null = null;
	for (const [dx, dz] of [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	] as const) {
		const floor = getBlock(bot, vec3(src.x + dx, src.y, src.z + dz));
		const feet = getBlock(bot, vec3(src.x + dx, src.y + 1, src.z + dz));
		const head = getBlock(bot, vec3(src.x + dx, src.y + 2, src.z + dz));
		if (isSolid(floor?.name) && isAir(feet?.name) && isAir(head?.name)) {
			stand = vec3(src.x + dx + 0.5, src.y + 1, src.z + dz + 0.5);
			break;
		}
	}
	// The old fallback stood ON the source — fine for water, but for lava it drops
	// the bot in to burn while the safety guard yanks it back out and we walk in
	// again: a hang. With no safe footing beside lava, give up rather than stand on
	// it. (Water doesn't burn, so the above-spot fallback is still fine there.)
	if (!stand) {
		if (fluid === "lava") {
			logEvent("cast", "fill_no_safe_spot", `lava ${src.x},${src.y},${src.z}`);
			return false;
		}
		stand = vec3(src.x + 0.5, src.y + 1, src.z + 0.5);
	}
	if (
		Math.hypot(
			bot.entity.position.x - stand.x,
			bot.entity.position.y - stand.y,
			bot.entity.position.z - stand.z,
		) > 1.4
	) {
		await goTo(bot, stand, { range: 0, timeout: 15000 }).catch(() => {});
	}
	// Center precisely on the stand cell so the look hits the source, not a rim.
	await walkToXZ(bot, stand.x, stand.z, { targetDist: 0.4, maxTime: 2500 });
	if (!(await equip(bot, "bucket"))) return false;
	for (let i = 0; i < 6; i++) {
		// Aim at the source centre, alternating with a touch lower.
		const dy = i % 2 === 0 ? 0.5 : 0.1;
		await reliableUse(bot, vec3(src.x + 0.5, src.y + dy, src.z + 0.5));
		if (count(bot, `${fluid}_bucket`) > 0) {
			logEvent("cast", "filled", `${fluid}_bucket`);
			return true;
		}
	}
	logEvent("cast", "fill_fail", `${fluid} src ${src.x},${src.y},${src.z}`);
	return false;
};

/**
 * Cast one obsidian block at `pos`. Builds a fully-enclosed cup (4 sides + below
 * solid, top open), pours lava in, then water directly above (flows down onto the
 * lava → obsidian). Returns true once `pos` is obsidian.
 */
export const castObsidianAt = async (
	bot: Bot,
	pos: Vec3,
	baseY: number,
): Promise<boolean> => {
	if (getBlock(bot, pos)?.name === "obsidian") return true;
	// Stand 1 block in front (on the pillar top, which doubles as the cup's near
	// wall) and look DOWN past it into the cup — matching the validated geometry.
	// Standing 2 out lets the near wall occlude the pour.
	const standZ = pos.z + 1;
	const above = offset(pos, 0, 1, 0);

	for (let attempt = 0; attempt < 3; attempt++) {
		// 1. Top up both buckets FIRST — fillBucket walks to the source (several
		//    blocks away), so do it before we position at the cup.
		if (count(bot, "lava_bucket") < 1 && !(await fillBucket(bot, "lava")))
			return false;
		if (count(bot, "water_bucket") < 1 && !(await fillBucket(bot, "water")))
			return false;

		// 2. Position: pathfind to the floor spot in front, then pillar up. Clear
		//    sneak first so navigation isn't slowed; pillarUp re-enables it and
		//    leaves it on through cup-building + pouring (no drift off the pillar).
		//    Retry + verify — in the cluttered frame the bot can drift, and a
		//    mispositioned pillar misplaces the whole cup.
		bot.setControlState("sneak", false);
		const off = () =>
			Math.abs(bot.entity.position.x - (pos.x + 0.5)) +
			Math.abs(bot.entity.position.z - (standZ + 0.5));
		// Always pathfind back to the floor base spot first. After casting the
		// previous block the bot is on a high pillar and often shoved onto clutter
		// where the manual descend wedges — the A* pathfinder reliably digs down
		// off any perch and routes around blocks to the open floor in front.
		await goTo(bot, vec3(pos.x, baseY, standZ), {
			range: 1,
			timeout: 15000,
		}).catch(() => {});
		for (let p = 0; p < 4 && off() > 0.6; p++) {
			await descendToY(bot, baseY);
			await shuffleTo(bot, pos.x + 0.5, standZ + 0.5);
		}
		// FLOAT GUARD: if the bot ended up far from the spot (it got shoved/floated),
		// don't keep stabbing at the block from across the arena. Warn, do ONE clean
		// recovery via an open staging spot, and if that still can't reach it, give
		// up on this block so the caller reassesses — never hammer from far away.
		if (off() > 1.0) {
			logEvent(
				"cast",
				"floated",
				`${pos.x},${pos.y},${pos.z} off=${off().toFixed(1)} — reassessing`,
			);
			bot.setControlState("forward", false);
			bot.setControlState("jump", false);
			bot.setControlState("sneak", false);
			await goTo(bot, vec3(pos.x, baseY, standZ + 3), {
				range: 1,
				timeout: 18000,
			}).catch(() => {});
			await descendToY(bot, baseY);
			await shuffleTo(bot, pos.x + 0.5, standZ + 0.5);
		}
		if (off() > 1.0) {
			logEvent("cast", "pos_fail", `${pos.x},${pos.y},${pos.z} off=${off().toFixed(1)}`);
			bot.setControlState("sneak", false);
			return false;
		}
		// Elevate to feet = pos.y (the CUP level) first, so the cup walls sit at
		// the bot's own feet level — an easy same-level reach, not an awkward
		// reach down-and-over from a block higher.
		if (feetY(bot) < pos.y && !(await pillarUp(bot, pos.y))) {
			logEvent("cast", "pillar_fail", `${pos.x},${pos.y},${pos.z} feet=${feetY(bot)}`);
			continue;
		}

		// 3. Build the cup walls (E, W, N, below). The +Z wall is the pillar the
		//    bot stands on to pour — placed by the final pillar-up below.
		let cupOk = true;
		for (const s of [
			offset(pos, 1, 0, 0),
			offset(pos, -1, 0, 0),
			offset(pos, 0, 0, -1),
			offset(pos, 0, -1, 0),
		]) {
			if (!isSolid(getBlock(bot, s)?.name) && !(await ensureSolid(bot, s))) {
				logEvent("cast", "cup_fail", `${s.x},${s.y},${s.z}`);
				cupOk = false;
				break;
			}
		}
		if (!cupOk) continue;
		// Wall in the WATER BOWL one level up (pos.y+1): E, W, and N (backing). The
		// +Z back wall is placed by the final pillar-up — the bot stands ON it, so
		// all four bowl walls are solid blocks (not the bot's body, which fluid
		// flows through). A fully-sealed bowl holds the poured water as a STILL
		// source: it makes the obsidian and never spreads, so nothing floods the
		// next block or shoves the bot. (Validated.)
		await ensureSolid(bot, offset(pos, 1, 1, 0));
		await ensureSolid(bot, offset(pos, -1, 1, 0));
		await ensureSolid(bot, offset(pos, 0, 1, -1));

		// Re-center on the pillar so the next pillar-up drops the +Z wall at the
		// exact cell (any drift during cup-building would misplace it).
		await walkToXZ(bot, pos.x + 0.5, standZ + 0.5, {
			targetDist: 0.25,
			maxTime: 1500,
		});
		// Pillar one more to feet = pos.y+1 (pour height); drops the +Z cup wall.
		if (feetY(bot) < pos.y + 1 && !(await pillarUp(bot, pos.y + 1))) {
			logEvent("cast", "pillar_fail", `${pos.x},${pos.y},${pos.z} feet=${feetY(bot)}`);
			continue;
		}
		if (!isAir(getBlock(bot, pos)?.name)) await digAt(bot, pos);
		if (!isAir(getBlock(bot, above)?.name)) await digAt(bot, above);
		// Re-center on the pillar before pouring (sneak-walk keeps us on it).
		await walkToXZ(bot, pos.x + 0.5, standZ + 0.5, {
			targetDist: 0.3,
			maxTime: 1500,
		});

		// Cup state before pouring: the 5 walls (E,W,S=+Z,N=-Z,below).
		const walls = [
			offset(pos, 1, 0, 0),
			offset(pos, -1, 0, 0),
			offset(pos, 0, 0, 1),
			offset(pos, 0, 0, -1),
			offset(pos, 0, -1, 0),
		];
		const checkCup = () =>
			walls.map((s) => (isSolid(getBlock(bot, s)?.name) ? "S" : "_")).join("");
		let cupState = checkCup();
		if (cupState !== "SSSSS") {
			// Usually only the +Z wall (the one the bot stands on) slipped a cell.
			// Place any missing wall explicitly and re-center onto it, rather than
			// re-navigating (which drifts further).
			for (let i = 0; i < walls.length; i++) {
				const w = walls[i];
				if (w && cupState[i] === "_") await ensureSolid(bot, w);
			}
			await walkToXZ(bot, pos.x + 0.5, standZ + 0.5, {
				targetDist: 0.3,
				maxTime: 1500,
			});
			cupState = checkCup();
		}

		// SAFETY GATE: never pour lava into a cup that isn't fully enclosed —
		// a missing wall lets lava escape and kill the bot. Rebuild and retry.
		if (cupState !== "SSSSS") {
			logEvent("cast", "cup_leak", `${pos.x},${pos.y},${pos.z} cup=${cupState}`);
			continue;
		}

		// 4. Pour LAVA into the cup from feet pos.y+1 — do this BEFORE the +Z bowl
		//    wall exists, so it can't occlude the low aim. Stand precisely first
		//    (the placement is reliable from the exact spot with a full bucket).
		await walkToXZ(bot, pos.x + 0.5, standZ + 0.5, {
			targetDist: 0.15,
			maxTime: 2500,
		});
		const bp = bot.entity.position;
		logEvent(
			"cast",
			"pre_pour",
			`${pos.x},${pos.y},${pos.z} bot=${bp.x.toFixed(2)},${bp.z.toFixed(2)} feet=${feetY(bot)}`,
		);
		await equip(bot, "lava_bucket");
		await reliableUse(bot, vec3(pos.x + 0.5, pos.y + 0.2, pos.z + 0.5));
		await sleep(400);
		const afterLava = getBlock(bot, pos)?.name ?? "?";

		// 5. Seal the water bowl: pillar one more onto the +Z bowl wall (feet =
		//    pos.y+2). Now every bowl wall (pos.y+1) is a solid block, so the water
		//    we pour next is a STILL source — it can't flow out and shove us.
		if (feetY(bot) < pos.y + 2 && !(await pillarUp(bot, pos.y + 2))) {
			logEvent("cast", "pillar_fail", `${pos.x},${pos.y},${pos.z} feet=${feetY(bot)}`);
			continue;
		}
		await walkToXZ(bot, pos.x + 0.5, standZ + 0.5, {
			targetDist: 0.2,
			maxTime: 2000,
		});

		// BOWL-SEAL GATE: only pour water if all 4 bowl walls (E,W,N,+Z) are solid.
		// The +Z wall is the block the bot stands on; if it drifted off it, that
		// wall is missing and the water would escape and shove the bot ("float
		// away"). Fix any missing wall, re-center, re-check; bail the block if still
		// open rather than pouring into a leaky bowl.
		const bowlWalls = [
			offset(pos, 1, 1, 0),
			offset(pos, -1, 1, 0),
			offset(pos, 0, 1, -1),
			offset(pos, 0, 1, 1),
		];
		const checkBowl = () =>
			bowlWalls
				.map((s) => (isSolid(getBlock(bot, s)?.name) ? "S" : "_"))
				.join("");
		let bowlState = checkBowl();
		if (bowlState !== "SSSS") {
			for (let i = 0; i < bowlWalls.length; i++) {
				const w = bowlWalls[i];
				if (w && bowlState[i] === "_") await ensureSolid(bot, w);
			}
			await walkToXZ(bot, pos.x + 0.5, standZ + 0.5, {
				targetDist: 0.2,
				maxTime: 2000,
			});
			bowlState = checkBowl();
		}
		if (bowlState !== "SSSS") {
			logEvent("cast", "bowl_leak", `${pos.x},${pos.y},${pos.z} bowl=${bowlState}`);
			continue;
		}

		// 6. Pour WATER into the sealed bowl, aimed at its far (-Z) side. It sits as
		//    a still source, converts the lava below → obsidian, and never spreads.
		//    Keep sneaking so we don't slip off the narrow back wall, and log the
		//    exact pour position to verify we're centred at feet pos.y+2.
		bot.setControlState("sneak", true);
		const wp = bot.entity.position;
		logEvent(
			"cast",
			"pre_water",
			`bot=${wp.x.toFixed(2)},${wp.z.toFixed(2)} f=${feetY(bot)} cup=${getBlock(bot, pos)?.name} bowl=${getBlock(bot, above)?.name} held=${bot.heldItem?.name}`,
		);
		await equip(bot, "water_bucket");
		await reliableUse(bot, vec3(pos.x + 0.5, pos.y + 1.5, pos.z + 0.15));
		await sleep(300);
		logEvent(
			"cast",
			"post_water",
			`cup=${getBlock(bot, pos)?.name} bowl=${getBlock(bot, above)?.name} aboveBowl=${getBlock(bot, offset(pos, 0, 2, 0))?.name}`,
		);
		await sleep(400);
		const afterWater = getBlock(bot, pos)?.name ?? "?";

		// 7. Pick the water back up — it's a fixed, contained source, so the fill is
		//    reliable; this reuses the bucket for the next block. If anything
		//    lingers, cap the bowl with a block as a fallback.
		await equip(bot, "bucket");
		for (let k = 0; k < 4; k++) {
			if (!(getBlock(bot, above)?.name ?? "").includes("water")) break;
			await reliableUse(bot, vec3(above.x + 0.5, above.y + 0.5, above.z + 0.5));
		}
		if ((getBlock(bot, above)?.name ?? "").includes("water")) {
			await equip(bot, buildBlockName(bot));
			const obsRef = getBlock(bot, pos);
			if (obsRef?.name === "obsidian") {
				try {
					await bot.placeBlock(obsRef, vec3(0, 1, 0));
				} catch {}
			}
		}

		if (getBlock(bot, pos)?.name === "obsidian" || afterWater === "obsidian") {
			logEvent("cast", "obsidian", `${pos.x},${pos.y},${pos.z}`);
			bot.setControlState("sneak", false);
			return true;
		}
		logEvent(
			"cast",
			"miss",
			`${pos.x},${pos.y},${pos.z} cup=${cupState} lava=${afterLava} water=${afterWater}`,
		);
	}
	bot.setControlState("sneak", false);
	return false;
};

/**
 * Build the solid backing wall (z = bz-1, 4 wide x 5 tall) behind the frame so
 * every cup's far (-Z) wall is pre-provided. Each column is built from directly
 * behind it (1-block placement) so the bot never needs the awkward 2-block far
 * reach that stalls per-block cup building.
 */
const buildBacking = async (
	bot: Bot,
	bx: number,
	by: number,
	bz: number,
): Promise<void> => {
	for (let dx = 0; dx <= 3; dx++) {
		const colX = bx + dx;
		bot.setControlState("sneak", false); // navigation phase
		await descendToY(bot, by);
		await goTo(bot, vec3(colX, by, bz - 2), {
			range: 1,
			timeout: 12000,
		}).catch(() => {});
		await walkToXZ(bot, colX + 0.5, bz - 2 + 0.5, {
			targetDist: 0.5,
			maxTime: 2500,
		});
		for (let dy = 0; dy <= 4; dy++) {
			const h = by + dy;
			if (feetY(bot) < h && !(await pillarUp(bot, h))) break;
			await placeCobble(bot, vec3(colX, h, bz - 1));
		}
	}
	bot.setControlState("sneak", false);
	await descendToY(bot, by);
};

/**
 * Temporarily fill the 2x3 interior gap (dirt at z = bz, x = bx+1..bx+2, rows
 * by+1..by+3) BEFORE casting, so each side-column cup already has its hard-to-
 * reach interior wall, and the top row has support to rest on. Built from the
 * front working line (1-block reach) and dug back out after casting.
 */
const buildInnerFill = async (
	bot: Bot,
	bx: number,
	by: number,
	bz: number,
): Promise<void> => {
	for (const dx of [1, 2]) {
		const colX = bx + dx;
		bot.setControlState("sneak", false);
		await descendToY(bot, by);
		await goTo(bot, vec3(colX, by, bz + 1), {
			range: 1,
			timeout: 12000,
		}).catch(() => {});
		await walkToXZ(bot, colX + 0.5, bz + 1 + 0.5, {
			targetDist: 0.5,
			maxTime: 2500,
		});
		for (let dy = 1; dy <= 3; dy++) {
			const h = by + dy;
			if (feetY(bot) < h && !(await pillarUp(bot, h))) break;
			await placeCobble(bot, vec3(colX, h, bz));
		}
	}
	bot.setControlState("sneak", false);
	await descendToY(bot, by);
};

const isLava = (n?: string): boolean => n === "lava" || n === "flowing_lava";

/**
 * Prepare a flat, cleared casting site next to a lava pool — the natural-race
 * equivalent of the sandbox `/fill` arena, built by hand (no cheats):
 *   1. find a lava pool (dig down toward cave lava if none nearby)
 *   2. stand a few blocks back from it and clear a 6x6x5 chamber with a solid
 *      floor (digging yields the cobble the scaffold needs)
 *   3. top up 1 lava bucket from the pool (the bot refills it again each cast,
 *      so it never needs 10 buckets / 30 iron — just 1 + the pool)
 * Water is renewable and the sealed-bowl cast reuses its single bucket, so the
 * bot only carries 1 water bucket; the pool is what matters here.
 */
export const prepareCastSite = async (bot: Bot): Promise<StepResult> => {
	const deadline = Date.now() + 6 * 60_000;
	const findLava = (): Vec3 | null => findFluidSource(bot, "lava", 30);

	// 1. Locate a lava pool the bot can actually see. If none, descend toward
	//    cave-lava depth and branch-mine to open walls until lava comes into
	//    line-of-sight — never peeking through rock.
	let lava = findLava();
	if (!lava) {
		const { descendStaircase, branchMineExplore } = await import(
			"../mining/main.ts"
		);
		for (let pass = 0; pass < 8 && !lava && Date.now() < deadline; pass++) {
			const budget = Math.min(deadline, Date.now() + 60_000);
			if (Math.floor(bot.entity.position.y) > 13) {
				await descendStaircase(bot, 12, budget);
			} else {
				await branchMineExplore(bot, budget);
			}
			lava = findLava();
		}
	}
	if (!lava) return { success: false, message: "No lava pool found to cast at" };

	// 2. Stand a safe ~5 blocks back from the lava on the dominant axis so the
	//    cleared chamber sits between us and the pool (well within fill range).
	bot.setControlState("sneak", false);
	const p0 = bot.entity.position;
	const dx = Math.sign(p0.x - (lava.x + 0.5)) || 1;
	const dz = Math.sign(p0.z - (lava.z + 0.5)) || 1;
	const standSpot =
		Math.abs(p0.x - lava.x) >= Math.abs(p0.z - lava.z)
			? vec3(lava.x + dx * 5, lava.y, lava.z)
			: vec3(lava.x, lava.y, lava.z + dz * 5);
	await goTo(bot, standSpot, { range: 1, timeout: 20000 }).catch(() => {});

	const bx = Math.floor(bot.entity.position.x);
	const by = Math.floor(bot.entity.position.y);
	const bz = Math.floor(bot.entity.position.z);
	logEvent(
		"cast",
		"site_anchor",
		`${bx},${by},${bz} lava=${lava.x},${lava.y},${lava.z}`,
	);

	// 3. Clear a flat chamber (frame box + scaffold) and lay a solid floor.
	//    Never dig lava or a block touching it — that would flood/kill the bot.
	const lavaTouching = (c: Vec3): boolean =>
		(
			[
				[0, 0, 0],
				[1, 0, 0],
				[-1, 0, 0],
				[0, 1, 0],
				[0, -1, 0],
				[0, 0, 1],
				[0, 0, -1],
			] as const
		).some(([ax, ay, az]) =>
			isLava(getBlock(bot, vec3(c.x + ax, c.y + ay, c.z + az))?.name),
		);
	// The box must cover not just the frame + bot's working line but the cast's
	// staging-recovery spot (standZ+3 = bz+4) and the stand height for the top row
	// (feet = by+6). In open/surface terrain the extra space is already air; in a
	// real cleared cave it has to be dug, or the recovery hits rock and stalls.
	for (let y = 0; y <= 6; y++) {
		for (let x = -1; x <= 4; x++) {
			for (let z = -1; z <= 5; z++) {
				if (Date.now() > deadline)
					return { success: false, message: "Site prep timed out" };
				const c = vec3(bx + x, by + y, bz + z);
				const b = getBlock(bot, c);
				if (b && isSolid(b.name) && b.name !== "obsidian" && !lavaTouching(c)) {
					await digAt(bot, c);
				}
			}
		}
	}
	for (let x = -1; x <= 4; x++) {
		for (let z = -1; z <= 5; z++) {
			const f = vec3(bx + x, by - 1, bz + z);
			if (!isSolid(getBlock(bot, f)?.name) && !lavaTouching(f))
				await ensureSolid(bot, f);
		}
	}

	// 4. Top up a lava bucket from the pool (refilled again every cast).
	if (count(bot, "lava_bucket") < 1 && count(bot, "bucket") >= 1)
		await fillBucket(bot, "lava");

	// 5. Stand on the build anchor.
	await goTo(bot, vec3(bx + 0.5, by, bz + 0.5), {
		range: 0,
		timeout: 10000,
	}).catch(() => {});
	const lavaOk = count(bot, "lava_bucket") >= 1;
	logEvent("cast", lavaOk ? "site_ready" : "site_no_lava", `${bx},${by},${bz}`);
	return {
		success: lavaOk,
		message: lavaOk
			? `Cast site cleared at ${bx},${by},${bz} with lava bucket`
			: "Site cleared but no lava bucket — pool unreachable",
	};
};

/**
 * Build a nether portal frame (4x5, 10 obsidian, no corners) by casting it in
 * place. Builds a solid backing wall, casts the frame bottom-up (each block in a
 * dirt cup, lava + water from above → obsidian), digs the 2x3 gap, then lights it.
 */
export const buildPortalByCasting = async (bot: Bot): Promise<StepResult> => {
	// Already standing in a built frame?
	const existing = bot.findBlocks({
		matching: (n: string) => n === "obsidian",
		maxDistance: 8,
		count: 12,
	});
	if (existing.length >= 10) {
		return { success: true, message: "Obsidian frame already present" };
	}

	const buildStock = count(bot, "dirt") + count(bot, "cobblestone");
	if (buildStock < 30) {
		return {
			success: false,
			message: `Need ~30 dirt/cobble to pillar + mould the cast (have ${buildStock})`,
		};
	}
	if (count(bot, "lava_bucket") < 1) {
		return { success: false, message: "Need a lava bucket to cast obsidian" };
	}
	if (count(bot, "water_bucket") + count(bot, "bucket") < 1) {
		return { success: false, message: "Need a water bucket to cast obsidian" };
	}

	// Frame anchored at the bot's feet level, in the X-Y plane (1 thick in Z), so
	// the bottom row sits one block ABOVE the floor — free-standing air, not
	// recessed in the floor (which would occlude the dig). Columns x:0..3, rows
	// y:0..4, perimeter without corners. Each block's cup is built per-block by
	// castObsidianAt as the bot pillars up — no upfront wall.
	const bx = Math.floor(bot.entity.position.x);
	const by = Math.floor(bot.entity.position.y);
	const bz = Math.floor(bot.entity.position.z);
	const at = (dx: number, dy: number): Vec3 => vec3(bx + dx, by + dy, bz);

	const frame: Vec3[] = [];
	frame.push(at(1, 0), at(2, 0)); // bottom
	for (let dy = 1; dy <= 3; dy++) frame.push(at(0, dy)); // left column
	for (let dy = 1; dy <= 3; dy++) frame.push(at(3, dy)); // right column
	frame.push(at(1, 4), at(2, 4)); // top
	// Keep the push order (bottom row, then LEFT column bottom-up, then RIGHT
	// column, then top) rather than sorting by height. A y-sort interleaves the
	// columns, so the bot leaps across the whole frame (off≈3) on every block and
	// stalls in the cross-frame shuffle. Each column is still cast bottom-up; the
	// columns are free-standing, so left-before-right is structurally fine. The
	// thresholds stay at their proven 1.0 (don't bundle this with that change).

	const innerGap: Vec3[] = [];
	for (let dx = 1; dx <= 2; dx++) {
		for (let dy = 1; dy <= 3; dy++) innerGap.push(at(dx, dy));
	}

	logEvent("cast", "portal_start", `frame at ${bx},${by},${bz}`);
	await buildBacking(bot, bx, by, bz);
	let cast = 0;
	const castOne = async (pos: Vec3): Promise<StepResult | null> => {
		if (await castObsidianAt(bot, pos, by)) {
			cast++;
			return null;
		}
		logEvent("cast", "block_fail", `${pos.x},${pos.y},${pos.z} (${cast}/10)`);
		return {
			success: false,
			message: `Cast ${cast}/10 obsidian — stuck at ${pos.x},${pos.y},${pos.z}`,
		};
	};
	// Cast the BOTTOM ROW first: each block's water bowl (one block above it)
	// occupies a cell the inner fill would otherwise fill, so the fill must come
	// after. Then build the inner fill (interior walls for the side columns) and
	// cast the remaining rows bottom-up.
	for (const pos of frame.filter((p) => p.y === by)) {
		const fail = await castOne(pos);
		if (fail) return fail;
	}
	await buildInnerFill(bot, bx, by, bz);
	for (const pos of frame.filter((p) => p.y > by)) {
		const fail = await castOne(pos);
		if (fail) return fail;
	}

	// Open the inner 2x3 gap (removes cup walls that face the interior) and clear
	// the +Z approach so we can walk into the portal mouth. NEVER dig obsidian —
	// an iron pickaxe can't break it and digAt would hang (the post-cast stall).
	await descendToY(bot, by);
	const digIfNotObsidian = async (p: Vec3) => {
		if (getBlock(bot, p)?.name !== "obsidian") await digAt(bot, p);
	};
	for (const g of innerGap) await digIfNotObsidian(g);
	for (let dy = 1; dy <= 3; dy++) {
		for (let dx = 1; dx <= 2; dx++)
			await digIfNotObsidian(vec3(bx + dx, by + dy, bz + 1));
	}

	// Verify the 10 known frame cells directly (getBlock is reliable; findBlocks
	// returned a stale count and falsely failed a complete frame).
	const present = frame.filter((p) => getBlock(bot, p)?.name === "obsidian").length;
	logEvent("cast", "frame_check", `${present}/10 obsidian present`);
	if (present < 10)
		return { success: false, message: `Only ${present}/10 obsidian present` };

	// Light it: flint & steel on a bottom frame block's top face puts fire inside
	// the frame and ignites the portal.
	let portalPos: { x: number; y: number; z: number } | null = null;
	if (count(bot, "flint_and_steel") >= 1) {
		for (const lit of [at(1, 0), at(2, 0)]) {
			await goTo(bot, vec3(lit.x, by, bz + 2), {
				range: 1,
				timeout: 8000,
			}).catch(() => {});
			await equip(bot, "flint_and_steel");
			try {
				await bot.activateBlock(vec3(lit.x, lit.y, lit.z), vec3(0, 1, 0));
			} catch {
				/* ignore */
			}
			await sleep(1200);
			const inner = at(1, 1);
			if (getBlock(bot, inner)?.name === "nether_portal") {
				portalPos = { x: inner.x, y: inner.y, z: inner.z };
				break;
			}
		}
	}
	logEvent("cast", portalPos ? "portal_lit" : "portal_unlit", `${bx},${by},${bz}`);
	if (!portalPos) {
		return {
			success: false,
			message: `Frame cast (${present}/10) but portal not lit`,
		};
	}
	return {
		success: true,
		message: `Nether portal cast & lit at ${portalPos.x},${portalPos.y},${portalPos.z}`,
		portalPos,
	} as StepResult & { portalPos: { x: number; y: number; z: number } };
};
