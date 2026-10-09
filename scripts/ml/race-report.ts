/**
 * Race report (cycle 7 Part 9 §6): everything the handoff needs from one race, from the race's
 * own event log and console log. Next to the funnel (race-funnel.ts):
 *   - bot-hours past budget by step (ruststeve's budgets, so i7/i8 compare): per dispatch,
 *     max(0, duration − budget), summed per step and bot
 *   - time to the portal step per bot (first portal_cast dispatch)
 *   - deaths by cause (death rows), and the console's placement faults (re-placements,
 *     teleports that did not take, process exits)
 *
 *   node scripts/ml/race-report.ts <attempts.jsonl> [race.log] [raceId-prefix]
 */
import { existsSync, readFileSync } from "node:fs";

const [file, logFile, prefix = ""] = process.argv.slice(2);
if (!file) throw new Error("usage: race-report.ts <attempts.jsonl> [race.log] [raceId-prefix]");
type Row = { run_id: string; source: string; skill: string; step_id: string; bot: string; start_ms: number; duration_s: number; outcome: string; death_cause: string | null };
const rows = readFileSync(file, "utf8")
	.split("\n")
	.filter(Boolean)
	.flatMap((l) => {
		try {
			return [JSON.parse(l) as Row];
		} catch {
			return [];
		}
	})
	.filter((r) => r.source === "race" && r.run_id.startsWith(prefix));
if (!rows.length) {
	console.log("no race rows");
	process.exit(0);
}
const bots = [...new Set(rows.map((r) => r.bot))].sort();
const t0 = Math.min(...rows.map((r) => r.start_ms));
const BUDGET: Record<string, number> = { gather_wood: 360, mine_iron: 1200, mine_coal: 600, build_nether_portal: 1500, portal_cast: 1500, find_fortress: 900 };
const budget = (step: string) => BUDGET[step] ?? 600;

console.log(`race ${prefix || "(all)"}: ${bots.length} bots, ${rows.length} dispatch rows, ${Math.round((Math.max(...rows.map((r) => r.start_ms + r.duration_s * 1000)) - t0) / 60000)} min of rows\n`);

// Past budget by step.
const past = new Map<string, Map<string, number>>();
for (const r of rows) {
	const over = Math.max(0, r.duration_s - budget(r.step_id));
	if (!over) continue;
	const m = past.get(r.step_id) ?? new Map<string, number>();
	m.set(r.bot, (m.get(r.bot) ?? 0) + over);
	past.set(r.step_id, m);
}
const total = [...past.values()].reduce((a, m) => a + [...m.values()].reduce((x, y) => x + y, 0), 0);
console.log(`bot-hours past budget: ${(total / 3600).toFixed(2)}`);
for (const [step, m] of [...past].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
	const s = [...m.values()].reduce((x, y) => x + y, 0);
	console.log(`  ${step.padEnd(24)} ${(s / 3600).toFixed(2)} h  (${[...m].map(([b, v]) => `${b.replace("steve-race-", "")} ${(v / 3600).toFixed(2)}`).join(", ")})`);
}

// Time to the portal step.
console.log("\ntime to the portal step (first portal_cast dispatch):");
for (const b of bots) {
	const r = rows.filter((x) => x.bot === b && (x.skill === "portal_cast" || x.step_id === "build_nether_portal")).sort((a, z) => a.start_ms - z.start_ms)[0];
	console.log(`  ${b}: ${r ? `${Math.round((r.start_ms - t0) / 60000)} min` : "never"}`);
}

// Deaths by cause.
const deaths = rows.filter((r) => r.outcome === "death");
const causes = new Map<string, number>();
for (const d of deaths) causes.set(String(d.death_cause ?? "unknown"), (causes.get(String(d.death_cause ?? "unknown")) ?? 0) + 1);
console.log(`\ndeaths (dispatch rows): ${deaths.length}${deaths.length ? ` — ${[...causes].map(([k, v]) => `${v}× ${k}`).join(", ")}` : ""}`);

// Placement faults from the console.
if (logFile && existsSync(logFile)) {
	const log = readFileSync(logFile, "utf8");
	const count = (re: RegExp) => (log.match(re) ?? []).length;
	console.log(
		`\nplacement: ${count(/re-placing/g)} re-placements (${count(/IN WATER/g)} water, ${count(/ON A SHORE/g)} shore, ${count(/IN LAVA/g)} lava, ${count(/underground/g)} underground), ${count(/tp did not take/g)} teleports that did not take; ${count(/process exited/g)} process exits, ${count(/respawned \(#/g)} respawns of a process`,
	);
}
