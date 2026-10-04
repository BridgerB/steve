// typecraft: make MovementsConfig.exclusionAreasStep take effect (declared but never
// applied). Each fn returns an extra cost for stepping into (x,y,z); a non-finite or
// negative value refuses the step.
import { readFileSync, writeFileSync } from "node:fs";
const f = "src/lib/typecraft/path/movements.ts";
const s = readFileSync(f, "utf8");
const a = `		parkour = false,
	): void => {
		neighbors[neighborCount++] = {`;
if (!s.includes(a)) throw new Error("missing pushNeighbor");
writeFileSync(f, s.replace(a, `		parkour = false,
	): void => {
		for (const area of cfg.exclusionAreasStep) {
			const extra = area(x, y, z);
			if (!Number.isFinite(extra) || extra < 0) return;
			cost += extra;
		}
		neighbors[neighborCount++] = {`));
console.log("exclusionAreasStep wired");
