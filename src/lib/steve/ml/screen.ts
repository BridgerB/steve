/**
 * Per-run screening metrics (cycle 5, decision 3): continuous measures a 6-run batch
 * can compare where a pass rate cannot. Computed from one run's telemetry events, with
 * an optional cap (seconds from the first event) so a 2700 s baseline run can be read
 * at the 1800 s mark of a screening run.
 *
 * best_frame: the most distinct frame cells holding the bot's own obsidian in any one
 * frame. A frame is identified by its origin (frame_origin "anchor x,y,z" or
 * portal_start "frame at x,y,z"); its 10 cells are x..x+3 / y..y+4 at z (the cast's
 * at(dx, dy) layout). Obsidian events outside every known frame count toward obsidian
 * but no frame.
 */

export interface TelemetryEvent {
	ts: string;
	category: string;
	event: string;
	detail: string | null;
}

export interface RunMetrics {
	best_frame: number;
	obsidian: number;
	deaths: number;
	lava_deaths: number;
	block_gap_med_s: number | null;
	frames: number;
	counters: Record<string, number>;
}

// Diagnostic events counted per run (cycle 5 per-fix counters).
export const COUNTED = [
	"anchor_unreached",
	"reanchor_near_frame",
	"reanchor_prevented",
	"frame_present_false",
	"frame_present_blocked",
	"move_vetoed",
	"lava_ring_sealed",
	"pre_pour_unsafe",
	"footing_reverted",
	"workrow_lava_capped",
	"r2_stay",
	"site_off_level",
	"site_level",
	"station_scoop",
	"station_here",
	"front_load",
	"station_none",
	"station_walk_fail",
	"obsidian_lost",
	"spare_pick",
	"pool_excluded",
	"refill_hop",
	"refill_hop_none",
	"site_anchor",
	"site_tunnel",
	"site_return",
];

const FRAME_CELLS: [number, number][] = [
	[1, 0],
	[2, 0],
	[0, 1],
	[0, 2],
	[0, 3],
	[3, 1],
	[3, 2],
	[3, 3],
	[1, 4],
	[2, 4],
];

const xyz = (s: string | null): [number, number, number] | null => {
	const m = /(-?\d+),(-?\d+),(-?\d+)/.exec(s ?? "");
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

export const runMetrics = (events: TelemetryEvent[], capS?: number): RunMetrics => {
	const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
	const t0 = sorted.length ? Date.parse(sorted[0]!.ts) : 0;
	const within = capS === undefined ? sorted : sorted.filter((e) => Date.parse(e.ts) - t0 <= capS * 1000);
	const origins = new Map<string, [number, number, number]>();
	const cast = new Set<string>();
	const obsTimes: number[] = [];
	let obsidian = 0;
	let deaths = 0;
	let lavaDeaths = 0;
	const counters: Record<string, number> = Object.fromEntries(COUNTED.map((k) => [k, 0]));
	for (const e of within) {
		if (e.category === "cast" && (e.event === "frame_origin" || e.event === "portal_start")) {
			if (/no anchor/.test(e.detail ?? "") && e.event === "frame_origin") continue;
			const p = xyz(e.detail);
			if (p) origins.set(p.join(","), p);
		}
		if (e.category === "cast" && e.event === "obsidian") {
			obsidian++;
			obsTimes.push(Date.parse(e.ts));
			const p = xyz(e.detail);
			if (p) cast.add(p.join(","));
		}
		if (e.category === "death" && e.event === "message") {
			deaths++;
			if (/death\.attack\.lava|lava/.test(e.detail ?? "")) lavaDeaths++;
		}
		if (e.category === "cast" && e.event in counters) counters[e.event]!++;
	}
	let best = 0;
	for (const [ox, oy, oz] of origins.values()) {
		let n = 0;
		for (const [dx, dy] of FRAME_CELLS) if (cast.has(`${ox + dx},${oy + dy},${oz}`)) n++;
		best = Math.max(best, n);
	}
	const gaps: number[] = [];
	for (let i = 1; i < obsTimes.length; i++) gaps.push((obsTimes[i]! - obsTimes[i - 1]!) / 1000);
	gaps.sort((a, b) => a - b);
	const med = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)]! : null;
	return { best_frame: best, obsidian, deaths, lava_deaths: lavaDeaths, block_gap_med_s: med, frames: origins.size, counters };
};
