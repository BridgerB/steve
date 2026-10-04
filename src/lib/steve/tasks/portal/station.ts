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
}

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
const visibleSources = (bot: Bot, deps: StationDeps, r: number): Vec3[] =>
	(bot.findBlocks({ matching: (n: string) => n === "lava", maxDistance: r, count: 400 } as never) as Vec3[])
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

const candidateStands = (bot: Bot, deps: StationDeps, frame: Vec3 | null, excluded: Vec3[]): Stand[] => {
	const inFrame = (p: Vec3) =>
		!!frame && p.x >= frame.x - 1 && p.x <= frame.x + 4 && p.z >= frame.z - 2 && p.z <= frame.z + 2 && p.y >= frame.y - 1 && p.y <= frame.y + 6;
	const nearExcluded = (p: Vec3) => excluded.some((e) => Math.abs(e.x - p.x) <= 2 && Math.abs(e.z - p.z) <= 2 && Math.abs(e.y - p.y) <= 2);
	const seen = new Set<string>();
	const out: Stand[] = [];
	for (const L of visibleSources(bot, deps, 20)) {
		const O = vec3(L.x, L.y + 1, L.z);
		if (!deps.isAir(deps.name(O))) continue;
		for (const d of DIRS) {
			const S = vec3(O.x - d[0], O.y, O.z - d[1]);
			const k = `${key(S)}|${d[0]},${d[1]}`;
			if (seen.has(k)) continue;
			seen.add(k);
			if (inFrame(S) || nearExcluded(S)) continue;
			const floor = deps.name(vec3(S.x, S.y - 1, S.z));
			if (!deps.isSolid(floor) || deps.isLava(floor)) continue;
			if (!deps.isAir(deps.name(S)) || !deps.isAir(deps.name(vec3(S.x, S.y + 1, S.z)))) continue;
			const targets = targetsFor(deps, S, d);
			if (targets.length) out.push({ S, d, targets });
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

const atStand = (bot: Bot, S: Vec3): boolean => {
	const p = bot.entity.position;
	return Math.floor(p.y) === S.y && Math.hypot(p.x - (S.x + 0.5), p.z - (S.z + 0.5)) <= 0.7;
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
	for (let site = 0; site < 3 && !opts.enough(); site++) {
		const st = candidateStands(bot, deps, opts.frame, excluded)[0];
		if (!st) {
			logEvent("cast", "station_none", `no stand with a target (site ${site}, excluded ${excluded.length})`, bot.entity.position);
			break;
		}
		const { S, d } = st;
		bot.setControlState("sneak", false);
		await goTo(bot, S, { range: 0, timeout: 20000 }).catch(() => false);
		await walkToXZ(bot, S.x + 0.5, S.z + 0.5, { targetDist: 0.25, maxTime: 2500 }).catch(() => {});
		if (!atStand(bot, S)) {
			const p = bot.entity.position;
			logEvent("cast", "station_walk_fail", `stand ${key(S)} bot ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`, p);
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
