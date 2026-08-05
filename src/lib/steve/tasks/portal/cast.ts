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
import {
	getBlock,
	getRememberedResource,
	goTo,
	sleep,
	walkToXZ,
} from "../../lib/bot-utils.ts";
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
		// Cap the dig: bot.dig can hang indefinitely if the server never acks the break
		// (seen wedging the lava strip-miner for minutes on a single block). Time it out
		// so the caller loop keeps moving/covering ground instead of freezing.
		await Promise.race([
			bot.dig(b as Block),
			sleep(6000).then(() => {
				bot.stopDigging?.();
			}),
		]);
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
		// exposed:false skips typecraft's DEFAULT exposed filter — which requires
		// bot.canSeeBlock() line-of-sight from the bot's EYE. That raycast fails beyond
		// ~a few dozen blocks (it grazes terrain), so surface lava the bot genuinely HAS in
		// its world model was being dropped and the bot descended past it. We do our OWN
		// air-neighbour exposed check below (no LOS), so far surface pools are found.
		exposed: false,
		// Large cap: findBlocks returns the N NEAREST matches, and our exposed-filter runs
		// AFTER. A small cap lets nearer ENCASED lava (e.g. inside a mountain at a high
		// spawn) crowd out the exposed surface pool we actually want, so grab plenty.
		count: 1024,
	});
	if (positions.length === 0) return null;
	// findBlocks (exposed:false) sees fluid THROUGH solid rock. Only EXPOSED sources (with
	// an air neighbour) are reachable/scoopable — targeting encased lava was clearing a cast
	// site next to lava the bot could never bucket ("pool unreachable"). Require an air
	// neighbour for lava; water keeps the old lenient fallback (it's easy + renewable).
	const air = (x: number, y: number, z: number) =>
		isAir(getBlock(bot, vec3(x, y, z))?.name);
	const exposed = positions.filter((p) =>
		(
			[
				[1, 0, 0],
				[-1, 0, 0],
				[0, 0, 1],
				[0, 0, -1],
				[0, 1, 0],
				[0, -1, 0],
			] as const
		).some(([a, b, c]) => air(p.x + a, p.y + b, p.z + c)),
	);
	// EXPOSED-only: an air-neighbour source is the only kind the bot can actually bucket.
	// (No encased fallback — targeting rock-walled lava the bot can't reach caused the
	// "pool unreachable" stalls and the bot walking off toward deep lava it couldn't scoop.
	// When nothing exposed is in range, return null so the caller descends/explores instead.)
	const pick = exposed;
	if (!pick.length) return null;
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
// Any block whose neighbour is lava is unsafe to dig (would flood the bot). Used
// to keep footing prep from breaching an adjacent lava cell.
const touchesLava = (bot: Bot, c: Vec3): boolean =>
	(
		[
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

// Find (or BUILD) safe footing beside a fluid source and return the stand cell.
// Natural footing = solid floor at src.y with 2 air above. If none exists (the
// pool sits in a wall/at a cliff edge / mid-lake), place a dirt block on a solid
// ledge beside it so the bot never has to stand on lava. Returns null only if no
// neighbour can be made safe.
const standBesideSource = async (
	bot: Bot,
	src: Vec3,
	fluid: "water" | "lava",
): Promise<Vec3 | null> => {
	const dirs = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	] as const;
	// Pass 1: a ready-made ledge (solid, non-lava floor with a clear 1x2 above it).
	for (const [dx, dz] of dirs) {
		const floorC = vec3(src.x + dx, src.y, src.z + dz);
		const floor = getBlock(bot, floorC);
		const feet = getBlock(bot, vec3(src.x + dx, src.y + 1, src.z + dz));
		const head = getBlock(bot, vec3(src.x + dx, src.y + 2, src.z + dz));
		if (
			isSolid(floor?.name) &&
			!isLava(floor?.name) &&
			isAir(feet?.name) &&
			isAir(head?.name)
		)
			return vec3(src.x + dx + 0.5, src.y + 1, src.z + dz + 0.5);
	}
	// Pass 2: BUILD a ledge — a neighbour whose floor cell is air/replaceable but
	// which has a solid, non-lava block under it to place against, and a clear 1x2
	// above. Place dirt in the floor cell, then stand on it. Never touch a cell
	// adjacent to lava with a dig; only place.
	for (const [dx, dz] of dirs) {
		const floorC = vec3(src.x + dx, src.y, src.z + dz);
		const belowC = vec3(src.x + dx, src.y - 1, src.z + dz);
		const floor = getBlock(bot, floorC);
		const below = getBlock(bot, belowC);
		const feet = getBlock(bot, vec3(src.x + dx, src.y + 1, src.z + dz));
		const head = getBlock(bot, vec3(src.x + dx, src.y + 2, src.z + dz));
		const floorFillable =
			(isAir(floor?.name) || floor?.name === "water") && !touchesLava(bot, floorC);
		const canStandAbove = isAir(feet?.name) && isAir(head?.name);
		const anchor = isSolid(below?.name) && !isLava(below?.name);
		if (floorFillable && canStandAbove && anchor) {
			await ensureSolid(bot, floorC);
			if (isSolid(getBlock(bot, floorC)?.name))
				return vec3(src.x + dx + 0.5, src.y + 1, src.z + dz + 0.5);
		}
	}
	// Water doesn't burn — standing on the source itself is an acceptable last resort.
	if (fluid === "water") return vec3(src.x + 0.5, src.y + 1, src.z + 0.5);
	// Pass 3 (lava): CARVE a ledge beside ENCASED lava. The abundant deep lava is
	// rock-walled, so no natural/buildable rim exists. A neighbour with a solid,
	// non-lava floor at src.y is a ledge level with the pool; dig out the 1x2 body
	// space above it and stand there looking down-across at the source. Removing
	// blocks ABOVE the lava's own level never breaches the source (it is a cell over
	// and a level down, staying put on flat ground), so this is safe.
	for (const [dx, dz] of dirs) {
		const floorC = vec3(src.x + dx, src.y, src.z + dz);
		const feetC = vec3(src.x + dx, src.y + 1, src.z + dz);
		const headC = vec3(src.x + dx, src.y + 2, src.z + dz);
		const floor = getBlock(bot, floorC);
		if (!isSolid(floor?.name) || isLava(floor?.name)) continue;
		if (isLava(getBlock(bot, vec3(src.x + dx, src.y - 1, src.z + dz))?.name))
			continue;
		if (isSolid(getBlock(bot, feetC)?.name)) await digAt(bot, feetC);
		if (isSolid(getBlock(bot, headC)?.name)) await digAt(bot, headC);
		if (isAir(getBlock(bot, feetC)?.name) && isAir(getBlock(bot, headC)?.name))
			return vec3(src.x + dx + 0.5, src.y + 1, src.z + dz + 0.5);
	}
	return null;
};

const fillBucket = async (
	bot: Bot,
	fluid: "water" | "lava",
): Promise<boolean> => {
	if (count(bot, "bucket") < 1) return false;
	// 5-agent consensus scoop. The universal, MC-legal fill position is: stand on a block
	// LEVEL with the source one cell to the side, feet one ABOVE, and look DOWN at the
	// source's TOP FACE. Exposed sources always have a clear air column above, so that ray
	// hits the source with nothing to occlude (lava has no collision box, so it never
	// blocks LOS). The old code only ever stood BESIDE at the source's own level — which
	// structurally can't reach mid-pool / flush / depression pools ("pool unreachable").
	// So: enumerate candidate stances (above-look-down PRIMARY, beside-at-level SECONDARY),
	// BUILD a dirt dock where footing is missing (placing beside lava is safe — only DIGGING
	// floods), and let the actual lava_bucket count be the sole success oracle (aim-sweep the
	// top face first, then lower). Prefer sources with air directly above (scoopable surfaces).
	const scan = (dist: number) =>
		bot.findBlocks({
			matching: (n: string) => n === fluid,
			maxDistance: dist,
			// exposed:false — same canSeeBlock LOS trap as surface spotting: near the portal
			// FRAME, the obsidian occludes line-of-sight to the pool, so the default (LOS)
			// scan returns 0 and the refill fails SILENTLY (the "stuck at 7/10" cause). We do
			// our own source + air-neighbour filtering below, so LOS is neither needed nor wanted.
			exposed: false,
			count: 60,
		});
	let raw = scan(20);
	if (!raw.length) {
		// The pool's near sources get scooped/flowed over successive casts, so the source
		// frontier recedes past 20. Re-find the pool WIDE (spotting works now) and walk back.
		const far = findFluidSource(bot, fluid, 80);
		if (far) {
			await goTo(bot, vec3(far.x, far.y, far.z), { range: 4, timeout: 15000 }).catch(
				() => {},
			);
			raw = scan(20);
		}
	}
	if (!raw.length) {
		logEvent("cast", "fill_none", `${fluid} no source within reach`);
		return false;
	}
	const here = bot.entity.position;
	const d2 = (p: { x: number; y: number; z: number }) =>
		(p.x - here.x) ** 2 + (p.y - here.y) ** 2 + (p.z - here.z) ** 2;
	// Only TRUE SOURCE blocks (fluid level 0) fill a bucket. typecraft names FLOWING lava
	// "lava" too, and aiming at a flowing tongue silently fails every attempt — a major cause
	// of "pool unreachable" (agent finding, verified against block.ts: source/flow live in
	// properties.level; the default state has no level and IS the source, so missing == 0).
	const isSource = (p: { x: number; y: number; z: number }) => {
		const lv = (
			getBlock(bot, vec3(p.x, p.y, p.z)) as {
				properties?: { level?: unknown };
			} | null
		)?.properties?.level;
		return lv == null || String(lv) === "0";
	};
	const src0 = raw.filter(isSource);
	const pool = src0.length ? src0 : raw;
	const surf = pool.filter((p) => isAir(getBlock(bot, vec3(p.x, p.y + 1, p.z))?.name));
	// Rank EDGE sources (a solid, non-lava horizontal neighbour = a rim to stand on/over)
	// before interior ones. The nearest sources from the cast site are the pool's INNER
	// edge — all-lava neighbours, unscoopable — while the reachable rim sources sit a bit
	// farther out (measured: "8 srcs no scoop" because all 8 nearest were interior).
	const hasRim = (p: { x: number; y: number; z: number }) =>
		([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dz]) => {
			const n = getBlock(bot, vec3(p.x + dx, p.y, p.z + dz))?.name;
			return isSolid(n) && !isLava(n);
		});
	const srcs = (surf.length ? surf : pool)
		.slice()
		.sort((a, b) => {
			const ra = hasRim(a) ? 0 : 1;
			const rb = hasRim(b) ? 0 : 1;
			return ra !== rb ? ra - rb : d2(a) - d2(b);
		})
		.slice(0, 14)
		.map((p) => vec3(p.x, p.y, p.z));
	console.error(
		`[SCOOP] ${fluid} bot=${Math.floor(here.x)},${Math.floor(here.y)},${Math.floor(here.z)} raw=${raw.length} src0=${src0.length} srcs=${srcs.length} nearest=${srcs[0] ? `${srcs[0].x},${srcs[0].y},${srcs[0].z}@${Math.round(Math.sqrt(d2(srcs[0])))} rim=${hasRim(srcs[0])}` : "none"}`,
	);

	const NB8: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
		[1, 1],
		[1, -1],
		[-1, 1],
		[-1, -1],
	];
	const reach = async (feet: Vec3): Promise<boolean> => {
		const c = vec3(feet.x + 0.5, feet.y, feet.z + 0.5);
		if (
			Math.hypot(
				bot.entity.position.x - c.x,
				bot.entity.position.y - c.y,
				bot.entity.position.z - c.z,
			) > 1.4
		)
			await goTo(bot, c, { range: 0, timeout: 12000 }).catch(() => {});
		await walkToXZ(bot, c.x, c.z, { targetDist: 0.4, maxTime: 2500 });
		return (
			Math.hypot(bot.entity.position.x - c.x, bot.entity.position.z - c.z) <= 1.8
		);
	};
	const scoop = async (src: Vec3): Promise<boolean> => {
		if (!(await equip(bot, "bucket"))) return false;
		// Aim the source TOP FACE first (the reliable down-look), then centre, then low.
		for (const dy of [0.95, 0.5, 0.15]) {
			await reliableUse(bot, vec3(src.x + 0.5, src.y + dy, src.z + 0.5));
			if (count(bot, `${fluid}_bucket`) > 0) return true;
		}
		return false;
	};

	for (const src of srcs) {
		// PRIMARY: stand ABOVE, look DOWN. Feet at src.y+1 in a neighbour column, standing
		// ON a solid non-lava block at src.y (build a dirt dock if the column is open but has
		// an anchor below). Covers flush, depression, and mid-pool sources.
		for (const [dx, dz] of NB8) {
			const foot = vec3(src.x + dx, src.y, src.z + dz);
			const feet = vec3(src.x + dx, src.y + 1, src.z + dz);
			const head = vec3(src.x + dx, src.y + 2, src.z + dz);
			if (!isAir(getBlock(bot, feet)?.name) || !isAir(getBlock(bot, head)?.name))
				continue;
			const footN = getBlock(bot, foot)?.name;
			if (isLava(footN)) continue;
			if (!isSolid(footN)) {
				const anchor = getBlock(bot, vec3(src.x + dx, src.y - 1, src.z + dz))?.name;
				if (!isSolid(anchor) || isLava(anchor)) continue; // nothing to build a dock on
				await ensureSolid(bot, foot); // dirt dock — placing beside lava is safe
				if (!isSolid(getBlock(bot, foot)?.name)) continue;
			}
			if (!(await reach(feet))) continue;
			if (await scoop(src)) {
				logEvent("cast", "filled", `${fluid}_bucket above`);
				return true;
			}
		}
		// SECONDARY: beside at the source's own level (feet at src.y on solid src.y-1).
		for (const [dx, dz] of NB8.slice(0, 4)) {
			const foot = vec3(src.x + dx, src.y - 1, src.z + dz);
			const feet = vec3(src.x + dx, src.y, src.z + dz);
			const head = vec3(src.x + dx, src.y + 1, src.z + dz);
			const footN = getBlock(bot, foot)?.name;
			if (!isAir(getBlock(bot, feet)?.name) || !isAir(getBlock(bot, head)?.name))
				continue;
			if (!isSolid(footN) || isLava(footN)) continue;
			if (!(await reach(feet))) continue;
			if (await scoop(src)) {
				logEvent("cast", "filled", `${fluid}_bucket level`);
				return true;
			}
		}
	}
	logEvent("cast", "fill_fail", `${fluid} ${srcs.length} srcs no scoop`);
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
		//    blocks away), so do it before we position at the cup. DESCEND to the
		//    ground first: after the previous block the bot is on a high cast pillar
		//    and fillBucket can't reach the pool from up there (measured: block 1 cast
		//    fine from the ground, block 2 failed "8 candidates unreachable" on the pillar).
		if (count(bot, "lava_bucket") < 1 || count(bot, "water_bucket") < 1) {
			bot.setControlState("sneak", false);
			if (feetY(bot) > baseY) await descendToY(bot, baseY);
		}
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
const HDIRS: [number, number][] = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1],
];

/**
 * Find lava by MINING to it — the crux of a cold-start portal, and the reason it
 * measured ~0%. The earlier approach (reuse the ore branch-miner) froze in a single
 * cell at depth and burned the whole budget without covering ground; probes showed a
 * random column has NO lava within scan range at ANY depth (y35, y-22, y-48 all dry),
 * so only horizontal COVERAGE finds a lake. This bores continuous straight 1x2
 * corridors at lava-rich depth, scanning as it goes, turning 90° at any liquid it must
 * not breach, and pillaring out of a full box-in — guaranteeing the bot keeps MOVING.
 */
const stripMineForLava = async (
	bot: Bot,
	digDownVertical: (
		b: Bot,
		y: number,
		d: number,
	) => Promise<{ y: number; stopped: string | null }>,
	deadline: number,
): Promise<Vec3 | null> => {
	const scan = () => findFluidSource(bot, "lava", 48);
	let lava = scan();
	if (lava) return lava;

	// Punch straight DOWN, breaching water (survivable — only lava is deadly), to reach
	// the dry, lava-rich deepslate below y-10. Stops on lava below — that IS the find.
	// Wet surfaces + the 1.18 aquifer band (~y0..y20) otherwise make the relocating
	// dig-down wander the SURFACE hunting a dry column, and the horizontal strip only
	// ever bores at that surface depth — so the bot never reaches lava at all (measured:
	// a whole run stuck at y63). Returns the y it managed to reach.
	const punchDown = async (): Promise<number> => {
		for (let k = 0; k < 80 && Date.now() < deadline; k++) {
			// Drowning/lava guard: if we're taking damage (sinking through a deep water
			// aquifer with no air, or beside lava), BAIL before dying. Death respawns us at
			// the surface and then hangs the run (measured: died at y11, jumped to y88).
			// If underwater, climb to air first so we stop drowning.
			if ((bot.health ?? 20) < 9) {
				if ((bot as { entity?: { isInWater?: boolean } }).entity?.isInWater) {
					const { escapeWater } = await import("../../lib/bot-utils.ts");
					await Promise.race([escapeWater(bot as never), sleep(6000)]).catch(() => {});
				}
				return Math.floor(bot.entity.position.y);
			}
			const p = bot.entity.position;
			const by = Math.floor(p.y);
			// A PICKAXE must be held or digAt hand-mines deepslate (~15s) into the 6s dig
			// timeout, the block never breaks, and the bot WEDGES (measured: stuck at y-41).
			if (!bot.heldItem?.name.endsWith("_pickaxe"))
				await equip(bot, "iron_pickaxe");
			await walkToXZ(bot, Math.floor(p.x) + 0.5, Math.floor(p.z) + 0.5, {
				targetDist: 0.25,
				maxTime: 500,
			});
			const below = vec3(Math.floor(p.x), by - 1, Math.floor(p.z));
			const bn = getBlock(bot, below)?.name;
			if (isLava(bn)) return by; // lava directly below — scan() grabs it next loop
			// Only DIG solids. Water/air can't be mined — just sink through them (typecraft
			// has no buoyancy, so gravity pulls the bot straight down). Digging water wasted
			// the 6s dig-timeout every block and never dropped us.
			if (isSolid(bn)) await digAt(bot, below);
			// Wait to fall/sink onto the next level (exits as soon as we drop).
			for (let w = 0; w < 16 && Math.floor(bot.entity.position.y) >= by; w++)
				await sleep(80);
			if (Math.floor(bot.entity.position.y) >= by) {
				// Didn't drop — re-center hard and retry the dig once before giving up.
				const px = Math.floor(bot.entity.position.x);
				const pz = Math.floor(bot.entity.position.z);
				await walkToXZ(bot, px + 0.5, pz + 0.5, { targetDist: 0.15, maxTime: 700 });
				if (isSolid(getBlock(bot, vec3(px, by - 1, pz))?.name))
					await digAt(bot, vec3(px, by - 1, pz));
				for (let w = 0; w < 14 && Math.floor(bot.entity.position.y) >= by; w++)
					await sleep(80);
				if (Math.floor(bot.entity.position.y) >= by) break; // still stuck -> caller relocates
			}
		}
		// Deliberately do NOT escapeWater here — that climbs back UP and undoes the descent.
		// If we end in a flooded shaft the caller keeps punching until dry rock or lava.
		return Math.floor(bot.entity.position.y);
	};

	// Phase 1 — reach lava-rich depth. Try the fast dry dig-down first; whenever it
	// stalls above depth (wet surface / aquifer it won't breach), PUNCH through instead
	// of wandering the surface.
	const descendUntil = Math.min(deadline, Date.now() + 200_000);
	while (Math.floor(bot.entity.position.y) > -50 && Date.now() < descendUntil) {
		const y0 = Math.floor(bot.entity.position.y);
		await digDownVertical(bot, -50, Math.min(descendUntil, Date.now() + 18_000));
		lava = scan();
		if (lava) return lava;
		if (Math.floor(bot.entity.position.y) >= y0 - 2) {
			await punchDown();
			lava = scan();
			if (lava) return lava;
			if (Math.floor(bot.entity.position.y) >= y0 - 2) break; // truly stuck (bedrock)
		}
	}

	// Phase 2 — cover ground at depth by PATHFINDING to distant waypoints. goTo digs
	// through rock (digCost) and pillars/routes via caves with its OWN timeout+stop, so it
	// won't hang the way hand-rolled tunnelling did (a run once blocked ~460s). Caves are
	// exactly where lava is exposed, so following them is a bonus. Scan between hops; any
	// lava within 48 ends the search. Bias waypoints slightly downward to trend toward the
	// dense deep lava, and punch down if the pathfinder leaves us shallow.
	let bearing = Math.floor(Math.random() * 4);
	while (Date.now() < deadline) {
		lava = scan();
		if (lava) return lava;
		if (!bot.heldItem?.name.endsWith("_pickaxe")) await equip(bot, "iron_pickaxe");
		// Pursue any lava the bot has SEEN so far, at ANY depth, before descending further.
		// findFluidSource is EXPOSED-only (anti-X-ray, currently-loaded chunks); memory
		// accumulates every exposed lava passed as chunks streamed in (the sightings
		// production uses). If we spotted cave lava on the way down, home in now instead of
		// punching past it.
		const seen =
			findFluidSource(bot, "lava", 96) ?? getRememberedResource(bot, "lava", true);
		if (seen) {
			console.error(`[PROBE] homing lava ${seen.x},${seen.y},${seen.z}`);
			await goTo(bot, vec3(seen.x, seen.y, seen.z), { range: 4, timeout: 45000 }).catch(
				() => {},
			);
			const near = findFluidSource(bot, "lava", 48);
			if (near) return near;
			continue;
		}
		const p = bot.entity.position;
		const fy = Math.floor(p.y);
		// DESCENT via punchDown (not the pathfinder): goTo/digDownVertical refuse to dig
		// through water and stall at the ~y40 aquifer then resurface (measured). punchDown
		// breaches water (survivable) and is the only thing that gets past the aquifer band.
		if (fy > -54) {
			console.error(`[PROBE] descend from y=${fy}`);
			const reached = await punchDown();
			if (reached >= fy - 1) {
				// punchDown couldn't drop here — nudge ONE block sideways MANUALLY (fast: goTo
				// can't dig deepslate and burned ~15s a stall) to a fresh column, then retry.
				const [rdx, rdz] = HDIRS[Math.floor(Math.random() * 4)]!;
				const cx = Math.floor(bot.entity.position.x);
				const cy = Math.floor(bot.entity.position.y);
				const cz = Math.floor(bot.entity.position.z);
				const f = vec3(cx + rdx, cy, cz + rdz);
				const h = vec3(cx + rdx, cy + 1, cz + rdz);
				if (isSolid(getBlock(bot, f)?.name)) await digAt(bot, f);
				if (isSolid(getBlock(bot, h)?.name)) await digAt(bot, h);
				await bot.lookAt(vec3(cx + rdx + 0.5, cy + 0.5, cz + rdz + 0.5));
				bot.setControlState("forward", true);
				bot.setControlState("sprint", true);
				await sleep(400);
				bot.setControlState("forward", false);
				bot.setControlState("sprint", false);
			}
			continue;
		}
		// MINE toward the lava and EXPOSE it. Diagnostics proved lava at this depth is dense
		// (~70 sources within 32 blocks, nearest ~23 away) but 100% ENCASED — 0 exposed. Since
		// findBlocks is exposed-only (anti-X-ray), the only way to detect it is to UNCOVER a
		// face by mining. The old code did the opposite: it turned AWAY from any dig that would
		// expose lava (safety guard) and used the pathfinder (which also avoids lava), so it
		// never uncovered the lava it was standing next to. Here we bore a committed straight
		// 1x2 tunnel, digging THROUGH toward lava; the dig that opens a lava face makes it
		// exposed, and the scan then returns it to scoop. Lava this dense is hit within ~20 blocks.
		// DIAG (temporary, measurement only): X-ray lava density vs legal exposed count at
		// this depth — tells us if a "found nothing" spawn is genuinely lava-sparse or has
		// lava we're just not reaching/uncovering.
		{
			const xr = (r: number) =>
				(
					bot.findBlocks({
						matching: (n: string) => n === "lava",
						maxDistance: r,
						count: 300,
						exposed: false,
					} as never) as unknown[]
				).length;
			const ex = bot.findBlocks({
				matching: (n: string) => n === "lava",
				maxDistance: 48,
				count: 300,
			}).length;
			console.error(
				`[DIAG] y=${Math.floor(bot.entity.position.y)} xray32=${xr(32)} xray64=${xr(64)} xray96=${xr(96)} exp48=${ex}`,
			);
		}
		const [dx, dz] = HDIRS[bearing]!;
		let advanced = 0;
		for (let r = 0; r < 40 && Date.now() < deadline; r++) {
			// Wide scan: the sweep exposes lava up to ~32 away (in tunnels opened on earlier
			// runs), which the narrow 14-scan missed (measured: exp48 hit 48 but was never
			// captured). On a hit, NAVIGATE adjacent so scoop-on-expose can reach it.
			const uncovered = findFluidSource(bot, "lava", 32);
			if (uncovered) {
				const up = bot.entity.position;
				if (Math.hypot(up.x - uncovered.x, up.y - uncovered.y, up.z - uncovered.z) > 4)
					await goTo(bot, vec3(uncovered.x, uncovered.y, uncovered.z), {
						range: 2,
						timeout: 25000,
					}).catch(() => {});
				return findFluidSource(bot, "lava", 8) ?? uncovered;
			}
			const cp = bot.entity.position;
			const cx = Math.floor(cp.x);
			const cy = Math.floor(cp.y);
			const cz = Math.floor(cp.z);
			const feetC = vec3(cx + dx, cy, cz + dz);
			const headC = vec3(cx + dx, cy + 1, cz + dz);
			const floorC = vec3(cx + dx, cy - 1, cz + dz);
			// Lava ahead OR just below the tunnel — found; return to scoop. We mine at the
			// lake's depth now (~y-54, deep in the dense band per the X-ray diagnostic), so
			// flat mining hits lava at the tunnel level instead of skimming over it.
			if (
				isLava(getBlock(bot, feetC)?.name) ||
				isLava(getBlock(bot, headC)?.name) ||
				isLava(getBlock(bot, floorC)?.name) ||
				isLava(getBlock(bot, vec3(cx, cy - 1, cz))?.name)
			) {
				const hit = findFluidSource(bot, "lava", 8);
				if (hit) return hit;
			}
			// Advance ONE block, retrying up to 3x — a single push often under-shoots (the bot
			// stalls at ~1 block/run and spirals). Commit to the bearing for the whole 40-block
			// run so we travel the ~15-25 blocks to the lake (flat travels far; the staircase
			// variant stalled at ~1 block/run).
			let moved = false;
			for (let t = 0; t < 3 && !moved; t++) {
				if (isSolid(getBlock(bot, feetC)?.name)) await digAt(bot, feetC);
				if (isSolid(getBlock(bot, headC)?.name)) await digAt(bot, headC);
				const justHit = findFluidSource(bot, "lava", 24);
				if (justHit) {
					const jp = bot.entity.position;
					if (Math.hypot(jp.x - justHit.x, jp.y - justHit.y, jp.z - justHit.z) > 4)
						await goTo(bot, vec3(justHit.x, justHit.y, justHit.z), {
							range: 2,
							timeout: 25000,
						}).catch(() => {});
					return findFluidSource(bot, "lava", 8) ?? justHit;
				}
				const fl = getBlock(bot, floorC)?.name;
				if (!isSolid(fl) && !isLava(fl)) await ensureSolid(bot, floorC);
				await bot.lookAt(vec3(cx + dx + 0.5, cy + 0.5, cz + dz + 0.5));
				bot.setControlState("forward", true);
				bot.setControlState("sprint", true);
				await sleep(500);
				bot.setControlState("forward", false);
				bot.setControlState("sprint", false);
				await sleep(120);
				moved =
					Math.floor(bot.entity.position.x) !== cx ||
					Math.floor(bot.entity.position.z) !== cz;
			}
			if (!moved) break; // real wall after 3 tries — end run, turn
			advanced++;
			if (r % 5 === 0)
				console.error(
					`[PROBE] mine y=${Math.floor(bot.entity.position.y)} x=${cx} z=${cz} bearing=${dx},${dz} adv=${advanced}`,
				);
		}
		// Always turn after a run so successive runs sweep DIFFERENT directions (the dense
		// lava can be to any side; a single committed bearing missed it). Stay WITHIN the
		// dense band y-52..-56 (X-ray diagnostic): if above it, descend a few (checking lava
		// below); if we've bottomed out near bedrock (where flat mining wedges — solo3b spun
		// 167x at adv=1) or a run stalled, pillar back UP into the band.
		bearing = (bearing + 1) % 4;
		const yy = Math.floor(bot.entity.position.y);
		if (yy > -52) {
			for (let k = 0; k < 4 && Math.floor(bot.entity.position.y) > -52; k++) {
				const bp = bot.entity.position;
				const by = Math.floor(bp.y);
				const bel = vec3(Math.floor(bp.x), by - 1, Math.floor(bp.z));
				if (isLava(getBlock(bot, bel)?.name)) {
					const h = findFluidSource(bot, "lava", 6);
					if (h) return h;
					break;
				}
				if (isSolid(getBlock(bot, bel)?.name)) await digAt(bot, bel);
				for (let w = 0; w < 12 && Math.floor(bot.entity.position.y) >= by; w++)
					await sleep(80);
				if (Math.floor(bot.entity.position.y) >= by) break;
			}
		} else if (yy < -55 || advanced < 3) {
			await pillarUp(bot, Math.min(-52, yy + 4));
			bot.setControlState("sneak", false);
		}
	}
	return scan();
};

export const prepareCastSite = async (bot: Bot): Promise<StepResult> => {
	const deadline = Date.now() + 20 * 60_000;
	// SPOT exposed lava WIDE — surface/cave lava is air-adjacent, so findFluidSource sees it
	// across loaded chunks. A big radius lets the bot spot surface lava from far, then WALK to
	// it (below), instead of only reacting to lava within 40 and otherwise digging blindly.
	const findLava = (): Vec3 | null => findFluidSource(bot, "lava", 128);

	// 1. Locate a lava pool the bot can actually see. If none, descend toward
	//    cave-lava depth and branch-mine to open walls until lava comes into
	//    line-of-sight — never peeking through rock.
	// Chunks a few dozen blocks out are still STREAMING right after a (re)spawn/teleport, so
	// findBlocks sees nothing for a second or two — retry briefly before giving up to the
	// dig-down grind, or the bot descends past surface lava it just couldn't see yet.
	let lava = findLava();
	for (let i = 0; i < 8 && !lava; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		lava = findLava();
	}
	console.error(
		`[SPOT] boty=${Math.floor(bot.entity.position.y)} lava=${lava ? `${lava.x},${lava.y},${lava.z} d=${Math.round(distance(bot.entity.position, lava))}` : "null"}`,
	);
	if (!lava) {
		const { digDownVertical } = await import("../mining/main.ts");
		lava = await stripMineForLava(bot, digDownVertical, deadline);
	}
	if (!lava) return { success: false, message: "No lava pool found to cast at" };

	// WALK to the spotted lava (near/medium/far) so the scoop + site prep are adjacent. Hop
	// toward it, re-spotting closer each time; the pathfinder routes across the surface fast.
	for (let hop = 0; hop < 10 && Date.now() < deadline; hop++) {
		const bp = bot.entity.position;
		if (Math.hypot(bp.x - (lava.x + 0.5), bp.z - (lava.z + 0.5)) <= 6) break;
		await goTo(bot, vec3(lava.x, lava.y, lava.z), { range: 4, timeout: 20000 }).catch(
			() => {},
		);
		const re = findLava();
		if (re) lava = re;
	}

	// 1b. Scoop the lava bucket NOW, while we're standing adjacent on solid tunnel floor —
	// we just mined THROUGH to this pool, so it's within reach. The reposition + chamber
	// clear below moves us out of range, and open-pool geometry (measured: source ~5 away,
	// no solid footing on any adjacent cell) then makes the beside-stand scoop fail
	// ("pool unreachable"). Filling here, adjacent, is the reliable moment.
	if (count(bot, "lava_bucket") < 1 && count(bot, "bucket") >= 1) {
		const near = findFluidSource(bot, "lava", 5);
		if (near) {
			await equip(bot, "bucket");
			for (let i = 0; i < 6 && count(bot, "lava_bucket") < 1; i++)
				await reliableUse(bot, vec3(near.x + 0.5, near.y + 0.3, near.z + 0.5));
			if (count(bot, "lava_bucket") > 0)
				logEvent("cast", "filled", "lava_bucket on-expose");
		}
	}

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

	// Build in a CLEAR spot away from lava. After scooping (esp. D>=16), the bot ends AT the
	// pool; casting the frame there floods every cup and sticks at 0/10 (measured). Step back
	// (away from the nearest lava) until no lava is within the frame footprint — the pool
	// stays close enough that fillBucket walks back to refill each block.
	for (let tries = 0; tries < 8 && findFluidSource(bot, "lava", 6); tries++) {
		const p = bot.entity.position;
		const near = findFluidSource(bot, "lava", 12);
		const dx = near ? Math.sign(p.x - near.x) || 1 : 1;
		const dz = near ? Math.sign(p.z - near.z) || 1 : 1;
		await goTo(
			bot,
			vec3(Math.floor(p.x) + dx * 4, Math.floor(p.y), Math.floor(p.z) + dz * 4),
			{ range: 1, timeout: 8000 },
		).catch(() => {});
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

	// Open the inner 2x3 gap and the +Z approach. NEVER dig obsidian — an iron pickaxe
	// can't break it and digAt would hang. The interior MUST end pure AIR or ignition
	// fails (measured: cast inner-fill/cup dirt left 3 of 6 interior cells solid).
	await descendToY(bot, by);
	const digIfNotObsidian = async (p: Vec3) => {
		if (getBlock(bot, p)?.name !== "obsidian") await digAt(bot, p);
	};
	// Clear the +Z approach FIRST so we can stand in front and reach the whole interior.
	for (let dy = 0; dy <= 4; dy++)
		for (let dx = 1; dx <= 2; dx++)
			await digIfNotObsidian(vec3(bx + dx, by + dy, bz + 1));
	// Clear the interior — position in FRONT of each still-solid cell (from +Z, one below it
	// for reach) and dig; retry so the higher by+3 cells aren't left behind.
	for (let attempt = 0; attempt < 3; attempt++) {
		let allClear = true;
		for (const g of innerGap) {
			const n = getBlock(bot, g)?.name;
			if (n === "obsidian" || isAir(n)) continue;
			await goTo(bot, vec3(g.x, Math.max(by, g.y - 1), bz + 2), {
				range: 1,
				timeout: 8000,
			}).catch(() => {});
			await digIfNotObsidian(g);
			const after = getBlock(bot, g)?.name;
			if (!isAir(after) && after !== "obsidian") allClear = false;
		}
		if (allClear) break;
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
	// Interior 2x3 must be clear AIR to ignite — log it (residual water/dirt from the cast
	// cups/bowls blocks portal formation).
	console.error(
		`[LIGHT] fas=${count(bot, "flint_and_steel")} interior=${innerGap.map((g) => getBlock(bot, g)?.name ?? "?").join(",")}`,
	);
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
			const fireCell = getBlock(bot, vec3(lit.x, lit.y + 1, lit.z))?.name ?? "?";
			const inner = at(1, 1);
			console.error(
				`[LIGHT] lit@${lit.x},${lit.y},${lit.z} fireCell=${fireCell} inner11=${getBlock(bot, inner)?.name ?? "?"}`,
			);
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
