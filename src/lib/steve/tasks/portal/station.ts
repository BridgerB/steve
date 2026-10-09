/**
 * The sealed refill station (cycle 4 §7.3). Replaces the free refill walk around a
 * receding pool with a fixed script:
 *   - a stand S: solid non-lava floor, feet at lava level + 1, outside the frame box,
 *     with an open direction d toward the pool; O = S + d has air at feet height and
 *     the pool below it;
 *   - targets: lava SOURCES reachable through O within bucket reach (O's column one to
 *     three below the stand's feet, and the next column out at one below);
 *   - seal by PLACING only (lava beside S or O at feet/head height, a drop beside S);
 *     the station never digs;
 *   - scoop sneaking (sneak stops the walk off the edge into O), health ≥ 14;
 *   - exhaustion → the next stand, at most three re-sites; no stand → fail (the caller
 *     aborts the layer; it never improvises a stand beside the pool).
 * Stands are ranked by |stand level − bot level|, then whether the straight line from
 * the bot crosses lava-floored cells, then distance, then target count. A failed walk
 * excludes its 5×5 neighbourhood.
 */
import type { Bot } from "typecraft";
import { vec3, type Vec3 } from "typecraft";
import { goTo, walkToXZ } from "../../lib/bot-utils.ts";
import { logEvent } from "../../lib/logger.ts";

export interface StationDeps {
	name: (p: Vec3) => string | undefined;
	isSolid: (n?: string) => boolean;
	isLava: (n?: string) => boolean;
	isAir: (n?: string) => boolean;
	isSource: (p: Vec3) => boolean;
	count: (name: string) => number;
	equip: (name: string) => Promise<boolean>;
	placeCobble: (p: Vec3) => Promise<boolean>;
	use: (look: Vec3) => Promise<boolean>;
	/** Straight-line walk toward (x, z), digging non-obsidian blocks that do not touch lava. */
	shuffle?: (x: number, z: number) => Promise<void>;
	/** Dig one block (the walkway clears feet/head cells with it). */
	dig?: (p: Vec3) => Promise<void>;
}

const touchesLavaD = (deps: StationDeps, p: Vec3): boolean =>
	[
		[1, 0, 0],
		[-1, 0, 0],
		[0, 1, 0],
		[0, -1, 0],
		[0, 0, 1],
		[0, 0, -1],
	].some(([x, y, z]) => deps.isLava(deps.name(vec3(p.x + x, p.y + y, p.z + z))));

/**
 * A fixed walkway to the stand (ruststeve refill-design §4): an L at the stand's level from
 * the bot's cell, floored with placed cobble, feet and head dug clear, lava beside it capped;
 * then a sneaking cell-by-cell walk. The pathfinder could not get through the cast clutter
 * (f5/f7/f8/f10: most refill walks pf_no_progress / pf_partial; landing 11 walk_grid: boxed
 * pockets one step from the stand). Returns true when the bot reached the stand's cell.
 */
const walkway = async (bot: Bot, deps: StationDeps, S: Vec3): Promise<boolean> => {
	if (!deps.dig) return false;
	const p = bot.entity.position;
	const sx = Math.floor(p.x);
	const sz = Math.floor(p.z);
	if (Math.abs(Math.floor(p.y) - S.y) > 1) return false;
	const legs = (xFirst: boolean): Vec3[] => {
		const cells: Vec3[] = [];
		let x = sx;
		let z = sz;
		const stepX = () => {
			while (x !== S.x) {
				x += Math.sign(S.x - x);
				cells.push(vec3(x, S.y, z));
			}
		};
		const stepZ = () => {
			while (z !== S.z) {
				z += Math.sign(S.z - z);
				cells.push(vec3(x, S.y, z));
			}
		};
		if (xFirst) {
			stepX();
			stepZ();
		} else {
			stepZ();
			stepX();
		}
		return cells;
	};
	// A leg is usable when no cell it must dig touches lava and none is obsidian.
	const usable = (cells: Vec3[]): boolean =>
		cells.every((c) =>
			[c, vec3(c.x, c.y + 1, c.z)].every((q) => {
				const n = deps.name(q);
				if (deps.isLava(n)) return false;
				if (!deps.isSolid(n)) return true;
				return n !== "obsidian" && !touchesLavaD(deps, q);
			}),
		);
	const path = [legs(true), legs(false)].find((c) => c.length > 0 && c.length <= 10 && usable(c));
	if (!path) {
		logEvent("cast", "walkway_none", `to ${key(S)} from ${sx},${Math.floor(p.y)},${sz}`, p);
		return false;
	}
	let placed = 0;
	let dug = 0;
	// One cell at a time — prepare it from the cell before (within reach), then step on.
	for (const c of path) {
		// Head first: the step up from a 2-high pocket needs the cell over the bot's head too.
		const here = bot.entity.position;
		const over = vec3(Math.floor(here.x), Math.floor(here.y) + 2, Math.floor(here.z));
		if (c.y > Math.floor(here.y) && deps.isSolid(deps.name(over)) && deps.name(over) !== "obsidian" && !touchesLavaD(deps, over)) {
			await deps.dig(over);
			dug++;
		}
		const floor = vec3(c.x, c.y - 1, c.z);
		if (!deps.isSolid(deps.name(floor)) && (await deps.placeCobble(floor))) placed++;
		for (const q of [vec3(c.x, c.y + 1, c.z), c]) {
			if (deps.isSolid(deps.name(q))) {
				await deps.dig(q);
				dug++;
			}
		}
		// Lava beside the walkway at feet or head height: cap it by placing.
		for (const [dx, dz] of DIRS)
			for (const dy of [0, 1]) {
				const s = vec3(c.x + dx, c.y + dy, c.z + dz);
				if (deps.isLava(deps.name(s)) && (await deps.placeCobble(s))) placed++;
			}
		if (deps.isLava(deps.name(floor)) || deps.isLava(deps.name(c)) || deps.isSolid(deps.name(c))) break;
		bot.setControlState("sneak", true);
		await walkToXZ(bot, c.x + 0.5, c.z + 0.5, { targetDist: 0.3, maxTime: 2500 }).catch(() => {});
		bot.setControlState("sneak", false);
		if (Math.floor(bot.entity.position.x) !== c.x || Math.floor(bot.entity.position.z) !== c.z) break;
	}
	const ok = atStand(bot, S);
	logEvent("cast", "walkway", `to ${key(S)} cells ${path.length} placed ${placed} dug ${dug} arrived=${ok}`, bot.entity.position);
	return ok;
};

type Stand = { S: Vec3; d: [number, number]; targets: Vec3[] };

const DIRS: [number, number][] = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];
const REACH = 4.5;
const EYE_SNEAK = 1.27;

const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;

/** Lava sources the bot can see as exposed (air directly above) within `r`. */
// Exposed = air directly above (the exposure rule the rest of the cast uses); the
// line-of-sight filter returned nothing beside a built frame (s4n-1: station_none at a
// 14-source pool).
const visibleSources = (bot: Bot, deps: StationDeps, r: number): Vec3[] =>
	(bot.findBlocks({ matching: (n: string) => n === "lava", maxDistance: r, count: 400, exposed: false } as never) as Vec3[])
		.map((p) => vec3(p.x, p.y, p.z))
		.filter((p) => deps.isSource(p) && deps.isAir(deps.name(vec3(p.x, p.y + 1, p.z))));

const targetsFor = (deps: StationDeps, S: Vec3, d: [number, number]): Vec3[] => {
	const eye = vec3(S.x + 0.5, S.y + EYE_SNEAK, S.z + 0.5);
	const O = vec3(S.x + d[0], S.y, S.z + d[1]);
	const cells = [
		vec3(O.x, S.y - 1, O.z),
		vec3(O.x, S.y - 2, O.z),
		vec3(O.x, S.y - 3, O.z),
		vec3(O.x + d[0], S.y - 1, O.z + d[1]),
	];
	return cells.filter(
		(c) =>
			deps.isLava(deps.name(c)) &&
			deps.isSource(c) &&
			Math.hypot(c.x + 0.5 - eye.x, c.y + 0.9 - eye.y, c.z + 0.5 - eye.z) <= REACH,
	);
};

/** Why the last stand search found nothing (logged with station_none). */
export const why = { sources: 0, openAbove: 0, frame: 0, floor: 0, body: 0, noTarget: 0 };
const candidateStands = (bot: Bot, deps: StationDeps, frame: Vec3 | null, excluded: Vec3[]): Stand[] => {
	for (const k of Object.keys(why) as (keyof typeof why)[]) why[k] = 0;
	const inFrame = (p: Vec3) =>
		!!frame && p.x >= frame.x - 1 && p.x <= frame.x + 4 && p.z >= frame.z - 2 && p.z <= frame.z + 2 && p.y >= frame.y - 1 && p.y <= frame.y + 6;
	const nearExcluded = (p: Vec3) => excluded.some((e) => Math.abs(e.x - p.x) <= 2 && Math.abs(e.z - p.z) <= 2 && Math.abs(e.y - p.y) <= 2);
	const seen = new Set<string>();
	const out: Stand[] = [];
	const srcs = visibleSources(bot, deps, 20);
	why.sources = srcs.length;
	for (const L of srcs) {
		const O = vec3(L.x, L.y + 1, L.z);
		if (!deps.isAir(deps.name(O))) continue;
		why.openAbove++;
		for (const d of DIRS) {
			const S = vec3(O.x - d[0], O.y, O.z - d[1]);
			const k = `${key(S)}|${d[0]},${d[1]}`;
			if (seen.has(k)) continue;
			seen.add(k);
			if (inFrame(S) || nearExcluded(S)) {
				why.frame++;
				continue;
			}
			const floor = deps.name(vec3(S.x, S.y - 1, S.z));
			if (!deps.isSolid(floor) || deps.isLava(floor)) {
				why.floor++;
				continue;
			}
			if (!deps.isAir(deps.name(S)) || !deps.isAir(deps.name(vec3(S.x, S.y + 1, S.z)))) {
				why.body++;
				continue;
			}
			const targets = targetsFor(deps, S, d);
			if (targets.length) out.push({ S, d, targets });
			else why.noTarget++;
		}
	}
	const bp = bot.entity.position;
	const crossesLava = (S: Vec3): boolean => {
		const n = Math.max(1, Math.ceil(Math.hypot(S.x + 0.5 - bp.x, S.z + 0.5 - bp.z)));
		for (let i = 1; i < n; i++) {
			const x = Math.floor(bp.x + ((S.x + 0.5 - bp.x) * i) / n);
			const z = Math.floor(bp.z + ((S.z + 0.5 - bp.z) * i) / n);
			if (deps.isLava(deps.name(vec3(x, S.y - 1, z))) || deps.isLava(deps.name(vec3(x, S.y, z)))) return true;
		}
		return false;
	};
	const by = Math.floor(bp.y);
	return out
		.map((s) => ({ s, dy: Math.abs(s.S.y - by), lava: crossesLava(s.S) ? 1 : 0, dist: Math.hypot(s.S.x + 0.5 - bp.x, s.S.z + 0.5 - bp.z) }))
		.sort((a, b) => a.dy - b.dy || a.lava - b.lava || a.dist - b.dist || b.s.targets.length - a.s.targets.length)
		.map((x) => x.s);
};

/** Place-only sealing around the stand: lava beside S or O at feet/head height, and a drop beside S. */
const seal = async (deps: StationDeps, st: Stand): Promise<number> => {
	const { S, d } = st;
	const perp: [number, number][] = [
		[d[1], d[0]],
		[-d[1], -d[0]],
	];
	const O = vec3(S.x + d[0], S.y, S.z + d[1]);
	let n = 0;
	for (const base of [S, O])
		for (const [px, pz] of perp)
			for (const dy of [0, 1]) {
				const c = vec3(base.x + px, base.y + dy, base.z + pz);
				if (deps.isLava(deps.name(c)) && (await deps.placeCobble(c))) n++;
			}
	// Lava at O's head height or above S's head (flowing in from above) — cap it too.
	for (const c of [vec3(O.x, O.y + 1, O.z), vec3(S.x, S.y + 2, S.z)])
		if (deps.isLava(deps.name(c)) && (await deps.placeCobble(c))) n++;
	// A drop beside S (no floor) — floor it so a sneak slip can't fall.
	for (const [px, pz] of [...perp, [-d[0], -d[1]] as [number, number]]) {
		const f = vec3(S.x + px, S.y - 1, S.z + pz);
		if (!deps.isSolid(deps.name(f)) && (await deps.placeCobble(f))) n++;
	}
	return n;
};

// One block above the stand still reaches its targets (s5n-1: 9 walk "failures" were the
// bot standing on its own frame 1 above the stand).
const atStand = (bot: Bot, S: Vec3): boolean => {
	const p = bot.entity.position;
	const dy = Math.floor(p.y) - S.y;
	return dy >= 0 && dy <= 1 && Math.hypot(p.x - (S.x + 0.5), p.z - (S.z + 0.5)) <= 0.7;
};

/**
 * Scoop from where the bot already stands: exposed sources within bucket reach of the
 * eye, no lava in the body ring, sneaking. Returns buckets filled.
 */
const scoopFromHere = async (bot: Bot, deps: StationDeps, enough: () => boolean): Promise<number> => {
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	for (const dy of [0, 1])
		for (let dx = -1; dx <= 1; dx++)
			for (let dz = -1; dz <= 1; dz++) if (deps.isLava(deps.name(vec3(fx + dx, fy + dy, fz + dz)))) return 0;
	const eye = vec3(p.x, p.y + EYE_SNEAK, p.z);
	const near = visibleSources(bot, deps, 6)
		.filter((t) => t.y < fy && Math.hypot(t.x + 0.5 - eye.x, t.y + 0.9 - eye.y, t.z + 0.5 - eye.z) <= REACH)
		.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
		.slice(0, 4);
	if (!near.length) return 0;
	let got = 0;
	bot.setControlState("sneak", true);
	for (const t of near) {
		if (enough() || deps.count("bucket") < 1) break;
		if (!(await deps.equip("bucket"))) break;
		const before = deps.count("lava_bucket");
		for (const dyy of [0.95, 0.5]) {
			await deps.use(vec3(t.x + 0.5, t.y + dyy, t.z + 0.5));
			if (deps.count("lava_bucket") > before) break;
		}
		if (deps.count("lava_bucket") > before) got++;
	}
	bot.setControlState("sneak", false);
	if (got) logEvent("cast", "station_here", `filled ${got} from ${fx},${fy},${fz}`, bot.entity.position);
	return got;
};

/**
 * Fill empty buckets with lava at a station until `enough()` holds. Returns how many
 * buckets were filled; 0 means no stand worked (the caller aborts the layer).
 */
export const stationRefill = async (
	bot: Bot,
	deps: StationDeps,
	opts: { frame: Vec3 | null; enough: () => boolean },
): Promise<number> => {
	let got = 0;
	const excluded: Vec3[] = [];
	got += await scoopFromHere(bot, deps, opts.enough);
	for (let site = 0; site < 3 && !opts.enough(); site++) {
		const st = candidateStands(bot, deps, opts.frame, excluded)[0];
		if (!st) {
			logEvent("cast", "station_none", `no stand with a target (site ${site}, excluded ${excluded.length}) ${JSON.stringify(why)}`, bot.entity.position);
			break;
		}
		const { S, d } = st;
		bot.setControlState("sneak", false);
		// Refill-reach study (cycle 7): one refill_walk event per stand walk, arrived or not.
		const p0 = bot.entity.position;
		const d0 = Math.hypot(p0.x - (S.x + 0.5), p0.z - (S.z + 0.5));
		const tWalk = Date.now();
		const pfOk = await goTo(bot, S, { range: 0, timeout: 20000, nudge: false }).catch(() => false);
		// f5-natk1-a-7: perched one block above the floor beside the frame, every pathfinder
		// walk to a stand 3-6 blocks away made no progress (265 vetoed moves in 15 min), while
		// the one walk that started on the floor arrived in 1.7 s. Fall back to a straight
		// shuffle that digs its way down and across.
		let shuffled = false;
		let walked = false;
		if (!atStand(bot, S)) walked = await walkway(bot, deps, S);
		if (!walked) {
			const q = bot.entity.position;
			const dq = Math.hypot(q.x - (S.x + 0.5), q.z - (S.z + 0.5));
			if (deps.shuffle && !atStand(bot, S) && dq <= 8) {
				await deps.shuffle(S.x + 0.5, S.z + 0.5).catch(() => {});
				shuffled = true;
			}
		}
		{
			const q = bot.entity.position;
			if (Math.hypot(q.x - (S.x + 0.5), q.z - (S.z + 0.5)) <= 1.5)
				await walkToXZ(bot, S.x + 0.5, S.z + 0.5, { targetDist: 0.25, maxTime: 2500 }).catch(() => {});
		}
		{
			const q = bot.entity.position;
			const d1 = Math.hypot(q.x - (S.x + 0.5), q.z - (S.z + 0.5));
			const arrived = atStand(bot, S);
			const reason = arrived ? "" : d1 <= 1.5 ? "near_not_on_stand" : pfOk ? "pf_done_but_far" : d1 < d0 - 1 ? "pf_partial" : "pf_no_progress";
			logEvent(
				"cast",
				"refill_walk",
				JSON.stringify({ stand: key(S), site, d0: +d0.toFixed(1), d1: +d1.toFixed(1), dy: +(S.y - p0.y).toFixed(1), pf_ok: pfOk === true, walkway: walked, shuffled, arrived, reason, ms: Date.now() - tWalk, targets: st.targets.length }),
				q,
			);
		}
		if (!atStand(bot, S)) {
			const p = bot.entity.position;
			logEvent("cast", "station_walk_fail", `stand ${key(S)} bot ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`, p);
			// Diagnostic (cycle 7): the blocks between the bot and the stand, layer by layer, so a
			// failed walk can be read instead of guessed. One char per cell: . air, # solid,
			// L lava, W water, O obsidian, B bot, S stand.
			{
				const bx = Math.floor(p.x);
				const by = Math.floor(p.y);
				const bz = Math.floor(p.z);
				const [x0, x1] = [Math.min(bx, S.x) - 1, Math.max(bx, S.x) + 1];
				const [z0, z1] = [Math.min(bz, S.z) - 1, Math.max(bz, S.z) + 1];
				const layers: string[] = [];
				for (let y = Math.max(by, S.y) + 2; y >= Math.min(by, S.y) - 2; y--) {
					const rows: string[] = [];
					for (let z = z0; z <= z1; z++) {
						let row = "";
						for (let x = x0; x <= x1; x++) {
							const n = deps.name(vec3(x, y, z)) ?? "?";
							row +=
								x === bx && y === by && z === bz ? "B" : x === S.x && y === S.y && z === S.z ? "S" : deps.isLava(n) ? "L" : n.includes("water") ? "W" : n === "obsidian" ? "O" : deps.isSolid(n) ? "#" : ".";
						}
						rows.push(row);
					}
					layers.push(`y${y}:${rows.join("/")}`);
				}
				logEvent("cast", "walk_grid", `x${x0}..${x1} z${z0}..${z1} ${layers.join(" ")}`, p);
			}
			excluded.push(S);
			continue;
		}
		const sealed = await seal(deps, st);
		if ((bot.health ?? 20) < 14) {
			logEvent("cast", "station_low_hp", `hp ${bot.health} at ${key(S)}`, bot.entity.position);
			break;
		}
		bot.setControlState("sneak", true);
		await walkToXZ(bot, S.x + 0.5, S.z + 0.5, { targetDist: 0.2, maxTime: 1000 }).catch(() => {});
		let here = 0;
		for (let pass = 0; pass < 2 && !opts.enough(); pass++) {
			for (const t of targetsFor(deps, S, d)) {
				if (opts.enough() || deps.count("bucket") < 1) break;
				if (!(await deps.equip("bucket"))) break;
				const before = deps.count("lava_bucket");
				for (const dy of [0.95, 0.5]) {
					await deps.use(vec3(t.x + 0.5, t.y + dy, t.z + 0.5));
					if (deps.count("lava_bucket") > before) break;
				}
				if (deps.count("lava_bucket") > before) here++;
			}
		}
		bot.setControlState("sneak", false);
		got += here;
		logEvent("cast", "station_scoop", `stand ${key(S)} d=${d[0]},${d[1]} targets ${st.targets.length} sealed ${sealed} filled ${here}`, bot.entity.position);
		if (here === 0) excluded.push(S);
	}
	return got;
};
