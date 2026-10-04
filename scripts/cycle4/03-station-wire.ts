// Cycle 4 §7.3 — wire the sealed refill station (station.ts) into the cast's lava
// refills. Apply AFTER 7.2 (p-72.ts) is committed: it replaces fillLavaAll's body.
import { readFileSync, writeFileSync } from "node:fs";
const f = "src/lib/steve/tasks/portal/cast.ts";
let s = readFileSync(f, "utf8");
const sub = (a: string, b: string) => {
	if (!s.includes(a)) throw new Error(`missing: ${a.slice(0, 70)}`);
	s = s.replace(a, b);
};
sub(`const fillLavaAll = async (bot: Bot): Promise<boolean> => {
	if (count(bot, "lava_bucket") < 1 && !(await fillBucket(bot, "lava"))) return false;`, `const stationDeps = (bot: Bot): StationDeps => ({
	name: (p) => getBlock(bot, p)?.name,
	isSolid,
	isLava,
	isAir,
	isSource: (p) => {
		const lv = (getBlock(bot, p) as { properties?: { level?: unknown } } | null)?.properties?.level;
		return lv == null || String(lv) === "0";
	},
	count: (n) => count(bot, n),
	equip: (n) => equip(bot, n),
	placeCobble: (p) => placeCobble(bot, p),
	use: (look) => reliableUse(bot, look),
});
const fillLavaAll = async (bot: Bot): Promise<boolean> => {
	// §7.3: the sealed station first — fill every spare empty there.
	const keep = () => (count(bot, "water_bucket") < 1 ? 1 : 0);
	await stationRefill(bot, stationDeps(bot), {
		frame: siteAnchor.get(bot) ?? null,
		enough: () => count(bot, "bucket") <= keep(),
	});
	if (count(bot, "lava_bucket") >= 1) {
		logEvent("cast", "front_load", \`station: lava \${count(bot, "lava_bucket")} water \${count(bot, "water_bucket")} empty \${count(bot, "bucket")}\`);
		return true;
	}
	if (count(bot, "lava_bucket") < 1 && !(await fillBucket(bot, "lava"))) return false;`);
sub(`import { setTarget } from "../../lib/progress.ts";`, `import { setTarget } from "../../lib/progress.ts";
import { type StationDeps, stationRefill } from "./station.ts";`);
writeFileSync(f, s);
console.log("7.3 wired (station first, old fillBucket as fallback until measured)");
