/**
 * Pregenerate one landing set's world on a runner (prepare-env.yml, cycle 7 Part 4.1). The
 * server must be up (scripts/ci/server.sh start) and GYM_SERVER=runner set.
 *
 *   SET=A node --import ./typecraft-resolve.mjs scripts/ci/prepare-world.ts <out-dir>
 *
 * Builds the landing set with scripts/ml/landings.ts (each landing's ±pregen_r square
 * generated and checked), generates the race region (±r around the nearest forest to the
 * race base), the End centre and one Nether fortress patch found by locate, waits until
 * every patch reports loaded, releases every forceload, and writes <out-dir>/world-meta.json
 * and <out-dir>/landings-<set>.json. Harness-only RCON: nothing here reaches the bot.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { applyServerProfile } from "../../src/lib/steve/gym/server-profile.ts";
import { connect } from "../../src/lib/steve/lib/rcon.ts";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: prepare-world.ts <out-dir>");
const SET = process.env.SET ?? "A";
const env = JSON.parse(readFileSync(process.env.CI_ENV_FILE ?? "ci/env.json", "utf8"));
const set = env.landing_sets[SET];
if (!set) throw new Error(`no landing set ${SET} in ci/env.json`);
applyServerProfile();
const rcon = await connect({ timeout: 120_000 });
const cmd = (c: string) => rcon.command(c).catch((e) => `ERR ${e instanceof Error ? e.message : e}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const passed = (r: string) => /passed/i.test(r);
const t0 = Date.now();
const log = (s: string) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${s}`);

/** Generate the square [x0, x1] × [z0, z1] in a dimension, 128-block slices at a time. */
const generate = async (dim: string, x0: number, z0: number, x1: number, z1: number): Promise<number> => {
	const inDim = (c: string) => `execute in minecraft:${dim} run ${c}`;
	let slices = 0;
	for (let x = x0; x <= x1; x += 128)
		for (let z = z0; z <= z1; z += 128) {
			const xe = Math.min(x + 127, x1);
			const ze = Math.min(z + 127, z1);
			await cmd(inDim(`forceload add ${x} ${z} ${xe} ${ze}`));
			let ok = false;
			for (let w = 0; w < 600 && !ok; w++) {
				ok = passed(await cmd(`execute in minecraft:${dim} if loaded ${x} 0 ${z}`)) && passed(await cmd(`execute in minecraft:${dim} if loaded ${xe} 0 ${ze}`));
				if (!ok) await sleep(250);
			}
			if (!ok) throw new Error(`${dim} slice ${x},${z} never loaded`);
			await cmd(inDim(`forceload remove ${x} ${z} ${xe} ${ze}`));
			slices++;
		}
	return slices;
};

log(`seed ${await cmd("seed")}`);

// 1. The landing set (landings.ts pregenerates and checks each landing).
mkdirSync("data/gym", { recursive: true });
const r = spawnSync(process.execPath, ["--import", "./typecraft-resolve.mjs", "scripts/ml/landings.ts"], {
	stdio: "inherit",
	env: { ...process.env, SET, N: String(set.n), CENTER: set.center.join(","), SPACING: String(set.spacing), PREGEN_R: String(set.pregen_r) },
});
if (r.status !== 0) throw new Error(`landings.ts exited ${r.status}`);
const landings = JSON.parse(readFileSync(`data/gym/landings-${SET}.json`, "utf8")) as [number, number][];
if (landings.length < set.n) throw new Error(`landing set ${SET}: ${landings.length}/${set.n}`);
log(`landing set ${SET}: ${landings.length} landings`);

// 2. The race region: ±r around the nearest forest to the race base (main.ts does the same locate).
const [bx, bz] = env.race.base as [number, number];
const loc = await cmd(`execute positioned ${bx} 64 ${bz} run locate biome minecraft:forest`);
const m = /\[(-?\d+), (?:~|-?\d+), (-?\d+)\]/.exec(loc);
const race = m ? [Number(m[1]), Number(m[2])] : [bx, bz];
const R = env.race.r as number;
const raceSlices = await generate("overworld", race[0]! - R, race[1]! - R, race[0]! + R - 1, race[1]! + R - 1);
log(`race region ±${R} around ${race.join(",")}: ${raceSlices} slices`);

// 3. The End centre.
const e = env.end_r_chunks * 16;
await generate("the_end", -e, -e, e - 1, e - 1);
log(`End centre ±${env.end_r_chunks} chunks`);

// 4. One Nether fortress patch.
const fl = await cmd("execute in minecraft:the_nether positioned 0 64 0 run locate structure minecraft:fortress");
const fm = /\[(-?\d+), (?:~|-?\d+), (-?\d+)\]/.exec(fl);
if (!fm) throw new Error(`fortress locate: ${fl}`);
const fortress = [Number(fm[1]), Number(fm[2])];
const f = env.fortress_r_chunks * 16;
await generate("the_nether", fortress[0]! - f, fortress[1]! - f, fortress[0]! + f - 1, fortress[1]! + f - 1);
log(`fortress at ${fortress.join(",")}, ±${env.fortress_r_chunks} chunks`);

// 5. Release everything and save.
for (const dim of ["overworld", "the_nether", "the_end"]) await cmd(`execute in minecraft:${dim} run forceload remove all`);
const left = await Promise.all(["overworld", "the_nether", "the_end"].map((d) => cmd(`execute in minecraft:${d} run forceload query`)));
if (left.some((l) => !/No force loaded/i.test(l))) throw new Error(`forceloads left: ${left.join(" | ")}`);
log(await cmd("save-all flush"));

mkdirSync(OUT, { recursive: true });
copyFileSync(`data/gym/landings-${SET}.json`, `${OUT}/landings-${SET}.json`);
copyFileSync(`data/gym/landings-${SET}.meta.json`, `${OUT}/landings-${SET}.meta.json`);
const seed = /\[(-?\d+)\]/.exec(await cmd("seed"))?.[1] ?? null;
writeFileSync(
	`${OUT}/world-meta.json`,
	`${JSON.stringify({ set: SET, level_seed: env.level_seed, seed, landings, race_base: race, race_r: R, fortress, end_r_chunks: env.end_r_chunks, fortress_r_chunks: env.fortress_r_chunks, built_s: Math.round((Date.now() - t0) / 1000) }, null, 2)}\n`,
);
log(`world meta written to ${OUT}`);
process.exit(0);
