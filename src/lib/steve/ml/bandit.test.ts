import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drawParams, loadParams, saveParams, updateParams, type ParamsFile } from "./bandit.ts";
import { rngFrom } from "./stats.ts";

describe("bandit", () => {
	it("pinned params always return the pin", () => {
		expect(drawParams(loadParams("/nonexistent/params.json")).anchor_dy_max).toBe("3");
	});
	it("an unpinned bandit converges on the better arm", () => {
		const path = join(mkdtempSync(join(tmpdir(), "bandit-")), "params.json");
		const p: ParamsFile = { x: { arms: { good: [1, 1], bad: [1, 1] } } };
		saveParams(p, path);
		const rng = rngFrom(7);
		const truth: Record<string, number> = { good: 0.8, bad: 0.2 };
		let goodPicks = 0;
		for (let i = 0; i < 300; i++) {
			const chosen = drawParams(loadParams(path), rng);
			if (chosen.x === "good") goodPicks++;
			updateParams({ x: chosen.x! }, rng() < truth[chosen.x!]!, path);
		}
		expect(goodPicks).toBeGreaterThan(200);
	});
});
