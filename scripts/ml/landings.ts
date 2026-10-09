/**
 * Build a paired landing set (cycle 6, decision 1): N natural landings, pregenerated and
 * pre-checked, written to data/gym/landings-<set>.json as [[x, z], ...] for GYM_LANDINGS, with
 * a sidecar landings-<set>.meta.json holding y and the checks.
 *
 *   GYM_SERVER=local-1 SET=A CENTER=20000,20000 node --env-file=.env --import ./typecraft-resolve.mjs scripts/ml/landings.ts
 *
 * A landing passes when: the surface (motion_blocking_no_leaves) is not water, lava or ice;
 * no water on the surface within 8 blocks (probed every block); no ruined portal (the
 * overworld's only natural obsidian frames) within 200. Candidates sit on a grid SPACING
 * apart so one landing's frames never come within 200 of another; a failed candidate is
 * nudged up to 6 times. Each landing's ±PREGEN_R square is generated before it is checked.
 */
import { writeFileSync } from "node:fs";
import { applyServerProfile } from "../../src/lib/steve/gym/server-profile.ts";
import { connect } from "../../src/lib/steve/lib/rcon.ts";

applyServerProfile();
const SET = process.env.SET ?? "A";
const N = Number(process.env.N ?? 12);
const [CX, CZ] = (process.env.CENTER ?? "20000,20000").split(",").map(Number) as [number, number];
const SPACING = Number(process.env.SPACING ?? 640);
const PREGEN_R = Number(process.env.PREGEN_R ?? 128);
const rcon = await connect({ timeout: 60_000 });
const cmd = (c: string) => rcon.command(c).catch((e) => `ERR ${e instanceof Error ? e.message : e}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const passed = (r: string) => /passed/i.test(r);

const pregen = async (x: number, z: number): Promise<void> => {
	for (let x0 = x - PREGEN_R; x0 < x + PREGEN_R; x0 += 128)
		for (let z0 = z - PREGEN_R; z0 < z + PREGEN_R; z0 += 128) {
			await cmd(`forceload add ${x0} ${z0} ${x0 + 127} ${z0 + 127}`);
			for (let w = 0; w < 120; w++) {
				if (passed(await cmd(`execute if loaded ${x0} 0 ${z0}`)) && passed(await cmd(`execute if loaded ${x0 + 127} 0 ${z0 + 127}`))) break;
				await sleep(500);
			}
			await cmd(`forceload remove ${x0} ${z0} ${x0 + 127} ${z0 + 127}`);
		}
};

const surfaceIs = async (x: number, z: number, block: string, map = "motion_blocking_no_leaves"): Promise<boolean> =>
	passed(await cmd(`execute positioned ${x} 0 ${z} positioned over ${map} if block ~ ~-1 ~ ${block}`));

const heightAt = async (x: number, z: number): Promise<number | null> => {
	await cmd(`execute positioned ${x} 0 ${z} positioned over motion_blocking_no_leaves run summon minecraft:marker ~ ~ ~ {Tags:["landing_h"]}`);
	const r = await cmd(`data get entity @e[type=minecraft:marker,tag=landing_h,limit=1] Pos[1]`);
	await cmd("kill @e[type=minecraft:marker,tag=landing_h]");
	const m = /(-?[\d.]+)d/.exec(r);
	return m ? Math.floor(Number(m[1])) : null;
};

const PORTALS = ["ruined_portal", "ruined_portal_desert", "ruined_portal_jungle", "ruined_portal_swamp", "ruined_portal_mountain", "ruined_portal_ocean"];
const nearestPortal = async (x: number, z: number): Promise<number> => {
	let best = Number.POSITIVE_INFINITY;
	for (const s of PORTALS) {
		const r = await cmd(`execute positioned ${x} 64 ${z} run locate structure minecraft:${s}`);
		const m = /\((\d+) blocks? away\)/.exec(r);
		if (m) best = Math.min(best, Number(m[1]));
	}
	return best;
};

type Meta = { x: number; z: number; y: number; portal_d: number; tries: number };
const out: Meta[] = [];
const side = Math.ceil(Math.sqrt(N));
const t0 = Date.now();
for (let i = 0; out.length < N && i < N * 3; i++) {
	const gx = CX + ((i % side) - Math.floor(side / 2)) * SPACING;
	const gz = CZ + (Math.floor(i / side) - Math.floor(side / 2)) * SPACING;
	let ok: Meta | null = null;
	for (let t = 0; t < 6 && !ok; t++) {
		const x = gx + t * 48;
		const z = gz + (t % 2 ? 32 : 0);
		await pregen(x, z);
		await cmd(`forceload add ${x - 8} ${z - 8} ${x + 8} ${z + 8}`);
		const why: string[] = [];
		for (const b of ["minecraft:water", "minecraft:lava", "#minecraft:ice"]) if (await surfaceIs(x, z, b)) why.push(`surface ${b}`);
		if (!why.length) {
			scan: for (let dx = -8; dx <= 8; dx++)
				for (let dz = -8; dz <= 8; dz++)
					if (await surfaceIs(x + dx, z + dz, "minecraft:water", "motion_blocking")) {
						why.push(`water at ${dx},${dz}`);
						break scan;
					}
		}
		const y = why.length ? null : await heightAt(x, z);
		if (!why.length && (y === null || y < 55)) why.push(`y=${y}`);
		const portalD = why.length ? -1 : await nearestPortal(x, z);
		if (!why.length && portalD <= 200) why.push(`ruined portal ${portalD}`);
		await cmd(`forceload remove ${x - 8} ${z - 8} ${x + 8} ${z + 8}`);
		console.log(`cand ${i}.${t} ${x},${z}: ${why.length ? `rejected (${why.join("; ")})` : `ok y=${y} portal ${portalD}`}`);
		if (!why.length) ok = { x, z, y: y!, portal_d: portalD, tries: t + 1 };
	}
	if (ok) out.push(ok);
}
console.log(`forceloads after: ${await cmd("forceload query")}`);
const file = `data/gym/landings-${SET}.json`;
writeFileSync(file, `${JSON.stringify(out.map((m) => [m.x, m.z]))}\n`);
writeFileSync(`data/gym/landings-${SET}.meta.json`, `${JSON.stringify({ set: SET, center: [CX, CZ], spacing: SPACING, pregen_r: PREGEN_R, built_s: Math.round((Date.now() - t0) / 1000), landings: out }, null, 2)}\n`);
console.log(`${out.length}/${N} landings → ${file} in ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(0);
