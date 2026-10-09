/**
 * Shard plan for gym.yml (cycle 7, Part 4.2): one matrix entry per shard of at most
 * SHARD_SIZE runs, per arm. An arm is {name, ref, env}; with no ARMS input there is one arm,
 * "a", on the dispatched ref. Shard k of an arm replays landings [k*size, k*size+runs) of the
 * set, so every arm runs the same ordered landings (paired).
 *
 *   RUNS=12 SHARD_SIZE=6 LABEL=t0 REF=<sha> ARMS='[{"name":"a"},{"name":"b","ref":"..."}]' node scripts/ci/plan.ts
 * prints matrix=<json> for $GITHUB_OUTPUT.
 */
type Arm = { name: string; ref?: string; env?: Record<string, string> };
const runs = Number(process.env.RUNS || 6);
const size = Math.max(1, Number(process.env.SHARD_SIZE || 6));
const label = (process.env.LABEL || `g${Date.now().toString(36)}`).replace(/[^A-Za-z0-9_.-]/g, "");
const ref = process.env.REF ?? "";
const arms: Arm[] = process.env.ARMS ? (JSON.parse(process.env.ARMS) as Arm[]) : [{ name: "a" }];
if (!arms.length || arms.some((a) => !/^[A-Za-z0-9_]+$/.test(a.name))) throw new Error(`bad ARMS: ${process.env.ARMS}`);
const include = arms.flatMap((arm) =>
	Array.from({ length: Math.ceil(runs / size) }, (_, k) => ({
		arm: arm.name,
		ref: arm.ref || ref,
		env: JSON.stringify(arm.env ?? {}),
		shard: k + 1,
		offset: k * size,
		runs: Math.min(size, runs - k * size),
		batch: `${label}${arms.length > 1 ? `-${arm.name}` : ""}-${k + 1}`,
	})),
);
console.log(`matrix=${JSON.stringify({ include })}`);
console.error(`${include.length} jobs: ${include.map((j) => `${j.batch}×${j.runs}@${j.ref.slice(0, 8)}`).join(", ")}`);
