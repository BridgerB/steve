// Cycle 4 §7.5 — water invariants on the dig-down (apply AFTER 7.1-7.4 batches).
// Run from the steve repo root: node <this file>
import { readFileSync, writeFileSync } from "node:fs";
const sub = (f: string, a: string, b: string) => {
	const s = readFileSync(f, "utf8");
	if (!s.includes(a)) throw new Error(`missing in ${f}: ${a.slice(0, 70)}`);
	writeFileSync(f, s.replace(a, b));
};
const m = "src/lib/steve/tasks/mining/main.ts";
sub(m, `export const digDownVertical = async (
	bot: Bot,
	targetY: number,
	deadline: number,
	harvest?: { isTarget: (name: string) => boolean; dropItem: string },
	stallMs?: number,
): Promise<{ y: number; stopped: string | null }> => {`, `// Cycle 4 §7.5: a 1×1 shaft floods from the SIDE through a one-block wall. Before the
// block under the feet is dug, any water/lava in its four side cells is sealed with a
// placed block (against the block itself, else any solid neighbour). -1 = could not.
const SEAL_BLOCKS = ["cobblestone", "cobbled_deepslate", "dirt", "andesite", "granite", "diorite", "tuff", "netherrack"];
const sealBesideBelow = async (bot: Bot, below: Block): Promise<number> => {
	let sealed = 0;
	const bp = below.position;
	for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
		const c = vec3(bp.x + dx, bp.y, bp.z + dz);
		if (!isLiquid(bot.blockAt(c) as Block | null)) continue;
		const name = SEAL_BLOCKS.find((n) => invCount(bot, n) > 0);
		if (!name || !(await equipItem(bot, name))) return -1;
		const refs: [Vec3, Vec3][] = [
			[bp, vec3(dx, 0, dz)],
			[vec3(c.x, c.y - 1, c.z), vec3(0, 1, 0)],
			[vec3(c.x + dx, c.y, c.z + dz), vec3(-dx, 0, -dz)],
			[vec3(c.x + dz, c.y, c.z + dx), vec3(-dz, 0, -dx)],
			[vec3(c.x - dz, c.y, c.z - dx), vec3(dz, 0, dx)],
		];
		for (const [rp, face] of refs) {
			const ref = bot.blockAt(rp) as Block | null;
			if (!ref || isAir(ref) || isLiquid(ref)) continue;
			try {
				await bot.placeBlockWithOptions(ref as never, face, { forceLook: true });
			} catch {}
			await sleep(200);
			if (!isLiquid(bot.blockAt(c) as Block | null)) break;
		}
		if (isLiquid(bot.blockAt(c) as Block | null)) return -1;
		sealed++;
	}
	return sealed;
};

export const digDownVertical = async (
	bot: Bot,
	targetY: number,
	deadline: number,
	harvest?: { isTarget: (name: string) => boolean; dropItem: string },
	stallMs?: number,
	seal = false,
): Promise<{ y: number; stopped: string | null }> => {`);
sub(m, `		if (bot.entity?.isInWater) return { y: floorY(bot), stopped: "in water" };
		if (!STONE_PLUS_PICKS.has`, `		if (bot.entity?.isInWater) return { y: floorY(bot), stopped: "in water" };
		// §7.5: head in water is tested at eye height (a surface floater's feet+1 is wet forever).
		if (seal) {
			const e = bot.entity.position;
			const eye = bot.blockAt(vec3(Math.floor(e.x), Math.floor(e.y + 1.62), Math.floor(e.z))) as Block | null;
			if (eye && /water/.test(eye.name)) return { y: floorY(bot), stopped: "head in water" };
		}
		if (!STONE_PLUS_PICKS.has`);
sub(m, `		if (below && !isAir(below)) {
			const broke = await lookDig(bot, below);`, `		if (below && !isAir(below)) {
			if (seal) {
				const n = await sealBesideBelow(bot, below as Block);
				if (n > 0) logEvent("mining", "shaft_sealed", \`\${n} liquid cell(s) beside y=\${fy - 1}\`, bot.entity.position);
			}
			const broke = await lookDig(bot, below);`);
const c = "src/lib/steve/tasks/portal/cast.ts";
sub(c, `			const r = await digDownVertical(bot, lava.y + 1, Math.min(deadline, Date.now() + 300000), undefined, 30000);`, `			const r = await digDownVertical(bot, lava.y + 1, Math.min(deadline, Date.now() + 300000), undefined, 30000, true);`);
sub(c, `			await digDownVertical(bot, lava.y + 1, Math.min(deadline, Date.now() + 120000), undefined, 30000);`, `			await digDownVertical(bot, lava.y + 1, Math.min(deadline, Date.now() + 120000), undefined, 30000, true);`);
console.log("7.5 applied");
