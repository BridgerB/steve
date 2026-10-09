/**
 * Rebuild the bandit posteriors from the merged event log (cycle 7, decision 7): every
 * portal_cast attempt that drew params credits its arms — success = it finished or placed
 * obsidian — except arena attempts (gym rows whose context marks GYM_LAVA_D, or batches with
 * "arena" in the name), which never credit. Workers seed from ci/params.json, so learning
 * carries from fleet to fleet instead of dying with each job.
 *
 *   node scripts/ci/params-from-attempts.ts [attempts.jsonl] [out=ci/params.json]
 *
 * Prints the posterior per parameter, arm and source (natural gym, race).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_PARAMS, type ParamsFile } from "../../src/lib/steve/ml/bandit.ts";

const [file = "data/gym/attempts.jsonl", out = "ci/params.json"] = process.argv.slice(2);
type Row = { skill?: string; source?: string; run_id?: string; outcome?: string; progress?: number; params?: Record<string, string>; context?: Record<string, unknown> };
const rows = readFileSync(file, "utf8")
	.split("\n")
	.filter(Boolean)
	.flatMap((l) => {
		try {
			return [JSON.parse(l) as Row];
		} catch {
			return [];
		}
	});
const arena = (r: Row) => /arena|cap\d|k\d+h\d+/.test(r.run_id ?? "") || Number(r.context?.lava_d ?? 0) > 0;
const p: ParamsFile = structuredClone(DEFAULT_PARAMS);
// Decision 7: these stay live on natural screens and races; the defaults pin them for safety.
for (const name of ["anchor_dy_max", "stall_s", "buckets"]) if (p[name]) delete p[name]!.pin;
const bySource = new Map<string, Map<string, [number, number]>>();
let used = 0;
for (const r of rows) {
	if (r.skill !== "portal_cast" || !r.params || Object.keys(r.params).length === 0) continue;
	if (r.source === "gym" && arena(r)) continue;
	const ok = r.outcome === "ok" || Number(r.progress ?? 0) > 0;
	used++;
	for (const [name, value] of Object.entries(r.params)) {
		const spec = p[name];
		if (!spec || spec.pin !== undefined || !spec.arms[value]) continue;
		spec.arms[value]![ok ? 0 : 1]++;
		const src = r.source === "race" ? "race" : "natural";
		const m = bySource.get(src) ?? new Map();
		const k = `${name}=${value}`;
		const ab = m.get(k) ?? [1, 1];
		ab[ok ? 0 : 1]++;
		m.set(k, ab);
		bySource.set(src, m);
	}
}
writeFileSync(out, `${JSON.stringify(p, null, 2)}\n`);
console.log(`${used} crediting attempts → ${out}`);
for (const [src, m] of bySource) {
	console.log(`\n${src}:`);
	for (const [k, [a, b]] of [...m].sort()) console.log(`  ${k.padEnd(22)} Beta(${a}, ${b})  mean ${(a / (a + b)).toFixed(2)}  n=${a + b - 2}`);
}
