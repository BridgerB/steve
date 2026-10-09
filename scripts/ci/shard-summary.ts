/**
 * Markdown summary of gym batches for $GITHUB_STEP_SUMMARY (cycle 7, Part 4.2): one row per
 * run with the screening metrics and the non-zero per-fix counters, then the pass count with
 * its Wilson interval. Reads data/gym/batches.db and data/gym/attempts.jsonl.
 *
 *   node scripts/ci/shard-summary.ts <batch>[,<batch>...]
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fmtRate } from "../../src/lib/steve/ml/stats.ts";

const batches = (process.argv[2] ?? "").split(",").filter(Boolean);
const db = new DatabaseSync(process.env.BATCHES_DB ?? "data/gym/batches.db", { readOnly: true });
type Row = { run_id: string; slug: string; outcome: string; seconds: number; best_frame: number | null; obsidian: number | null; deaths: number | null; landing_x: number | null; landing_z: number | null; message: string | null; counters: string | null };
const rows = batches.flatMap(
	(b) => db.prepare("SELECT run_id, slug, outcome, seconds, best_frame, obsidian, deaths, landing_x, landing_z, message, counters FROM runs WHERE batch = ? ORDER BY started_at").all(b) as Row[],
);
const ctx = new Map<string, Record<string, unknown>>();
try {
	for (const line of readFileSync(process.env.STEVE_ATTEMPTS_FILE ?? "data/gym/attempts.jsonl", "utf8").split("\n")) {
		try {
			const r = JSON.parse(line) as { run_id: string; source: string; context?: Record<string, unknown> };
			if (r.source === "gym" && r.context) ctx.set(r.run_id, r.context);
		} catch {}
	}
} catch {}
const out: string[] = [`### ${batches.join(", ")}`, "", "| run | landing | outcome | s | best frame | obsidian | deaths | lava deaths | gap med s | counters | message |", "|---|---|---|---|---|---|---|---|---|---|---|"];
for (const r of rows) {
	const c = ctx.get(`gym-${r.slug}-${r.run_id}`) ?? {};
	let counters = "";
	try {
		counters = Object.entries(JSON.parse(r.counters ?? "{}") as Record<string, number>)
			.filter(([, v]) => v)
			.map(([k, v]) => `${k} ${v}`)
			.join(", ");
	} catch {}
	out.push(
		`| ${r.run_id} | ${r.landing_x ?? "-"},${r.landing_z ?? "-"} | ${r.outcome} | ${Math.round(r.seconds)} | ${r.best_frame ?? "-"} | ${r.obsidian ?? "-"} | ${r.deaths ?? "-"} | ${c.lava_deaths ?? "-"} | ${typeof c.block_gap_med_s === "number" ? c.block_gap_med_s.toFixed(0) : "-"} | ${counters} | ${(r.message ?? "").replace(/\|/g, "/").slice(0, 80)} |`,
	);
}
const real = rows.filter((r) => !["harness", "disconnect", "aborted"].includes(r.outcome));
out.push("", `**pass ${fmtRate(real.filter((r) => r.outcome === "pass").length, real.length)}**; harness/disconnect ${rows.length - real.length} of ${rows.length}`);
console.log(out.join("\n"));
