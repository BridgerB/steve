// Numbers for the cycle-4 report, from the box's batches.db and attempts.jsonl copies.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fmtRate, quantile, wilson } from "../../src/lib/steve/ml/stats.ts";
const D = process.argv[2]!;
const db = new DatabaseSync(`${D}/batches.db`);
const cols = (db.prepare("pragma table_info(runs)").all() as { name: string }[]).map((c) => c.name);
console.log("columns:", cols.join(","));
type Run = Record<string, unknown>;
const runs = db.prepare("select * from runs where started_at >= '2026-10-03T08:00' order by started_at").all() as Run[];
const byBatch = new Map<string, Run[]>();
for (const r of runs) byBatch.set(String(r.batch), [...(byBatch.get(String(r.batch)) ?? []), r]);
for (const [b, rs] of byBatch) {
	const real = rs.filter((r) => r.outcome !== "harness" && r.outcome !== "disconnect");
	const pass = real.filter((r) => r.outcome === "pass").length;
	console.log(`\n## ${b} slug=${rs[0]!.slug} commit=${rs[0]!.commit_hash} n=${rs.length} real=${real.length}`);
	console.log(`pass ${fmtRate(pass, real.length)}`);
	console.log("per run:", rs.map((r) => `${r.run_id}:${r.outcome}/${Math.round(Number(r.seconds))}s/obs${r.obsidian}/d${r.deaths ?? "?"}/disp${r.dispatches ?? "?"}/ttp${r.time_to_portal_s ?? "-"}/fl${r.forceloads}/mem${r.mem_avail_mb}/tick${r.tick_ms}/p99 ${r.tick_p99_ms}/land${r.landing_x},${r.landing_z}/y${r.land_y}/seed${r.seed}`).join("\n  "));
	const obs = rs.map((r) => Number(r.obsidian ?? 0));
	console.log(`obsidian median ${quantile(obs, 0.5)} max ${Math.max(...obs)}; deaths total ${rs.reduce((a, r) => a + Number(r.deaths ?? 0), 0)}`);
	const causes = new Map<string, number>();
	for (const r of rs) causes.set(String(r.death_cause ?? "-"), (causes.get(String(r.death_cause ?? "-")) ?? 0) + 1);
	console.log("run death_cause:", [...causes].map(([k, v]) => `${v}× ${k}`).join(", "));
	const ph = new Map<string, number>();
	for (const r of rs) {
		const k = String(r.deepest_phase ?? "").split(/[ ,]/)[0] || "(none)";
		ph.set(k, (ph.get(k) ?? 0) + 1);
	}
	console.log("deepest phase:", [...ph].map(([k, v]) => `${v}× ${k}`).join(", "));
}
// Cycle-3 natural, for "before"
const c3 = db.prepare("select * from runs where slug='portal-natural' and batch like 'n%' and outcome not in ('harness','disconnect')").all() as Run[];
console.log(`\n## cycle-3 natural n*: ${fmtRate(c3.filter((r) => r.outcome === "pass").length, c3.length)}; lava deaths ${c3.filter((r) => /lava/.test(String(r.death_cause ?? ""))).length}, drown ${c3.filter((r) => /drown/.test(String(r.death_cause ?? ""))).length}, any death ${c3.filter((r) => r.death_cause).length}`);
const arena = db.prepare("select batch, count(*) n, sum(outcome='pass') p, round(avg(seconds)) s from runs where slug='build-nether-portal' group by batch order by min(started_at) desc limit 6").all();
console.log("recent arena batches:", JSON.stringify(arena));
// attempts
const rows = readFileSync(`${D}/attempts.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
console.log(`\n## attempts.jsonl rows ${rows.length}`);
const bySkill = new Map<string, typeof rows>();
for (const r of rows) {
	const k = `${r.skill}|${/-d\d+$/.test(r.run_id) ? "dispatch" : "run"}`;
	bySkill.set(k, [...(bySkill.get(k) ?? []), r]);
}
for (const [k, rs] of bySkill) {
	const ok = rs.filter((r) => r.outcome === "ok").length;
	const out = new Map<string, number>();
	for (const r of rs) out.set(r.outcome, (out.get(r.outcome) ?? 0) + 1);
	const dc = new Map<string, number>();
	for (const r of rs) if (r.outcome === "death") dc.set(String(r.death_cause), (dc.get(String(r.death_cause)) ?? 0) + 1);
	const dur = rs.map((r) => r.duration_s);
	console.log(`${k}: n=${rs.length} ok ${fmtRate(ok, rs.length)} median ${quantile(dur, 0.5).toFixed(0)} s; outcomes ${[...out].map(([a, b]) => `${a} ${b}`).join(", ")}; death causes ${[...dc].map(([a, b]) => `${a} ${b}`).join(", ")}; builds ${[...new Set(rs.map((r) => r.build))].join(",")}`);
}
const disp = rows.filter((r) => r.skill === "portal_cast" && /-d\d+$/.test(r.run_id));
const stall = disp.filter((r) => /no progress in/.test(r.reason));
const over = disp.filter((r) => /over budget/.test(r.reason));
console.log(`stall cuts ${stall.length}, total ${(stall.reduce((a, r) => a + r.duration_s, 0) / 3600).toFixed(2)} h in those attempts; budget remaining at cut (900 - dur) ${(stall.reduce((a, r) => a + Math.max(0, 900 - r.duration_s), 0) / 3600).toFixed(2)} h; over-budget cuts ${over.length}`);
const ranks = ["find_lava", "anchor", "chamber", "lava_fill", "portal_start", "mold", "lava", "water", "verify"];
const reached = (r: { deepest_phase: string; progress: number }) => r.progress > 0 || ranks.indexOf(String(r.deepest_phase).split(/[ ,]/)[0]!) >= 4;
console.log(`dispatches reaching portal_start or obsidian: ${fmtRate(disp.filter(reached).length, disp.length)}`);
const lsDur = disp.filter(reached).map((r) => r.duration_s);
console.log(`dispatch death rows ${disp.filter((r) => r.outcome === "death").length}; by phase ${JSON.stringify(Object.fromEntries([...new Set(disp.filter((r) => r.outcome === "death").map((r) => String(r.deepest_phase).split(/[ ,]/)[0]))].map((p) => [p, disp.filter((r) => r.outcome === "death" && String(r.deepest_phase).split(/[ ,]/)[0] === p).length])))}`);
const wl = wilson(0, 10);
console.log(`wilson 0/10 ${wl.lo},${wl.hi}; 0/16 ${JSON.stringify(wilson(0, 16))}`);
void lsDur;
