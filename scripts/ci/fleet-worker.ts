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
import { appendFileSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchFor } from "../../src/lib/steve/fleet/launch.ts";
import { loadPlan } from "../../src/lib/steve/fleet/load.ts";
import { assignmentFor, type Unit } from "../../src/lib/steve/fleet/plan.ts";
import { cpuPct, machinePct, parseCpuTotals, parseMemAvailableMb, parsePidStat, treeOf } from "../../src/lib/steve/fleet/procstat.ts";

const ROOT = resolve(".");
const ENV = join(ROOT, "env");
const DATA = join(ROOT, "data");
const WORK = join(ROOT, "work");
process.env.GYM_SERVER = "runner";
const worker = Number(process.env.WORKER);
const plan = loadPlan(process.env.PLAN ?? "");
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
	// Load sampler (every unit; one bot per server is the capacity test's baseline): every 10 s
	// machine CPU and available memory, CPU and RSS of the server and of each trial's whole
	// process tree, from /proc deltas; server tick mean/p99 every 30 s.
	const roots = new Map<string, number>(); // trial id → gym-batch / race pid
	const metricsFile = join(DATA, "fleet", `${unit.id}.metrics.jsonl`);
	const readProc = () => {
		const ppid = new Map<number, number>();
		const st = new Map<number, { jiffies: number; rssPages: number }>();
		for (const d of readdirSync("/proc")) {
			if (!/^\d+$/.test(d)) continue;
			try {
				const p = parsePidStat(readFileSync(`/proc/${d}/stat`, "utf8"));
				if (p) {
					ppid.set(p.pid, p.ppid);
					st.set(p.pid, p);
				}
			} catch {}
		}
		return { ppid, st, cpu: parseCpuTotals(readFileSync("/proc/stat", "utf8")), mem: parseMemAvailableMb(readFileSync("/proc/meminfo", "utf8")), at: Date.now() };
	};
	const linux = existsSync("/proc/stat");
	let prev = linux ? readProc() : null;
	let n = 0;
	const tree = (root: number, snap: NonNullable<typeof prev>) => {
		const pids = treeOf(root, snap.ppid);
		return { jiffies: pids.reduce((a, p) => a + (snap.st.get(p)?.jiffies ?? 0), 0), rssMb: Math.round(pids.reduce((a, p) => a + (snap.st.get(p)?.rssPages ?? 0), 0) * 4 / 1024) };
	};
	const sampler = setInterval(async () => {
		const row: Record<string, unknown> = { t: Math.round((Date.now() - t0) / 1000), bots: unit.trials.length, heap_mb: first.heap_mb ?? null };
		if (linux && prev) {
			const cur = readProc();
			const dt = (cur.at - prev.at) / 1000;
			row.machine_cpu = machinePct(prev.cpu, cur.cpu);
			row.mem_avail_mb = cur.mem;
			const s0 = tree(Number(serverPid), prev);
			const s1 = tree(Number(serverPid), cur);
			row.server = { cpu: cpuPct(s0.jiffies, s1.jiffies, dt), rss_mb: s1.rssMb };
			row.trials = [...roots].map(([id, pid]) => {
				const a0 = tree(pid, prev!);
				const a1 = tree(pid, cur);
				return { id, cpu: cpuPct(a0.jiffies, a1.jiffies, dt), rss_mb: a1.rssMb };
			});
			prev = cur;
		}
		if (n++ % 3 === 0) {
			const q = await rconAsync("tick query");
			row.tick_mean = Number(/Average time per tick: ([\d.]+)ms/.exec(q)?.[1] ?? Number.NaN);
			row.tick_p99 = Number(/P99: ([\d.]+)ms/.exec(q)?.[1] ?? Number.NaN);
		}
		appendFileSync(metricsFile, `${JSON.stringify(row)}\n`);
	}, 10_000);
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
				if (p.pid) roots.set(t.id, p.pid);
				const kill = setTimeout(() => p.kill("SIGKILL"), l.limitMs);
				p.on("exit", (c, sig) => {
					clearTimeout(kill);
					done(c ?? String(sig));
				});
			});
			return { t, exit, wall_s: Math.round((Date.now() - ts) / 1000) };
		}),
	);
	clearInterval(sampler);
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
