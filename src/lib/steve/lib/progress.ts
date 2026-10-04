/**
 * Budgets, ratcheted progress and stall detection (cycle 4, Part 6).
 *
 * A step attempt runs inside `guardedAttempt`, which abandons it when
 *   - its ratcheted progress has not improved for `stallMs`  → outcome "timeout"
 *   - it has run past `budgetMs`                             → outcome "timeout"
 *   - the bot dies                                          → outcome "death"
 * Abandoning moves the bot's live task epoch off the attempt's own epoch (back to the
 * caller's), so the abandoned code unwinds at its next shared primitive (sleep/goTo
 * throw on a stale epoch — see bot-utils taskScope). If someone else moves the live
 * epoch first (a race preempt or death), the attempt is cut as "preempted".
 *
 * Progress only ratchets toward the postcondition: obsidian placed, the deepest cast
 * sub-phase reached, and distance closed to the current target (the lava pool while
 * finding it). Blocks dug, distance walked and dispatches are NOT progress — the bot
 * could farm them. One bot per process, so the state is module-level.
 */
import type { Bot } from "typecraft";
import { beginTaskEpoch, currentTaskEpoch, taskScope } from "./bot-utils.ts";
import { onEvent, onPhase } from "./logger.ts";

const PHASE_RANK: Record<string, number> = {
	find_lava: 1,
	anchor: 2,
	chamber: 3,
	lava_fill: 4,
	portal_start: 5,
	mold: 6,
	lava: 7,
	water: 8,
	verify: 9,
	light: 1000,
	enter: 1001,
};

let obsidian = 0;
let phaseRank = 0;
let best = 0;
let lastImprove = Date.now();
let lastPhase = "";
let target: { x: number; y: number; z: number } | null = null;
let bestDist = Number.POSITIVE_INFINITY;
let deathCause: string | null = null;

const score = (): number => (phaseRank >= 1000 ? phaseRank : obsidian * 10 + phaseRank);

const bump = (): void => {
	const s = score();
	if (s > best) {
		best = s;
		lastImprove = Date.now();
	}
};

/** Called by logger.setPhase: phase strings like "find_lava" or "mold 1,2,3". */
export const notePhase = (phase: string): void => {
	lastPhase = phase;
	const key = phase.split(/[ ,]/)[0] ?? "";
	const r = PHASE_RANK[key];
	if (r !== undefined) {
		phaseRank = r;
		bump();
	}
};

/** Called by logger.logEvent for every event: obsidian placements ratchet progress. */
export const noteEvent = (category: string, event: string, detail?: string): void => {
	// The server's death message key (e.g. "death.attack.lava") for the attempt row.
	if (category === "death" && event === "message") deathCause = /death\.[a-zA-Z_.]+/.exec(detail ?? "")?.[0] ?? "unknown";
	if (category === "cast" && event === "obsidian") {
		obsidian++;
		bump();
	}
};

onPhase(notePhase);
onEvent(noteEvent);

/** The place the current sub-phase is heading for (e.g. the lava pool); null clears it. */
export const setTarget = (t: { x: number; y: number; z: number } | null): void => {
	target = t;
	bestDist = Number.POSITIVE_INFINITY;
};

/** Reset the ratchet at the start of an attempt. */
export const resetProgress = (): void => {
	obsidian = 0;
	phaseRank = 0;
	best = 0;
	lastImprove = Date.now();
	target = null;
	bestDist = Number.POSITIVE_INFINITY;
	deathCause = null;
};

export const progressSnapshot = (): { obsidian: number; phase: string; score: number; idleS: number; deathCause: string | null } => ({
	deathCause,
	obsidian,
	phase: lastPhase,
	score: best,
	idleS: Math.round((Date.now() - lastImprove) / 1000),
});

/** Distance closed to the target counts as progress (≥ 1 block better than the best so far). */
const checkTarget = (bot: Bot): void => {
	const p = bot.entity?.position;
	if (!target || !p) return;
	const d = Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z);
	if (d < bestDist - 1) {
		bestDist = d;
		lastImprove = Date.now();
	}
};

export type Guarded<T> = T | { success: false; message: string; outcome: "timeout" | "death" };

let guardEpoch = 2_000_000_000;

/**
 * Run `fn` under a fresh task epoch with a stall detector, a budget and a death watch.
 * Resolves with fn's result, or with a failure whose `outcome` says why it was cut.
 */
export const guardedAttempt = async <T extends { success: boolean; message: string }>(
	bot: Bot,
	fn: () => Promise<T>,
	opts: { budgetMs: number; stallMs: number; onDeath?: () => void },
): Promise<Guarded<T>> => {
	resetProgress();
	const outer = currentTaskEpoch(bot);
	const epoch = ++guardEpoch;
	beginTaskEpoch(bot, epoch);
	let settle: ((v: Guarded<T>) => void) | null = null;
	const cut = new Promise<Guarded<T>>((r) => {
		settle = r;
	});
	const start = Date.now();
	const onDeath = () => {
		opts.onDeath?.();
		settle?.({ success: false, message: `died at ${lastPhase || "start"} (${obsidian}/10)`, outcome: "death" });
	};
	bot.on("death", onDeath);
	const poll = setInterval(() => {
		if (currentTaskEpoch(bot) !== epoch) {
			settle?.({ success: false, message: `preempted at ${lastPhase || "start"} (${obsidian}/10)`, outcome: "timeout" });
			return;
		}
		checkTarget(bot);
		const idle = Date.now() - lastImprove;
		if (idle > opts.stallMs)
			settle?.({ success: false, message: `no progress in ${Math.round(opts.stallMs / 1000)} s at ${lastPhase || "start"} (${obsidian}/10)`, outcome: "timeout" });
		else if (Date.now() - start > opts.budgetMs)
			settle?.({ success: false, message: `over budget ${Math.round(opts.budgetMs / 1000)} s at ${lastPhase || "start"} (${obsidian}/10)`, outcome: "timeout" });
	}, 2000);
	try {
		const work = taskScope.run({ bot, epoch }, fn).catch(
			(e: unknown) => ({ success: false, message: e instanceof Error ? e.message : String(e) }) as T,
		);
		const res = await Promise.race([work, cut]);
		return res;
	} finally {
		clearInterval(poll);
		(bot as Bot & { removeListener?: (e: string, f: () => void) => void }).removeListener?.("death", onDeath);
		// Unwind anything still running from this attempt at its next primitive, handing
		// the live epoch back to the caller's scope. Leave it alone if a preempt already
		// moved it (that newer epoch belongs to whoever preempted).
		if (currentTaskEpoch(bot) === epoch) beginTaskEpoch(bot, outer ?? ++guardEpoch);
	}
};
