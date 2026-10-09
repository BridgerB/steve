/**
 * Read a plan file the same way in the plan job and every worker: the plan JSON, with its
 * defaults filled from ci/capacity.json (the measured bots-per-server and heap) when present.
 */
import { existsSync, readFileSync } from "node:fs";
import { type Capacity, type Plan, parsePlan, withCapacity } from "./plan.ts";

export const loadPlan = (path: string, capacityPath = "ci/capacity.json"): Plan => {
	const cap = existsSync(capacityPath) ? (JSON.parse(readFileSync(capacityPath, "utf8")) as Capacity) : null;
	return parsePlan(withCapacity(JSON.parse(readFileSync(path, "utf8")), cap));
};
