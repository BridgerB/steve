/**
 * Honest numbers for the learning-system loop (cycle 4, Part 5).
 *
 * Every rate is printed with its Wilson 95% interval; build comparisons use Beta
 * posteriors and a sequential stop; times use the median / p80 and a bootstrap.
 * All sampling takes an explicit RNG so results are reproducible on fixed seeds
 * (the cross-implementation agreement test with ruststeve uses the same seeds).
 */

export type Rng = () => number;

/** mulberry32: small, fast, seedable PRNG in [0, 1). */
export const rngFrom = (seed: number): Rng => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

/** Wilson 95% interval for k successes in n trials. */
export const wilson = (k: number, n: number, z = 1.96): { p: number; lo: number; hi: number } => {
	if (n <= 0) return { p: 0, lo: 0, hi: 1 };
	const p = k / n;
	const z2 = z * z;
	const denom = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denom;
	const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
	return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
};

/** "6/10 = 60% [31%, 83%]" */
export const fmtRate = (k: number, n: number): string => {
	const w = wilson(k, n);
	const pc = (x: number) => `${Math.round(x * 100)}%`;
	return `${k}/${n} = ${pc(w.p)} [${pc(w.lo)}, ${pc(w.hi)}]`;
};

/** Quantile by linear interpolation on a sorted copy; NaN for an empty sample. */
export const quantile = (xs: number[], q: number): number => {
	if (!xs.length) return Number.NaN;
	const s = [...xs].sort((a, b) => a - b);
	const pos = (s.length - 1) * q;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};

/** Standard normal via Box–Muller. */
const gauss = (rng: Rng): number => {
	let u = 0;
	while (u === 0) u = rng();
	const v = rng();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Gamma(shape, 1) by Marsaglia–Tsang (shape < 1 boosted via U^(1/shape)). */
export const gammaSample = (shape: number, rng: Rng): number => {
	if (shape < 1) {
		const u = rng() || Number.MIN_VALUE;
		return gammaSample(shape + 1, rng) * Math.pow(u, 1 / shape);
	}
	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);
	for (;;) {
		let x = 0;
		let v = 0;
		do {
			x = gauss(rng);
			v = 1 + c * x;
		} while (v <= 0);
		v = v * v * v;
		const u = rng();
		if (u < 1 - 0.0331 * x * x * x * x) return d * v;
		if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
	}
};

/** Beta(a, b) = X / (X + Y) with X ~ Gamma(a), Y ~ Gamma(b). */
export const betaSample = (a: number, b: number, rng: Rng): number => {
	const x = gammaSample(a, rng);
	const y = gammaSample(b, rng);
	return x / (x + y);
};

/** P(rate_B > rate_A) under Beta(s+1, f+1) posteriors, by Monte Carlo. */
export const probBGreater = (
	a: { ok: number; n: number },
	b: { ok: number; n: number },
	draws = 10_000,
	rng: Rng = rngFrom(1),
): number => {
	let wins = 0;
	for (let i = 0; i < draws; i++) {
		const pa = betaSample(a.ok + 1, a.n - a.ok + 1, rng);
		const pb = betaSample(b.ok + 1, b.n - b.ok + 1, rng);
		if (pb > pa) wins++;
	}
	return wins / draws;
};

/** Sequential decision for B vs A (Part 5.2): stop at > 0.95 / < 0.05, else continue to cap. */
export const sequentialDecision = (
	a: { ok: number; n: number },
	b: { ok: number; n: number },
	cap = 30,
): { pBA: number; decision: "B wins" | "B loses" | "continue" | "cap reached" } => {
	const pBA = probBGreater(a, b);
	if (pBA > 0.95) return { pBA, decision: "B wins" };
	if (pBA < 0.05) return { pBA, decision: "B loses" };
	if (a.n >= cap && b.n >= cap) return { pBA, decision: "cap reached" };
	return { pBA, decision: "continue" };
};

/** Bootstrap P(median(B) < median(A)) — "B is faster" for times. */
export const bootstrapMedianFaster = (
	a: number[],
	b: number[],
	iters = 10_000,
	rng: Rng = rngFrom(2),
): number => {
	if (!a.length || !b.length) return Number.NaN;
	const resampleMedian = (xs: number[]) => {
		const r = Array.from({ length: xs.length }, () => xs[Math.floor(rng() * xs.length)]!);
		return quantile(r, 0.5);
	};
	let faster = 0;
	for (let i = 0; i < iters; i++) if (resampleMedian(b) < resampleMedian(a)) faster++;
	return faster / iters;
};

/**
 * Bootstrap of the difference in means (cycle 5 screening): resample each group with
 * replacement and return P(mean B > mean A) plus the 95% interval of mean B − mean A.
 * Ties count half, so identical groups give 0.5.
 */
export const bootstrapMeanDiff = (
	a: number[],
	b: number[],
	iters = 10_000,
	rng: Rng = rngFrom(3),
): { pBGreater: number; lo: number; hi: number } => {
	if (!a.length || !b.length) return { pBGreater: Number.NaN, lo: Number.NaN, hi: Number.NaN };
	const mean = (xs: number[]) => {
		let s = 0;
		for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rng() * xs.length)]!;
		return s / xs.length;
	};
	const diffs: number[] = [];
	let greater = 0;
	for (let i = 0; i < iters; i++) {
		const d = mean(b) - mean(a);
		diffs.push(d);
		if (d > 0) greater++;
		else if (d === 0) greater += 0.5;
	}
	return { pBGreater: greater / iters, lo: quantile(diffs, 0.025), hi: quantile(diffs, 0.975) };
};
