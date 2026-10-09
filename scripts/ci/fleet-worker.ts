/**
 * Fleet worker (cycle 7): run this worker's trials one after another. Every trial gets a fresh
 * copy of the cached world and its own server start and stop, so trials never see each
 * other's frames, forceloads or bots. An arm with another ref runs from a worktree of that
 * ref sharing this checkout's data/ directory. Full output of every trial goes to
 * data/fleet/<trial>.log; data/fleet/trials.jsonl records each trial's timing and exit.
 *
 *   TRIALS='<json>' WORKER=3 node scripts/ci/fleet-worker.ts
 *
 * Needs the environment linked (env/, node_modules, typecraft data) and RUNNER_RCON_PASS.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Trial } from "./fleet-plan.ts";

const ROOT = resolve(".");
process.env.GYM_SERVER = "runner";
const ENV = join(ROOT, "env");
const DATA = join(ROOT, "data");
const WORK = join(ROOT, "work");
const trials = JSON.parse(process.env.TRIALS ?? "[]") as Trial[];
const worker = process.env.WORKER ?? "?";
mkdirSync(join(DATA, "fleet"), { recursive: true });
mkdirSync(join(DATA, "gym"), { recursive: true });
const log = (s: string) => console.log(`[w${worker} ${new Date().toISOString().slice(11, 19)}] ${s}`);
const sh = (cmd: string, args: string[], cwd = ROOT) => {
	const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
};

// Seed this worker's bandit file from the fleet's posterior (ci/params.json) if there is one.
if (existsSync(join(ROOT, "ci/params.json")) && !existsSync(join(DATA, "params.json"))) cpSync(join(ROOT, "ci/params.json"), join(DATA, "params.json"));
spawnSync(process.execPath, ["scripts/ci/init-telemetry.ts", join(DATA, "gym/telemetry.sqlite")], { stdio: "inherit" });

/** The directory a trial runs from: this checkout, or a worktree of the trial's ref. */
const checkouts = new Map<string, string>();
const dirFor = (ref: string): string => {
	if (!ref) return ROOT;
	const have = checkouts.get(ref);
	if (have) return have;
	const dir = join(ROOT, "refs", ref.replace(/[^A-Za-z0-9_.-]/g, "_"));
	sh("git", ["fetch", "--depth", "1", "origin", ref]);
	sh("git", ["worktree", "add", "--detach", dir, "FETCH_HEAD"]);
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

const runTrial = async (t: Trial): Promise<void> => {
	const t0 = Date.now();
	const cwd = dirFor(t.ref);
	const set = t.set ?? "A";
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(WORK, { recursive: true });
	cpSync(join(ENV, "worlds", set, "world"), join(WORK, "world"), { recursive: true });
	sh("bash", [join(ROOT, "scripts/ci/server.sh"), "start", ENV, WORK]);
	const upS = (Date.now() - t0) / 1000;
	sh(process.execPath, ["--import", "./typecraft-resolve.mjs", "scripts/rcon.ts", "gamerule keep_inventory true", "gamerule spawn_mobs true", "tick rate 20"]);

	const env: Record<string, string | undefined> = {
		...process.env,
		...t.env,
		GYM_SERVER: "runner",
		STEVE_D1_FILE: join(DATA, "gym/telemetry.sqlite"),
		STEVE_PARAMS_FILE: join(DATA, "params.json"),
		STEVE_ATTEMPTS_FILE: join(DATA, "gym/attempts.jsonl"),
		FLEET_TRIAL: t.id,
	};
	let cmd: string[];
	if (t.kind === "race") {
		const meta = JSON.parse(readFileSync(join(ENV, "worlds", set, "world-meta.json"), "utf8")) as { race_base: [number, number] };
		Object.assign(env, {
			MC_HOST: "127.0.0.1",
			MC_PORT: process.env.RUNNER_MC_PORT ?? "25565",
			MC_RCON_HOST: "127.0.0.1",
			MC_RCON_PORT: process.env.RUNNER_RCON_PORT ?? "25575",
			MC_RCON_PASS: process.env.RUNNER_RCON_PASS,
			STEVE_CLI: "1",
			STEVE_NUM_VIEWERS: "0",
			RACE_BASE: meta.race_base.join(","),
		});
		cmd = ["--import", "./typecraft-resolve.mjs", "src/lib/steve/main.ts", "--bots", String(t.bots ?? 5), "--timeout", String((t.minutes ?? 240) * 60)];
	} else {
		Object.assign(env, {
			STEP: t.slug,
			RUNS: "1",
			BATCH: t.batch,
			BOT: t.bot ?? "Gym_cast",
			GYM_LANDINGS: join(ENV, "worlds", set, `landings-${set}.json`),
			GYM_LANDING_OFFSET: String(t.index ?? 0),
		});
		if (t.lava_d && t.lava_d > 0) env.GYM_LAVA_D = String(t.lava_d);
		else delete env.GYM_LAVA_D;
		cmd = ["--import", "./typecraft-resolve.mjs", "gym-batch.ts"];
	}
	const out = openSync(join(DATA, "fleet", `${t.id}.log`), "w");
	const limitMs = Math.max(t.est_s * 3, t.est_s + 1800) * 1000;
	log(`start ${t.id} (${t.kind} ${t.slug ?? ""}, est ${t.est_s} s, limit ${limitMs / 1000} s) in ${cwd === ROOT ? "." : cwd}`);
	const code = await new Promise<number | string>((done) => {
		const p = spawn(process.execPath, cmd, { cwd, env, stdio: ["ignore", out, out] });
		const kill = setTimeout(() => p.kill("SIGKILL"), limitMs);
		p.on("exit", (c, sig) => {
			clearTimeout(kill);
			done(c ?? String(sig));
		});
	});
	spawnSync("bash", [join(ROOT, "scripts/ci/server.sh"), "stop", WORK], { stdio: "inherit" });
	cpSync(join(WORK, "server.log"), join(DATA, "fleet", `${t.id}.server.log`));
	const row = { id: t.id, worker, exp: t.exp, arm: t.arm, batch: t.batch, kind: t.kind, ref: t.ref, start: new Date(t0).toISOString(), wall_s: Math.round((Date.now() - t0) / 1000), server_up_s: upS, exit: code };
	appendFileSync(join(DATA, "fleet", "trials.jsonl"), `${JSON.stringify(row)}\n`);
	log(`done ${t.id} exit=${code} wall=${row.wall_s} s`);
};

for (const t of trials) {
	try {
		await runTrial(t);
	} catch (e) {
		log(`trial ${t.id} harness error: ${e instanceof Error ? e.message : e}`);
		appendFileSync(join(DATA, "fleet", "trials.jsonl"), `${JSON.stringify({ id: t.id, worker, exp: t.exp, arm: t.arm, batch: t.batch, kind: t.kind, exit: "harness", error: String(e) })}\n`);
		spawnSync("bash", [join(ROOT, "scripts/ci/server.sh"), "stop", WORK], { stdio: "inherit" });
	}
}
log(`worker done: ${trials.length} trials`);
