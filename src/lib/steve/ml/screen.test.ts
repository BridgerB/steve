import { describe, expect, it } from "vitest";
import { runMetrics } from "./screen.ts";

const ev = (min: number, category: string, event: string, detail: string) => ({
	ts: new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString(),
	category,
	event,
	detail,
});

describe("runMetrics", () => {
	const events = [
		ev(0, "cast", "frame_origin", "anchor 10,64,5"),
		ev(1, "cast", "obsidian", "11,64,5"),
		ev(2, "cast", "obsidian", "10,65,5"),
		ev(3, "cast", "anchor_unreached", ""),
		ev(4, "cast", "frame_origin", "no anchor (far) — using the bot's position"),
		ev(5, "cast", "obsidian", "40,64,5"), // outside every frame
		ev(40, "cast", "obsidian", "12,64,5"),
		ev(41, "death", "message", "[death.attack.lava] Gym_nat"),
	];
	it("counts the best frame from its own cells only", () => {
		const m = runMetrics(events);
		expect(m.best_frame).toBe(3);
		expect(m.obsidian).toBe(4);
		expect(m.deaths).toBe(1);
		expect(m.lava_deaths).toBe(1);
		expect(m.counters.anchor_unreached).toBe(1);
		expect(m.frames).toBe(1);
	});
	it("truncates at the cap", () => {
		const m = runMetrics(events, 1800);
		expect(m.best_frame).toBe(2);
		expect(m.obsidian).toBe(3);
		expect(m.deaths).toBe(0);
	});
});
