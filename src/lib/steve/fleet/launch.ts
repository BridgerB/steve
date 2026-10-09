/**
 * How a trial is launched, pure (cycle 7): given a trial and the worker's paths, the working
 * directory, the environment additions and the argv. The worker applies them; nothing here
 * touches the file system or a process.
 */
import type { Trial } from "./plan.ts";

export type LaunchCtx = {
	/** The worker's checkout of the dispatched ref. */
	root: string;
	/** The checkout for an arm's ref ("" = root). */
	dirForRef: (ref: string) => string;
	/** env/ (jre, worlds, node_modules) and the shared data/ directory. */
	envDir: string;
	dataDir: string;
	/** The runner server's ports and RCON password. */
	mcPort: string;
	rconPort: string;
	rconPass: string;
	/** Race base for the trial's landing set ("x,z"), from world-meta.json. */
	raceBase: (set: string) => string;
	/** Bots on this server at the same time. */
	shared: number;
};

export type Launch = { cwd: string; env: Record<string, string>; unset: string[]; argv: string[]; limitMs: number };

export const launchFor = (t: Trial, c: LaunchCtx): Launch => {
	const env: Record<string, string> = {
		...t.env,
		GYM_SERVER: "runner",
		STEVE_D1_FILE: `${c.dataDir}/gym/telemetry.sqlite`,
		STEVE_PARAMS_FILE: `${c.dataDir}/params.json`,
		STEVE_ATTEMPTS_FILE: `${c.dataDir}/gym/attempts.jsonl`,
		FLEET_TRIAL: t.id,
	};
	const unset: string[] = [];
	const limitMs = Math.max(t.est_s * 3, t.est_s + 1800) * 1000;
	const cwd = t.ref ? c.dirForRef(t.ref) : c.root;
	if (t.kind === "race") {
		Object.assign(env, {
			MC_HOST: "127.0.0.1",
			MC_PORT: c.mcPort,
			MC_RCON_HOST: "127.0.0.1",
			MC_RCON_PORT: c.rconPort,
			MC_RCON_PASS: c.rconPass,
			STEVE_CLI: "1",
			STEVE_NUM_VIEWERS: "0",
			RACE_BASE: c.raceBase(t.set),
		});
		return { cwd, env, unset, argv: ["--import", "./typecraft-resolve.mjs", "src/lib/steve/main.ts", "--bots", String(t.bots ?? 5), "--timeout", String((t.minutes ?? 240) * 60)], limitMs };
	}
	Object.assign(env, {
		STEP: t.slug ?? "",
		RUNS: "1",
		BATCH: t.batch,
		BOT: t.bot ?? "Gym_cast",
		GYM_LANDINGS: `${c.envDir}/worlds/${t.set}/landings-${t.set}.json`,
		GYM_LANDING_OFFSET: String(t.index ?? 0),
	});
	if (c.shared > 1) Object.assign(env, { GYM_SHARED_SERVER: "1", GYM_BATCH_LOCK: `${c.dataDir}/gym/batch-${t.bot}.lock` });
	// The batch header check refuses an arena slug without GYM_LAVA_D and a natural one with it.
	if (t.lava_d && t.lava_d > 0) env.GYM_LAVA_D = String(t.lava_d);
	else unset.push("GYM_LAVA_D");
	return { cwd, env, unset, argv: ["--import", "./typecraft-resolve.mjs", "gym-batch.ts"], limitMs };
};
