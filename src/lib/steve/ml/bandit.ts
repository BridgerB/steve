/**
 * Thompson-sampling bandits over argued constants (cycle 4, Part 5.3).
 *
 * data/params.json (STEVE_PARAMS_FILE): per parameter, candidate values ("arms") with a
 * Beta posterior [a, b] each (a = successes+1, b = failures+1), plus an optional
 * `pin` that forces the scripted value (bandits stay pinned until the skill's
 * structure is right — "a bandit tuning a broken skill produces a well-tuned broken
 * skill"). The bot reads the file at the start of every attempt, so a value changes
 * without a rebuild or relaunch; the gym runner and the race launcher share it.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { betaSample, rngFrom, type Rng } from "./stats.ts";

export type Arm = [a: number, b: number];
export type ParamSpec = { arms: Record<string, Arm>; pin?: string };
export type ParamsFile = Record<string, ParamSpec>;

export const DEFAULT_PARAMS: ParamsFile = {
	anchor_dy_max: { arms: { "2": [1, 1], "3": [1, 1], "5": [1, 1] }, pin: "3" },
	anchor_max_d: { arms: { "8": [1, 1], "12": [1, 1] }, pin: "12" },
	fill_high: { arms: { "0.6": [1, 1], "1.0": [1, 1], "1.5": [1, 1] }, pin: "1.5" },
	buckets: { arms: { "3": [1, 1], "4": [1, 1], "5": [1, 1] } },
	stall_s: { arms: { "120": [1, 1], "180": [1, 1], "300": [1, 1] }, pin: "180" },
};

export const paramsPath = (): string => process.env.STEVE_PARAMS_FILE ?? "data/params.json";

export const loadParams = (path = paramsPath()): ParamsFile => {
	if (!existsSync(path)) return structuredClone(DEFAULT_PARAMS);
	try {
		const file = JSON.parse(readFileSync(path, "utf8")) as ParamsFile;
		return { ...structuredClone(DEFAULT_PARAMS), ...file };
	} catch {
		return structuredClone(DEFAULT_PARAMS);
	}
};

export const saveParams = (p: ParamsFile, path = paramsPath()): void => {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(p, null, 2)}\n`);
	renameSync(tmp, path);
};

/** One Thompson draw per parameter: the arm with the largest Beta sample (or the pin). */
// The default seed mixes a per-process counter and Math.random: draws in the same
// millisecond (race c6 drew five kits in one loop) all got the same arm from Date.now().
let drawN = 0;
export const drawParams = (
	p: ParamsFile = loadParams(),
	rng: Rng = rngFrom((Date.now() ^ Math.imul(++drawN, 0x9e3779b1) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0),
): Record<string, string> => {
	const chosen: Record<string, string> = {};
	for (const [name, spec] of Object.entries(p)) {
		if (spec.pin !== undefined) {
			chosen[name] = spec.pin;
			continue;
		}
		let best = "";
		let bestDraw = -1;
		for (const [value, [a, b]] of Object.entries(spec.arms)) {
			const d = betaSample(a, b, rng);
			if (d > bestDraw) {
				bestDraw = d;
				best = value;
			}
		}
		chosen[name] = best;
	}
	return chosen;
};

/** Credit the arms used by one attempt: a += 1 on ok, b += 1 otherwise. Pinned params are not updated. */
export const updateParams = (chosen: Record<string, string>, ok: boolean, path = paramsPath()): ParamsFile => {
	const p = loadParams(path);
	for (const [name, value] of Object.entries(chosen)) {
		const spec = p[name];
		if (!spec || spec.pin !== undefined) continue;
		const arm = spec.arms[value];
		if (!arm) continue;
		if (ok) arm[0]++;
		else arm[1]++;
	}
	saveParams(p, path);
	return p;
};

// The draw the current attempt runs with (one bot per process), so skill code deep in
// a task reads its arm without threading the draw through every call.
let current: Record<string, string> = {};
export const useParams = (chosen: Record<string, string>): void => {
	current = chosen;
};
/** The current attempt's numeric value of a parameter, or the fallback (scripted value). */
export const param = (name: string, fallback: number): number => num(current, name, fallback);

/** Numeric value of a parameter from a draw, with a fallback. */
export const num = (chosen: Record<string, string>, name: string, fallback: number): number => {
	const v = Number(chosen[name]);
	return Number.isFinite(v) ? v : fallback;
};

/** Posterior summary for the handoff: mean and trial count per arm. */
export const summarize = (p: ParamsFile = loadParams()): string[] =>
	Object.entries(p).map(([name, spec]) => {
		const arms = Object.entries(spec.arms)
			.map(([v, [a, b]]) => `${v}: mean ${(a / (a + b)).toFixed(2)} n=${a + b - 2}`)
			.join(", ");
		return `${name}${spec.pin !== undefined ? ` (pinned ${spec.pin})` : ""} — ${arms}`;
	});
