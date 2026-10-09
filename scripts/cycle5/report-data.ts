// Numbers for the cycle-5 report, from the box gym clone's data files. Run in the gym clone:
//   node --import ./typecraft-resolve.mjs scripts/cycle5/report-data.ts data/gym
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { bootstrapMeanDiff, fmtRate, quantile } from "../../src/lib/steve/ml/stats.ts";
import { runMetrics, type RunMetrics, type TelemetryEvent } from "../../src/lib/steve/ml/screen.ts";

const D = process.argv[2] ?? "data/gym";
const SINCE = "2026-10-04T01:00";
const db = new DatabaseSync(`${D}/batches.db`);
const tel = new DatabaseSync(`${D}/telemetry.sqlite`);
type Run = Record<string, unknown>;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
const f2 = (x: number) => (Number.isNaN(x) ? "-" : x.toFixed(2));

// 1. Batches this cycle.
const runs = db.prepare(`select * from runs where started_at >= '${SINCE}' order by started_at`).all() as Run[];
const byBatch = new Map<string, Run[]>();
for (const r of runs) byBatch.set(String(r.batch), [...(byBatch.get(String(r.batch)) ?? []), r]);
console.log("# batches since", SINCE);
for (const [b, rs] of byBatch) {
	const real = rs.filter((r) => !["harness", "disconnect", "aborted"].includes(String(r.outcome)));
	const pass = real.filter((r) => r.outcome === "pass");
	const bf = real.map((r) => Number(r.best_frame ?? 0));
	const counters: Record<string, number> = {};
	for (const r of real) for (const [k, v] of Object.entries(JSON.parse(String(r.counters ?? "{}")) as Record<string, number>)) counters[k] = (counters[k] ?? 0) + v;
	const ttp = pass.map((r) => Number(r.time_to_portal_s ?? r.seconds));
	const ticks = rs.map((r) => Number(r.tick_ms)).filter((x) => !Number.isNaN(x));
	const p99 = rs.map((r) => Number(r.tick_p99_ms)).filter((x) => !Number.isNaN(x));
	console.log(
		`${b} | ${rs[0]!.slug} | ${rs[0]!.commit_hash} | ${rs[0]!.started_at} | n=${rs.length} real=${real.length} harness=${rs.filter((r) => r.outcome === "harness").length} aborted=${rs.filter((r) => r.outcome === "aborted").length} | pass ${fmtRate(pass.length, real.length)} | best_frame ${bf.join(",")} mean ${f2(mean(bf))} median ${real.length ? quantile(bf, 0.5) : "-"} | deaths mean ${f2(mean(real.map((r) => Number(r.deaths ?? 0))))} | gap_med ${f2(quantile(real.map((r) => Number(r.block_gap_med_s)).filter((x) => x > 0), 0.5))} | pass s ${ttp.map((x) => Math.round(x)).join(",") || "-"} median ${ttp.length ? Math.round(quantile(ttp, 0.5)) : "-"} | tick mean ${f2(mean(ticks))} p99 max ${p99.length ? Math.max(...p99).toFixed(1) : "-"} | tick_rate ${[...new Set(rs.map((r) => r.tick_rate))].join(",")} | game_ticks ${rs.map((r) => r.game_ticks ?? "-").join(",")} | mem min ${Math.min(...rs.map((r) => Number(r.mem_avail_mb ?? 1e9)))} | forceloads ${[...new Set(rs.map((r) => r.forceloads))].join(",")}`,
	);
	console.log(`   counters ${JSON.stringify(counters)}`);
	console.log(`   messages ${rs.map((r) => `${r.run_id}:${r.outcome}:${String(r.message).slice(0, 110)}`).join(" || ")}`);
}

// 2. Screening comparisons (compare.ts --means logic) for natural screens.
const q = tel.prepare("SELECT ts, category, event, detail FROM events WHERE race_id = ? AND category IN ('cast','death') ORDER BY ts");
const load = (spec: string): RunMetrics[] => {
	const [batches, capS] = spec.split("@");
	return batches!.split(",").flatMap((batch) =>
		(db.prepare("SELECT run_id, slug FROM runs WHERE batch = ? AND outcome NOT IN ('harness','disconnect','aborted') ORDER BY started_at").all(batch) as { run_id: string; slug: string }[]).map((r) =>
			runMetrics(q.all(`gym-${r.slug}-${r.run_id}`) as unknown as TelemetryEvent[], capS ? Number(capS) : undefined),
		),
	);
};
const cmp = (A: string, B: string) => {
	const a = load(A);
	const b = load(B);
	const out: string[] = [];
	for (const [name, get, dir] of [
		["best_frame", (m: RunMetrics) => m.best_frame, "up"],
		["deaths", (m: RunMetrics) => m.deaths, "down"],
		["lava_deaths", (m: RunMetrics) => m.lava_deaths, "down"],
	] as const) {
		const xa = a.map(get);
		const xb = b.map(get);
		const r = bootstrapMeanDiff(xa, xb);
		out.push(`${name} ${f2(mean(xa))}→${f2(mean(xb))} P(B better)=${(dir === "up" ? r.pBGreater : 1 - r.pBGreater).toFixed(3)} [${r.lo.toFixed(2)},${r.hi.toFixed(2)}]`);
	}
	console.log(`cmp ${A} (n=${a.length}) vs ${B} (n=${b.length}): ${out.join("; ")}`);
};
console.log("\n# comparisons");
const nat = [...byBatch.keys()].filter((b) => byBatch.get(b)![0]!.slug === "portal-natural" && /^s\d+[nm]$/.test(b));
let prev = "base3@1800";
for (const b of nat) {
	cmp("base3@1800", `${b}@1800`);
	if (prev !== "base3@1800") cmp(prev, `${b}@1800`);
	prev = `${b}@1800`;
}
cmp("base3@1800", `${nat.join(",")}@1800`);

// 3. attempts.jsonl this cycle.
const lines = readFileSync(`${D}/attempts.jsonl`, "utf8").trim().split("\n");
let bad = 0;
const rows = lines.flatMap((l) => {
	try {
		return [JSON.parse(l)];
	} catch {
		bad++;
		return [];
	}
});
const since = Date.parse(SINCE + ":00Z");
const cyc = rows.filter((r) => Number(r.start_ms) >= since);
console.log(`\n# attempts.jsonl rows ${rows.length} (unparseable ${bad}); this cycle ${cyc.length}`);
const bySkill = new Map<string, typeof cyc>();
for (const r of cyc) {
	const kind = /-d\d+$/.test(r.run_id) ? "dispatch" : /-lsm-/.test(r.run_id) ? "primitive" : "run";
	const k = `${r.skill}|${kind}|${r.source}`;
	bySkill.set(k, [...(bySkill.get(k) ?? []), r]);
}
for (const [k, rs] of [...bySkill].sort()) {
	const ok = rs.filter((r) => r.outcome === "ok").length;
	const out = new Map<string, number>();
	for (const r of rs) out.set(r.outcome, (out.get(r.outcome) ?? 0) + 1);
	const dc = new Map<string, number>();
	for (const r of rs) if (r.outcome === "death") dc.set(String(r.death_cause), (dc.get(String(r.death_cause)) ?? 0) + 1);
	console.log(`${k}: n=${rs.length} ok ${fmtRate(ok, rs.length)} median ${quantile(rs.map((r) => r.duration_s), 0.5).toFixed(0)} s; outcomes ${[...out].map(([a, b]) => `${a} ${b}`).join(", ")}; deaths ${[...dc].map(([a, b]) => `${a} ${b}`).join(", ") || 0}; hours ${(rs.reduce((a, r) => a + r.duration_s, 0) / 3600).toFixed(2)}`);
}
const reasons = new Map<string, number>();
for (const r of cyc.filter((r) => r.skill === "portal_cast" && r.outcome !== "ok")) {
	const k = String(r.reason ?? "").replace(/-?\d+(\.\d+)?/g, "#").slice(0, 90);
	reasons.set(k, (reasons.get(k) ?? 0) + 1);
}
console.log("top cast failure reasons:", [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${v}× ${k}`).join(" | "));

// 4. Integrity: cycle runs without a run-level attempt row.
const runIds = new Set(cyc.filter((r) => !/-d\d+$/.test(r.run_id) && !/-lsm-/.test(r.run_id)).map((r) => String(r.run_id)));
const missing = runs.filter((r) => ![...runIds].some((id) => id.endsWith(String(r.run_id))));
console.log(`\n# runs without a run-level attempt row: ${missing.length}: ${missing.map((r) => `${r.run_id}(${r.outcome})`).join(", ")}`);

// 5. Bandit posteriors.
const pf = existsSync("data/params.json") ? "data/params.json" : `${D}/../params.json`;
if (existsSync(pf)) {
	const p = JSON.parse(readFileSync(pf, "utf8")) as Record<string, { arms: Record<string, [number, number]>; pin?: string }>;
	console.log("\n# params.json");
	for (const [k, v] of Object.entries(p))
		console.log(`${k}${v.pin ? ` (pinned ${v.pin})` : ""}: ${Object.entries(v.arms).map(([arm, [a, b]]) => `${arm}: mean ${(a / (a + b)).toFixed(2)} n=${a + b - 2}`).join(", ")}`);
}
