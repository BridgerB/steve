/**
 * The decision loop, CSP / core.async style.
 *
 *   sense  → an immutable `GameState` carried on a `tick` Event (built by main.ts)
 *   decide → `reduce(RunState, Event)` — a PURE function: state value in,
 *            { next state value, commands } out. No bot, no mutation, testable.
 *   act    → `runCommand` runs the (only) side effects. The one long-running act,
 *            `Step.execute`, runs CONCURRENTLY and posts its result back onto the
 *            channel as an epoch-stamped `stepDone` event — so the go-loop keeps
 *            draining preemption events (water-trap, death) while a step runs.
 *
 * The whole run state is ONE immutable value (`RunState`) threaded through the
 * loop, replacing the old scattered module-level mutables. `epoch` (was
 * `generation`) invalidates stale step results by value: a death or water-preempt
 * bumps it, so the eventual `stepDone` carries a stale epoch and is ignored.
 */

import type { Bot } from "typecraft";
import { exploreRandom, rememberResource } from "./bot-utils.ts";
import { logEvent } from "./logger.ts";
import { type Channel, CLOSED } from "./channel.ts";
import { getPhase, isDragonDead } from "../state.ts";
import { getNextStep, getProgress, steps } from "../steps.ts";
import type { GameState, Step, StepResult } from "../types.ts";

type Vec3 = { x: number; y: number; z: number };

const log = (message: string): void => {
	const timestamp = new Date().toISOString().split("T")[1]?.split(".")[0];
	console.log(`[${timestamp}] ${message}`);
};

// ── State (one immutable value, replaces the 6 module-level mutables) ──

export type RunStatus = "idle" | "running" | "escaping";

export type RunState = Readonly<{
	epoch: number; // was `generation` — bumped on death / water-preempt / abort
	status: RunStatus; // "running" was isExecuting; "escaping" was waterOverride
	currentStepId: string | null;
	completed: ReadonlySet<string>;
	consecutiveFailures: number;
	// Ticks to wait before starting the next step after a failure. Stops a step
	// that fails fast (e.g. "Cannot find place for furnace") from re-running at the
	// 20Hz tick rate — a hot-spin that burns CPU and visually flickers the viewer.
	failureBackoffTicks: number;
}>;

export const initialRunState: RunState = {
	epoch: 0,
	status: "idle",
	currentStepId: null,
	completed: new Set(),
	consecutiveFailures: 0,
	failureBackoffTicks: 0,
};

type SteveStatus = {
	step: number;
	done: number[];
	phase: string;
	progress: { completed: number; total: number; percent: number };
};

// ── Events (values flowing IN on the channel) ──

export type Event =
	| { type: "tick"; state: GameState; inWaterTrap: boolean; rememberWaterPos?: Vec3 }
	| { type: "stepDone"; epoch: number; result: StepResult }
	| { type: "stepError"; epoch: number; message: string }
	| { type: "death" }
	| { type: "disconnect" };

// ── Commands (the ONLY side effects, flowing OUT of the reducer) ──

export type Command =
	| { type: "runStep"; stepId: string; state: GameState; epoch: number; timeoutMs: number }
	| { type: "escapeWater" }
	| { type: "abortExplore" }
	| { type: "closeWindow" }
	| { type: "publishStatus"; status: SteveStatus }
	| { type: "rememberSurfaceWater"; pos: Vec3 }
	| { type: "victory" }
	| { type: "console"; msg: string }
	| { type: "event"; category: string; event: string; detail?: string };

// Steps the deadlock recovery clears to force a re-gather when nothing is runnable.
const DEADLOCK_IDS = [
	"gather_wood",
	"craft_planks",
	"craft_crafting_table",
	"craft_sticks",
	"craft_wooden_pickaxe",
];

// The obsidian cast genuinely needs minutes; everything else fits in 120s.
const stepTimeoutMs = (stepId: string): number =>
	stepId === "build_nether_portal" ? 480000 : 120000;

const completedFrom = (state: GameState): Set<string> =>
	new Set(steps.filter((s) => s.isComplete(state)).map((s) => s.id));

const buildStatus = (
	completed: ReadonlySet<string>,
	currentStepId: string | null,
	phase: string,
	progress: SteveStatus["progress"],
): SteveStatus => ({
	// Indices map to the dashboard's 30-step chain, which does NOT include the
	// priority-0 escape_water step — so exclude it and shift everything down by one
	// (escape_water is index 0, so `index - 1`). escape_water itself reports step -1.
	step:
		currentStepId && currentStepId !== "escape_water"
			? steps.findIndex((s) => s.id === currentStepId) - 1
			: -1,
	done: steps.flatMap((s, i) =>
		s.id !== "escape_water" && completed.has(s.id) ? [i - 1] : [],
	),
	phase,
	progress,
});

const phaseLine = (
	phase: string,
	step: Step | null,
	progress: SteveStatus["progress"],
): string =>
	`[${phase}] ${step ? `→ ${step.name}` : "→ (no available step)"} (${progress.completed}/${progress.total})`;

// ── The pure reducer: (RunState, Event) → { state, commands } ──

export const reduce = (
	rs: RunState,
	ev: Event,
): { state: RunState; commands: Command[] } => {
	switch (ev.type) {
		case "death":
			return {
				state: {
					epoch: rs.epoch + 1,
					status: "idle",
					currentStepId: null,
					completed: new Set(),
					consecutiveFailures: 0,
					failureBackoffTicks: 0,
				},
				commands: [
					{ type: "console", msg: "Died! Respawning..." },
					{ type: "event", category: "lifecycle", event: "death" },
				],
			};

		case "disconnect":
			// Terminal — the go-loop closes the channel; nothing to fold.
			return { state: rs, commands: [] };

		case "stepError": {
			if (ev.epoch !== rs.epoch) {
				return {
					state: rs,
					commands: [
						{ type: "event", category: "step", event: "stale", detail: `error from epoch ${ev.epoch}, now ${rs.epoch}` },
					],
				};
			}
			return {
				state: { ...rs, status: "idle", consecutiveFailures: rs.consecutiveFailures + 1 },
				commands: [
					{ type: "closeWindow" },
					{ type: "console", msg: `✗ ${ev.message}` },
					{ type: "event", category: "step", event: "error", detail: ev.message },
				],
			};
		}

		case "stepDone": {
			// Stale: a death or water-preempt bumped the epoch while this step ran.
			if (ev.epoch !== rs.epoch) {
				return {
					state: rs,
					commands: [
						{ type: "event", category: "step", event: "stale", detail: `result from epoch ${ev.epoch}, now ${rs.epoch}` },
					],
				};
			}
			const stepId = rs.currentStepId;
			if (ev.result.success) {
				const completed = new Set(rs.completed);
				if (stepId) completed.add(stepId);
				return {
					state: { ...rs, status: "idle", consecutiveFailures: 0, failureBackoffTicks: 0, completed },
					commands: [
						{ type: "closeWindow" },
						{ type: "console", msg: `✓ ${ev.result.message}` },
						{ type: "event", category: "step", event: "success", detail: ev.result.message },
					],
				};
			}
			const failures = rs.consecutiveFailures + 1;
			const base: Command[] = [
				{ type: "closeWindow" },
				{ type: "console", msg: `✗ ${ev.result.message} (fail #${failures})` },
				{ type: "event", category: "step", event: "fail", detail: ev.result.message },
			];
			if (failures >= 20) {
				return {
					state: {
						epoch: rs.epoch + 1,
						status: "idle",
						currentStepId: null,
						completed: new Set(),
						consecutiveFailures: 0,
						failureBackoffTicks: 0,
					},
					commands: [
						...base,
						{ type: "console", msg: `ABORT: ${failures} consecutive failures — resetting + relocating` },
						{ type: "event", category: "step", event: "abort", detail: `${failures} failures` },
						{ type: "abortExplore" },
					],
				};
			}
			return {
				state: {
					...rs,
					status: "idle",
					consecutiveFailures: failures,
					// Back off so a fast-failing step can't re-run at the 20Hz tick rate
					// (hot-spin → CPU burn + viewer flicker). Grows with the streak, capped
					// at 60 ticks (~3s).
					failureBackoffTicks: Math.min(failures * 10, 60),
				},
				commands: base,
			};
		}

		case "tick": {
			const { state } = ev;
			const cmds: Command[] = [];
			if (ev.rememberWaterPos) {
				cmds.push({ type: "rememberSurfaceWater", pos: ev.rememberWaterPos });
			}

			if (isDragonDead(state)) {
				cmds.push({ type: "victory" });
				return { state: rs, commands: cmds };
			}

			// Re-evaluate the FULL step list EVERY tick (no special water override).
			// `escape_water` is just the priority-0 step: whenever the bot is in the trap
			// it is the top runnable step. Resync `completed` from the world too (handles
			// regression on item loss / picking the right step).
			let completed = completedFrom(state);

			// Low health → wait for regen, UNLESS in the water trap (drowning is the more
			// urgent thing and the escape doesn't care about HP).
			if ((state.health ?? 20) < 6 && !state.inWaterTrap) {
				return { state: { ...rs, completed }, commands: cmds };
			}

			const phase = getPhase(state);
			const progress = getProgress(state);
			let nextStep = getNextStep(state, completed);

			// Deadlock recovery — nothing runnable → clear the gather chain and retry.
			if (!nextStep && phase !== "VICTORY") {
				cmds.push({ type: "event", category: "step", event: "deadlock", detail: "no executable step — forcing gather_wood" });
				completed = new Set(completed);
				for (const id of DEADLOCK_IDS) completed.delete(id);
				nextStep = getNextStep(state, completed);
			}

			if (rs.status === "running") {
				// PREEMPT: a HIGHER-priority step became runnable (the classic case: the bot
				// fell in water mid-mine, so escape_water — priority 0 — is now top). Bump the
				// epoch so the running step's eventual result is ignored as stale, and start
				// the new one. The displaced long task self-bails on its own water check, so
				// the two don't fight for control.
				const current = steps.find((s) => s.id === rs.currentStepId);
				if (nextStep && current && nextStep.id !== current.id && nextStep.priority < current.priority) {
					cmds.push(
						{ type: "publishStatus", status: buildStatus(completed, nextStep.id, phase, progress) },
						{ type: "console", msg: `⚠ preempt ${current.name} → ${nextStep.name}` },
						{ type: "event", category: "step", event: "preempt", detail: `${current.name} → ${nextStep.name}` },
						{ type: "event", category: "step", event: "start", detail: nextStep.name },
						{ type: "runStep", stepId: nextStep.id, state, epoch: rs.epoch + 1, timeoutMs: stepTimeoutMs(nextStep.id) },
					);
					return { state: { ...rs, epoch: rs.epoch + 1, status: "running", currentStepId: nextStep.id, completed }, commands: cmds };
				}
				return { state: { ...rs, completed }, commands: cmds }; // keep running
			}

			// Failure backoff (idle only): after a step failed, wait a few ticks before
			// starting the next so a fast-failing step can't hot-spin at 20Hz (CPU burn +
			// viewer flicker). Skip while in the water trap — escaping is urgent. Resume
			// normal selection once it decrements to 0.
			if (rs.failureBackoffTicks > 0 && !state.inWaterTrap) {
				return {
					state: { ...rs, failureBackoffTicks: rs.failureBackoffTicks - 1, completed },
					commands: cmds,
				};
			}

			// Idle — start the top step.
			const currentStepId = nextStep?.id ?? null;
			if (currentStepId !== rs.currentStepId) {
				cmds.push({ type: "console", msg: phaseLine(phase, nextStep, progress) });
			}
			cmds.push({ type: "publishStatus", status: buildStatus(completed, currentStepId, phase, progress) });

			if (nextStep) {
				cmds.push(
					{ type: "console", msg: `Starting: ${nextStep.name}` },
					{ type: "event", category: "step", event: "start", detail: nextStep.name },
					{ type: "runStep", stepId: nextStep.id, state, epoch: rs.epoch, timeoutMs: stepTimeoutMs(nextStep.id) },
				);
				return { state: { ...rs, status: "running", currentStepId, completed }, commands: cmds };
			}
			return { state: { ...rs, status: "idle", currentStepId, completed }, commands: cmds };
		}
	}
};

// ── The executor: runs commands. The ONLY impure part. ──

const runCommand = (bot: Bot, ch: Channel<Event>, c: Command): void => {
	switch (c.type) {
		case "runStep": {
			const step = steps.find((s) => s.id === c.stepId);
			if (!step) {
				ch.put({ type: "stepError", epoch: c.epoch, message: `unknown step ${c.stepId}` });
				return;
			}
			// Fire-and-forget: returns immediately so the go-loop keeps draining ticks
			// (water-trap / death) while the step runs. Completion posts back as an
			// epoch-stamped event. The .catch is MANDATORY — a swallowed rejection would
			// wedge status:"running" forever.
			const timeout = new Promise<StepResult>((resolve) =>
				setTimeout(
					() => resolve({ success: false, message: `${step.name} timed out (${c.timeoutMs / 1000}s)` }),
					c.timeoutMs,
				),
			);
			Promise.race([step.execute(bot, c.state), timeout])
				.then((result) => ch.put({ type: "stepDone", epoch: c.epoch, result }))
				.catch((err) =>
					ch.put({ type: "stepError", epoch: c.epoch, message: err instanceof Error ? err.message : String(err) }),
				);
			return;
		}
		case "escapeWater":
			// attachSafety already pathfinds out of the water; pausing steps (done in the
			// reducer by bumping epoch + status:"escaping") is all that's needed here.
			return;
		case "abortExplore":
			exploreRandom(bot, 48).catch(() => {});
			return;
		case "closeWindow":
			if (bot.currentWindow) {
				try {
					bot.closeWindow(bot.currentWindow);
				} catch {}
			}
			return;
		case "publishStatus":
			(bot as Bot & { steveStatus?: unknown }).steveStatus = c.status;
			return;
		case "rememberSurfaceWater":
			rememberResource(bot, "water", c.pos);
			return;
		case "victory":
			log("VICTORY! The Ender Dragon has been defeated!");
			bot.chat("I have slain the Ender Dragon!");
			return;
		case "console":
			log(c.msg);
			return;
		case "event":
			logEvent(c.category, c.event, c.detail, bot.entity?.position);
			return;
	}
};

// ── The go-loop: park on the channel, fold each event, run its commands. ──

export const runGoLoop = async (bot: Bot, ch: Channel<Event>): Promise<void> => {
	let rs = initialRunState;
	while (true) {
		const ev = await ch.take(); // PARK here — zero CPU until a value arrives
		if (ev === CLOSED) break;
		const { state, commands } = reduce(rs, ev);
		rs = state;
		for (const c of commands) runCommand(bot, ch, c);
	}
};
