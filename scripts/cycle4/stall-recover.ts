// Part 6 report: no-progress time in the cycle-3 natural runs (batches n*) that a
// 180 s stall rule would have cut. Progress = obsidian events and the deepest cast
// sub-phase (from heartbeat phase=...). Distance-to-target is not in the old traces,
// so this over-counts stalls during long walks (an upper bound).
import { DatabaseSync } from "node:sqlite";
const STALL = Number(process.argv[2] ?? 180) * 1000;
const RANK: Record<string, number> = { find_lava: 1, anchor: 2, chamber: 3, lava_fill: 4, portal_start: 5, mold: 6, lava: 7, water: 8, verify: 9, light: 1000, enter: 1001 };
const runs = new DatabaseSync("data/gym/batches.db")
	.prepare("select run_id, seconds from runs where slug='portal-natural' and batch like 'n%' and outcome != 'harness'")
	.all() as { run_id: string; seconds: number }[];
const tel = new DatabaseSync("data/gym/telemetry.sqlite");
const q = tel.prepare("select ts, category, event, detail from events where race_id = ? order by ts");
let total = 0;
let cut = 0;
let n = 0;
for (const r of runs) {
	const ev = q.all(`gym-portal-natural-${r.run_id}`) as { ts: string; category: string; event: string; detail: string | null }[];
	if (!ev.length) continue;
	n++;
	let obs = 0;
	let rank = 0;
	let best = 0;
	let last = Date.parse(ev[0]!.ts);
	const end = Date.parse(ev[ev.length - 1]!.ts);
	let runCut = 0;
	for (const e of ev) {
		const t = Date.parse(e.ts);
		if (e.category === "cast" && e.event === "obsidian") obs++;
		const m = /phase=([a-z_]+)/.exec(e.detail ?? "");
		if (m && RANK[m[1]!] !== undefined) rank = RANK[m[1]!]!;
		if (e.category === "lifecycle" && e.event === "respawn") rank = 0; // a death restarts the ratchet
		const score = rank >= 1000 ? rank : obs * 10 + rank;
		if (score > best) {
			if (t - last > STALL) runCut += t - last - STALL;
			best = score;
			last = t;
		}
	}
	if (end - last > STALL) runCut += end - last - STALL;
	total += end - Date.parse(ev[0]!.ts);
	cut += runCut;
}
console.log(`runs ${n}, run time ${(total / 3.6e6).toFixed(2)} h, no-progress beyond ${STALL / 1000} s: ${(cut / 3.6e6).toFixed(2)} h (${((100 * cut) / total).toFixed(0)}%)`);
