/**
 * One guarded portal-cast attempt (prepareCastSite + buildPortalByCasting), shared by
 * the race's build_nether_portal step and the natural-terrain gym so both measure the
 * same thing (cycle 4 Part 6). The attempt gets a budget, a stall detector on the
 * ratcheted progress, and ends on death (the site is forgotten; the next attempt
 * re-sites). Each attempt writes one portal_cast row to the event log.
 */
import type { Bot } from "typecraft";
import { buildId, senseContext, writeAttempt } from "../../lib/attempts.ts";
import { getRaceId } from "../../lib/logger.ts";
import { guardedAttempt, progressSnapshot } from "../../lib/progress.ts";
import { drawParams, num, updateParams, useParams } from "../../ml/bandit.ts";
import { KIT_BUCKETS } from "../../steps.ts";
import type { StepResult } from "../../types.ts";
import { buildPortalByCasting, prepareCastSite } from "./cast.ts";

let attemptN = 0;

export const castAttempt = async (
	bot: Bot,
	opts: { budgetMs: number; source: "gym" | "race" },
): Promise<StepResult & { outcome: string }> => {
	// A spare pickaxe before the attempt, while there is still cobble for one.
	try {
		const { ensureSparePickaxe } = await import("../mining/main.ts");
		// Capped: s4n-1 hung 22 min in a table craft here, outside the attempt guard.
		await Promise.race([ensureSparePickaxe(bot), new Promise((r) => setTimeout(r, 30_000))]);
	} catch {}
	const params = drawParams();
	// The bucket arm is the kit this bot was built with (drawn once per bot), not a fresh draw.
	params.buckets = String(KIT_BUCKETS);
	useParams(params);
	const startMs = Date.now();
	const context = senseContext(bot);
	const g = await guardedAttempt(
		bot,
		async (): Promise<StepResult> => {
			const prep = await prepareCastSite(bot);
			if (!prep.success) return prep;
			return buildPortalByCasting(bot);
		},
		// Death ends the attempt but keeps the site: the next attempt walks back to a frame
		// within 200 blocks (prepareCastSite) and re-sites only beyond that (cycle 4 Part 6).
		// base1-1 lost a 9/10 frame to an unconditional forget on death.
		{ budgetMs: opts.budgetMs, stallMs: num(params, "stall_s", 180) * 1000 },
	);
	const snap = progressSnapshot();
	const outcome = g.success ? "ok" : "outcome" in g ? g.outcome : "failed";
	const p = bot.entity?.position;
	writeAttempt({
		run_id: `${getRaceId()}-d${++attemptN}`,
		bot_impl: "ts",
		build: buildId(),
		world_seed: process.env.GYM_SEED ?? null,
		skill: "portal_cast",
		step_id: "build-nether-portal",
		source: opts.source,
		bot: bot.username,
		start_ms: startMs,
		duration_s: Math.round((Date.now() - startMs) / 100) / 10,
		outcome,
		reason: g.message,
		death_cause: outcome === "death" ? snap.deathCause : null,
		pos: p ? [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)] : null,
		deepest_phase: snap.phase,
		progress: snap.obsidian,
		params,
		context,
	});
	// Credit the drawn arms (cycle 5 decision 6: live on anchor_dy_max and stall_s; pinned
	// params are never updated). Reward: the attempt placed obsidian or finished.
	// Cycle 6 (decision 7): arena attempts (GYM_LAVA_D) never credit an arm.
	if (!(Number(process.env.GYM_LAVA_D ?? 0) > 0)) {
		try {
			updateParams(params, g.success || snap.obsidian > 0);
		} catch {}
	}
	return { success: g.success, message: g.message, outcome };
};
