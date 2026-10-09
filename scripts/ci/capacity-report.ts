/**
 * Capacity report (cycle 7): which bots-per-server and server heap get the most trials out of a
 * 4-vCPU / 16 GB runner without hurting the bot. Reads a downloaded capacity fleet:
 * <artifacts>/**\/fleet/trials.jsonl and *.metrics.jsonl, and the merged batches.db.
 *
 *   node scripts/ci/capacity-report.ts <artifacts-dir> <batches.db> [label]
 *
 * Per setup (k bots, h GB): pass rate with its Wilson interval, median seconds to pass, machine
 * CPU mean and p95, lowest available memory, server CPU and RSS, per-bot CPU and RSS, server
 * tick p99 max after the first 60 s, and trials per runner-hour (k × 3600 / unit wall time).
 * Healthy = median per-sample tick p99 < 30 ms (the max is shown; single spikes reach 1.4 s even with one bot), machine CPU p95 < 90 %, memory never under 1.5 GB, pass rate
 * not below the 1-bot setup's interval and median time within 15 % of it. The recommendation is
 * the healthy setup with the most trials per runner-hour.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fmtRate, quantile, wilson } from "../../src/lib/steve/ml/stats.ts";

const [art, dbFile, label = "cap1"] = process.argv.slice(2);
if (!art || !dbFile) throw new Error("usage: capacity-report.ts <artifacts-dir> <batches.db> [label]");
const files = (dir: string, re: RegExp): string[] =>
	readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? files(p, re) : re.test(n) ? [p] : [];
	});
const jsonl = <T>(f: string): T[] =>
	readFileSync(f, "utf8")
		.split("\n")
		.filter(Boolean)
		.flatMap((l) => {
			try {
				return [JSON.parse(l) as T];
			} catch {
				return [];
			}
		});

type TrialRow = { id: string; unit: string; exp: string; shared?: number; heap_mb?: number | null; wall_s?: number; exit: unknown };
type Sample = { t: number; machine_cpu?: number; mem_avail_mb?: number; server?: { cpu: number; rss_mb: number }; trials?: { id: string; cpu: number; rss_mb: number }[]; tick_p99?: number; tick_mean?: number };
const trials = files(art, /^trials\.jsonl$/).flatMap((f) => jsonl<TrialRow>(f));
const samples = new Map<string, Sample[]>();
for (const f of files(art, /\.metrics\.jsonl$/)) samples.set(f.split("/").pop()!.replace(".metrics.jsonl", ""), jsonl<Sample>(f));
const db = new DatabaseSync(dbFile, { readOnly: true });

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "-");
type Row = { exp: string; k: number; h: number; n: number; pass: number; medPass: number; cpuMean: number; cpuP95: number; memMin: number; srvCpu: number; srvRss: number; botCpu: number; botRss: number; tickP99Max: number; tickP99Med: number; perHour: number; harness: number };
const rows: Row[] = [];
for (const exp of [...new Set(trials.map((t) => t.exp))].sort()) {
	const m = /^k(\d+)h(\d+)$/.exec(exp);
	if (!m) continue;
	const k = Number(m[1]);
	const h = Number(m[2]);
	const ts = trials.filter((t) => t.exp === exp);
	const units = [...new Set(ts.map((t) => t.unit))];
	const ss = units.flatMap((u) => samples.get(u) ?? []);
	const steady = ss.filter((s) => s.t > 60);
	const runs = db.prepare("SELECT outcome, seconds FROM runs WHERE batch = ?").all(`${label}-${exp}-a`) as { outcome: string; seconds: number }[];
	const real = runs.filter((r) => !["harness", "disconnect", "aborted"].includes(r.outcome));
	const passes = real.filter((r) => r.outcome === "pass");
	const unitWall = units.map((u) => Math.max(...ts.filter((t) => t.unit === u).map((t) => t.wall_s ?? 0)));
	rows.push({
		exp,
		k,
		h,
		n: real.length,
		pass: passes.length,
		medPass: passes.length ? quantile(passes.map((r) => r.seconds), 0.5) : Number.NaN,
		cpuMean: mean(steady.map((s) => s.machine_cpu ?? Number.NaN).filter(Number.isFinite)),
		cpuP95: steady.length ? quantile(steady.map((s) => s.machine_cpu ?? 0), 0.95) : Number.NaN,
		memMin: Math.min(...ss.map((s) => s.mem_avail_mb ?? Number.POSITIVE_INFINITY)),
		srvCpu: mean(steady.map((s) => s.server?.cpu ?? Number.NaN).filter(Number.isFinite)),
		srvRss: Math.max(...ss.map((s) => s.server?.rss_mb ?? 0)),
		botCpu: mean(steady.flatMap((s) => (s.trials ?? []).map((t) => t.cpu))),
		botRss: mean(steady.flatMap((s) => (s.trials ?? []).map((t) => t.rss_mb))),
		tickP99Max: Math.max(...steady.map((s) => s.tick_p99 ?? Number.NEGATIVE_INFINITY)),
		tickP99Med: (() => {
			const t = steady.map((s) => s.tick_p99).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
			return t.length ? quantile(t, 0.5) : Number.NaN;
		})(),
		perHour: unitWall.length ? (k * 3600) / quantile(unitWall, 0.5) : Number.NaN,
		harness: runs.length - real.length,
	});
}
rows.sort((a, b) => a.h - b.h || a.k - b.k);
const base = new Map(rows.filter((r) => r.k === 1).map((r) => [r.h, r]));
const healthy = (r: Row): string[] => {
	const why: string[] = [];
	// Typical tick health: the median of the per-sample p99s. The max is reported but one
	// spike (start-up, the arena's /fill) reached 1.4 s even with a single bot (cap1).
	if (!(r.tickP99Med < 30)) why.push(`tick p99 median ${f1(r.tickP99Med)} ms`);
	if (!(r.cpuP95 < 90)) why.push(`cpu p95 ${f1(r.cpuP95)} %`);
	if (!(r.memMin >= 1536)) why.push(`mem ${r.memMin} MB`);
	const b = base.get(r.h);
	if (b && r.k > 1) {
		if (r.n && b.n && r.pass / r.n < wilson(b.pass, b.n).lo) why.push("pass rate below 1-bot");
		if (Number.isFinite(r.medPass) && Number.isFinite(b.medPass) && r.medPass > b.medPass * 1.15) why.push(`time +${f1((r.medPass / b.medPass - 1) * 100)} %`);
	}
	return why;
};
console.log("| setup | pass | median pass s | machine cpu mean / p95 % | min mem MB | server cpu % / rss MB | per-bot cpu % / rss MB | tick p99 median / max ms | trials / runner-hour | healthy |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
	const why = healthy(r);
	console.log(`| ${r.k} bots, ${r.h} GB | ${fmtRate(r.pass, r.n)}${r.harness ? ` (+${r.harness} harness)` : ""} | ${f1(r.medPass)} | ${f1(r.cpuMean)} / ${f1(r.cpuP95)} | ${r.memMin} | ${f1(r.srvCpu)} / ${r.srvRss} | ${f1(r.botCpu)} / ${f1(r.botRss)} | ${f1(r.tickP99Med)} / ${f1(r.tickP99Max)} | ${f1(r.perHour)} | ${why.length ? `no: ${why.join("; ")}` : "yes"} |`);
}
const best = rows.filter((r) => healthy(r).length === 0).sort((a, b) => b.perHour - a.perHour)[0];
console.log(best ? `\nRecommended: ${best.k} bots per server, ${best.h} GB heap — ${f1(best.perHour)} trials per runner-hour (1 bot: ${f1(base.get(best.h)?.perHour ?? Number.NaN)}).` : "\nNo setup met every health condition.");
