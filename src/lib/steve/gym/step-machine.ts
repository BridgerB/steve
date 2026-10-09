/**
 * Run the real race step machine inside a gym trial (cycle 7): the same channel, go-loop and
 * physics-tick feed as a race bot (main.ts), from whatever inventory the slug granted, until
 * `done()` holds or the budget runs out. For slugs that reproduce a race state (iron-deadlock).
 */
import type { Bot } from "typecraft";
import { needsWaterEscape } from "../lib/bot-utils.ts";
import { createChannel } from "../lib/channel.ts";
import { logEvent } from "../lib/logger.ts";
import { type Event, runGoLoop } from "../lib/run-loop.ts";
import { syncFromBot } from "../state.ts";

export const runStepMachine = async (bot: Bot, done: () => Promise<boolean>, budgetMs: number): Promise<{ ok: boolean; seconds: number }> => {
	const t0 = Date.now();
	const ch = createChannel<Event>();
	const loop = runGoLoop(bot, ch).catch((e) => logEvent("gym", "step_machine_error", e instanceof Error ? e.message : String(e)));
	const onTick = () => {
		try {
			ch.put({ type: "tick", state: syncFromBot(bot), inWaterTrap: needsWaterEscape(bot) });
		} catch {}
	};
	const onDeath = () => ch.put({ type: "death" });
	const b = bot as unknown as { on: (e: string, f: () => void) => void; removeListener: (e: string, f: () => void) => void };
	b.on("physicsTick", onTick);
	b.on("death", onDeath);
	onTick();
	let ok = false;
	try {
		while (Date.now() - t0 < budgetMs) {
			await new Promise((r) => setTimeout(r, 5000));
			if (await done()) {
				ok = true;
				break;
			}
		}
	} finally {
		b.removeListener("physicsTick", onTick);
		b.removeListener("death", onDeath);
		ch.close();
		await Promise.race([loop, new Promise((r) => setTimeout(r, 2000))]);
	}
	return { ok, seconds: Math.round((Date.now() - t0) / 1000) };
};
