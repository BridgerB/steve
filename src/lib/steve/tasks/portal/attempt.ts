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
import { drawParams, num, useParams } from "../../ml/bandit.ts";
import type { StepResult } from "../../types.ts";
import { buildPortalByCasting, prepareCastSite } from "./cast.ts";

let attemptN = 0;

export const castAttempt = async (
	bot: Bot,
	opts: { budgetMs: number; source: "gym" | "race" },
): Promise<StepResult & { outcome: string }> => {
	const params = drawParams();
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
	return { success: g.success, message: g.message, outcome };
};
