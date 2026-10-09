/**
 * Fleet worker (cycle 7): the side effects around the pure planner. Recompute this worker's
 * units from the plan, then for each unit: copy the cached world, start one server (the
 * unit's heap), launch its trials (one, or several sharing the server for the capacity
 * test) as launchFor says, sample server load for shared units, stop the server, record.
 *
 *   PLAN=ci/plans/f3.json WORKER=3 node scripts/ci/fleet-worker.ts
 *
 * Full output of every trial: data/fleet/<trial>.log. Timing and exit per trial:
 * data/fleet/trials.jsonl. Load samples of a shared unit: data/fleet/<unit>.metrics.jsonl.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchFor } from "../../src/lib/steve/fleet/launch.ts";
import { assignmentFor, parsePlan, type Unit } from "../../src/lib/steve/fleet/plan.ts";

const ROOT = resolve(".");
const ENV = join(ROOT, "env");
const DATA = join(ROOT, "data");
const WORK = join(ROOT, "work");
process.env.GYM_SERVER = "runner";
const worker = Number(process.env.WORKER);
const plan = parsePlan(JSON.parse(readFileSync(process.env.PLAN ?? "", "utf8")));
const units = assignmentFor(plan, worker);
mkdirSync(join(DATA, "fleet"), { recursive: true });
mkdirSync(join(DATA, "gym"), { recursive: true });
const log = (s: string) => console.log(`[w${worker} ${new Date().toISOString().slice(11, 19)}] ${s}`);
const record = (row: Record<string, unknown>) => appendFileSync(join(DATA, "fleet", "trials.jsonl"), `${JSON.stringify({ plan: plan.label, worker, ...row })}\n`);
const run = (cmd: string, args: string[], extra: Record<string, string> = {}) => {
	const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...extra } });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
};
const serverStart = (extra: Record<string, string>) => run("bash", [join(ROOT, "scripts/ci/server.sh"), "start", ENV, WORK], extra);
const serverStop = () => spawnSync("bash", [join(ROOT, "scripts/ci/server.sh"), "stop", WORK], { stdio: "inherit" });
const rconAsync = (c: string): Promise<string> =>
	new Promise((done) => {
		const p = spawn(process.execPath, ["--import", "./typecraft-resolve.mjs", "scripts/rcon.ts", c], { cwd: ROOT, env: process.env });
		let o = "";
		p.stdout.on("data", (d) => (o += d.toString()));
		p.on("exit", () => done(o));
	});

// The fleet's bandit posterior seeds this worker (ci/params.json, written from merged attempts).
if (existsSync(join(ROOT, "ci/params.json")) && !existsSync(join(DATA, "params.json"))) cpSync(join(ROOT, "ci/params.json"), join(DATA, "params.json"));
run(process.execPath, ["scripts/ci/init-telemetry.ts", join(DATA, "gym/telemetry.sqlite")]);

/** A worktree per foreign ref, sharing env/ and data/. */
const checkouts = new Map<string, string>();
const dirForRef = (ref: string): string => {
	const have = checkouts.get(ref);
	if (have) return have;
	const dir = join(ROOT, "refs", ref.replace(/[^A-Za-z0-9_.-]/g, "_"));
	run("git", ["fetch", "--depth", "1", "origin", ref]);
	run("git", ["worktree", "add", "--detach", dir, "FETCH_HEAD"]);
	for (const [link, target] of [
		["node_modules", join(ENV, "node_modules")],
		["data", DATA],
		["src/lib/typecraft/data", join(ENV, "typecraft-data")],
	] as const) {
		rmSync(join(dir, link), { recursive: true, force: true });
		symlinkSync(target, join(dir, link));
	}
	log(`ref ${ref} → ${spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir }).stdout.toString().trim()}`);
	checkouts.set(ref, dir);
	return dir;
};
const raceBase = (set: string) => (JSON.parse(readFileSync(join(ENV, "worlds", set, "world-meta.json"), "utf8")) as { race_base: number[] }).race_base.join(",");

const runUnit = async (unit: Unit): Promise<void> => {
	const t0 = Date.now();
	const first = unit.trials[0]!;
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(WORK, { recursive: true });
	cpSync(join(ENV, "worlds", first.set, "world"), join(WORK, "world"), { recursive: true });
	serverStart(first.heap_mb ? { HEAP_MB: String(first.heap_mb) } : {});
	const upS = (Date.now() - t0) / 1000;
	run(process.execPath, ["--import", "./typecraft-resolve.mjs", "scripts/rcon.ts", "gamerule keep_inventory true", "gamerule spawn_mobs true", "tick rate 20"]);
	const shared = unit.trials.length;
	const serverPid = readFileSync(join(WORK, "server.pid"), "utf8").trim();
	const pids: number[] = [];
	let n = 0;
	const sampler =
		shared > 1
			? setInterval(async () => {
					const row: Record<string, unknown> = { t: Math.round((Date.now() - t0) / 1000) };
					row.ps = spawnSync("ps", ["-o", "pid=,pcpu=,rss=", "-p", [serverPid, ...pids].join(",")], { encoding: "utf8" })
						.stdout.trim()
						.split("\n")
						.map((l) => l.trim().split(/\s+/).map(Number));
					if (n++ % 3 === 0) {
						const q = await rconAsync("tick query");
						row.tick_mean = Number(/Average time per tick: ([\d.]+)ms/.exec(q)?.[1] ?? Number.NaN);
						row.tick_p99 = Number(/P99: ([\d.]+)ms/.exec(q)?.[1] ?? Number.NaN);
					}
					appendFileSync(join(DATA, "fleet", `${unit.id}.metrics.jsonl`), `${JSON.stringify(row)}\n`);
				}, 10_000)
			: null;
	const ctx = {
		root: ROOT,
		dirForRef,
		envDir: ENV,
		dataDir: DATA,
		mcPort: process.env.RUNNER_MC_PORT ?? "25565",
		rconPort: process.env.RUNNER_RCON_PORT ?? "25575",
		rconPass: process.env.RUNNER_RCON_PASS ?? "",
		raceBase,
		shared,
	};
	const results = await Promise.all(
		unit.trials.map(async (t) => {
			const l = launchFor(t, ctx);
			const env: Record<string, string | undefined> = { ...process.env, ...l.env };
			for (const k of l.unset) delete env[k];
			const out = openSync(join(DATA, "fleet", `${t.id}.log`), "w");
			log(`start ${t.id} (${t.kind} ${t.slug ?? ""}, est ${t.est_s} s${shared > 1 ? `, ${shared} on one server` : ""})${l.cwd === ROOT ? "" : ` in ${l.cwd}`}`);
			const ts = Date.now();
			const exit = await new Promise<number | string>((done) => {
				const p = spawn(process.execPath, l.argv, { cwd: l.cwd, env, stdio: ["ignore", out, out] });
				if (p.pid) pids.push(p.pid);
				const kill = setTimeout(() => p.kill("SIGKILL"), l.limitMs);
				p.on("exit", (c, sig) => {
					clearTimeout(kill);
					done(c ?? String(sig));
				});
			});
			return { t, exit, wall_s: Math.round((Date.now() - ts) / 1000) };
		}),
	);
	if (sampler) clearInterval(sampler);
	serverStop();
	cpSync(join(WORK, "server.log"), join(DATA, "fleet", `${unit.id}.server.log`));
	for (const { t, exit, wall_s } of results) {
		record({ id: t.id, unit: unit.id, exp: t.exp, arm: t.arm, batch: t.batch, kind: t.kind, ref: t.ref, shared, heap_mb: t.heap_mb ?? null, start: new Date(t0).toISOString(), wall_s, server_up_s: upS, exit });
		log(`done ${t.id} exit=${exit} wall=${wall_s} s`);
	}
};

log(`plan ${plan.label}: ${units.length} units, ${units.reduce((a, u) => a + u.trials.length, 0)} trials`);
for (const unit of units) {
	try {
		await runUnit(unit);
	} catch (e) {
		log(`unit ${unit.id} harness error: ${e instanceof Error ? e.message : e}`);
		for (const t of unit.trials) record({ id: t.id, unit: unit.id, exp: t.exp, arm: t.arm, batch: t.batch, kind: t.kind, exit: "harness", error: String(e) });
		serverStop();
	}
}
log("worker done");
