/**
 * Fleet report (cycle 7): markdown for the aggregate job's summary. Per gym experiment: each
 * arm's pass rate with its Wilson interval and screening means, then the paired comparison of
 * every arm against the first. Per race: the funnel. Then fleet timing from trials.jsonl.
 *
 *   node scripts/ci/fleet-report.ts <plan.json> <data-dir> <artifacts-dir>
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fmtRate, quantile } from "../../src/lib/steve/ml/stats.ts";

const [planFile, dataDir, artDir] = process.argv.slice(2);
if (!planFile || !dataDir || !artDir) throw new Error("usage: fleet-report.ts <plan.json> <data-dir> <artifacts-dir>");
const plan = JSON.parse(readFileSync(planFile, "utf8")) as {
	label: string;
	experiments: { name: string; kind?: string; slug?: string; arms?: { name: string; ref?: string; env?: Record<string, string> }[] }[];
};
const db = new DatabaseSync(join(dataDir, "gym/batches.db"), { readOnly: true });
const attempts = join(dataDir, "gym/attempts.jsonl");
const out: string[] = [`# fleet ${plan.label}`, ""];
const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-");

for (const e of plan.experiments) {
	const arms = e.arms?.length ? e.arms : [{ name: "a" }];
	if (e.kind === "race") {
		out.push(`## ${e.name} (race)`, "", "```");
		const r = spawnSync(process.execPath, ["scripts/ml/race-funnel.ts", "2", attempts], { encoding: "utf8" });
		out.push((r.stdout || r.stderr || "no race rows").trim(), "```", "");
		continue;
	}
	out.push(`## ${e.name} (${e.slug})`, "", "| arm | ref / env | pass | best frame | obsidian | deaths | median s |", "|---|---|---|---|---|---|---|");
	for (const a of arms) {
		const batch = `${plan.label}-${e.name}-${a.name}`;
		const rows = db.prepare("SELECT outcome, seconds, best_frame, obsidian, deaths FROM runs WHERE batch = ?").all(batch) as { outcome: string; seconds: number; best_frame: number | null; obsidian: number | null; deaths: number | null }[];
		const real = rows.filter((r) => !["harness", "disconnect", "aborted"].includes(r.outcome));
		const desc = [a.ref ?? "", Object.entries(a.env ?? {}).map(([k, v]) => `${k}=${v}`).join(" ")].filter(Boolean).join(" ") || "tree";
		out.push(
			`| ${a.name} | ${desc} | ${fmtRate(real.filter((r) => r.outcome === "pass").length, real.length)} (harness ${rows.length - real.length}) | ${mean(real.map((r) => Number(r.best_frame ?? 0)))} | ${mean(real.map((r) => Number(r.obsidian ?? 0)))} | ${mean(real.map((r) => Number(r.deaths ?? 0)))} | ${real.length ? quantile(real.map((r) => r.seconds), 0.5).toFixed(0) : "-"} |`,
		);
	}
	for (const a of arms.slice(1)) {
		const r = spawnSync(process.execPath, ["--import", "./typecraft-resolve.mjs", "scripts/ml/compare.ts", "--paired", `${plan.label}-${e.name}-${arms[0]!.name}`, `${plan.label}-${e.name}-${a.name}`], {
			encoding: "utf8",
			env: { ...process.env, BATCHES_DB: join(dataDir, "gym/batches.db"), STEVE_ATTEMPTS_FILE: attempts },
		});
		out.push("", `paired: ${a.name} against ${arms[0]!.name}`, "```", (r.stdout || r.stderr).trim(), "```");
	}
	out.push("");
}

// Fleet timing.
const find = (dir: string): string[] =>
	readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? find(p) : n === "trials.jsonl" ? [p] : [];
	});
const trials = find(artDir).flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { worker: string; wall_s?: number; server_up_s?: number; exit: unknown }));
const workers = new Map<string, number>();
for (const t of trials) workers.set(t.worker, (workers.get(t.worker) ?? 0) + (t.wall_s ?? 0));
const ups = trials.map((t) => t.server_up_s).filter((x): x is number => typeof x === "number");
out.push(
	"## fleet",
	"",
	`${trials.length} trials on ${workers.size} workers; worker wall ${Math.min(...workers.values())}–${Math.max(...workers.values())} s; server start median ${ups.length ? quantile(ups, 0.5).toFixed(0) : "-"} s; harness errors ${trials.filter((t) => t.exit === "harness").length}`,
);
console.log(out.join("\n"));
