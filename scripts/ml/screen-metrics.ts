/**
 * Screening metrics per run for a gym batch, from the gym telemetry (cycle 5).
 *
 *   node --import ./typecraft-resolve.mjs scripts/ml/screen-metrics.ts <batch> [cap_s] [--json]
 *
 * Run in the box gym clone (reads data/gym/batches.db and the telemetry file named by
 * STEVE_D1_FILE, default data/gym/telemetry.sqlite). cap_s truncates every run at that
 * many seconds from its first event (base3 read at the 1800 s screening cap).
 */
import { DatabaseSync } from "node:sqlite";
import { quantile } from "../../src/lib/steve/ml/stats.ts";
import { runMetrics, type RunMetrics, type TelemetryEvent } from "../../src/lib/steve/ml/screen.ts";

const [batch, capArg, ...rest] = process.argv.slice(2);
if (!batch) {
	console.error("usage: screen-metrics.ts <batch> [cap_s] [--json]");
	process.exit(1);
}
const cap = capArg && capArg !== "--json" ? Number(capArg) : undefined;
const json = rest.includes("--json") || capArg === "--json";
const runs = new DatabaseSync("data/gym/batches.db")
	.prepare("SELECT run_id, slug FROM runs WHERE batch = ? AND outcome NOT IN ('harness','disconnect') ORDER BY started_at")
	.all(batch) as { run_id: string; slug: string }[];
const tel = new DatabaseSync(process.env.STEVE_D1_FILE ?? "data/gym/telemetry.sqlite");
const q = tel.prepare("SELECT ts, category, event, detail FROM events WHERE race_id = ? AND category IN ('cast','death') ORDER BY ts");
const out: (RunMetrics & { run_id: string })[] = [];
for (const r of runs) {
	const ev = q.all(`gym-${r.slug}-${r.run_id}`) as unknown as TelemetryEvent[];
	out.push({ run_id: r.run_id, ...runMetrics(ev, cap) });
}
if (json) {
	console.log(JSON.stringify(out));
} else {
	for (const m of out)
		console.log(
			`${m.run_id}: best_frame ${m.best_frame} obsidian ${m.obsidian} deaths ${m.deaths} (lava ${m.lava_deaths}) gap_med ${m.block_gap_med_s?.toFixed(0) ?? "-"} s frames ${m.frames} ${Object.entries(m.counters)
				.filter(([, v]) => v)
				.map(([k, v]) => `${k}=${v}`)
				.join(" ")}`,
		);
	const mean = (f: (m: RunMetrics) => number) => (out.length ? out.reduce((a, m) => a + f(m), 0) / out.length : 0);
	const bf = out.map((m) => m.best_frame);
	console.log(
		`\n${batch}${cap ? ` @${cap}s` : ""} n=${out.length}: best_frame median ${bf.length ? quantile(bf, 0.5) : "-"} mean ${mean((m) => m.best_frame).toFixed(2)}; obsidian mean ${mean((m) => m.obsidian).toFixed(2)}; deaths mean ${mean((m) => m.deaths).toFixed(2)} (lava ${mean((m) => m.lava_deaths).toFixed(2)})`,
	);
}
