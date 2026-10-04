// Cycle 4 §7.2 — front-load lava: every refill trip fills every spare empty bucket
// (keeping one empty only while the water bucket is missing). Apply after 7.1's batch.
import { readFileSync, writeFileSync } from "node:fs";
const f = "src/lib/steve/tasks/portal/cast.ts";
let s = readFileSync(f, "utf8");
const sub = (a: string, b: string) => {
	if (!s.includes(a)) throw new Error(`missing: ${a.slice(0, 70)}`);
	s = s.replace(a, b);
};
sub(`export const castObsidianAt = async (`, `// Cycle 4 §7.2: one refill trip fills EVERY spare empty bucket with lava (the water
// bucket stays water; while it is missing one empty is kept for the water refill), so a
// trip pays for two blocks with 3 buckets and the first blocks need no walk at all.
const fillLavaAll = async (bot: Bot): Promise<boolean> => {
	if (count(bot, "lava_bucket") < 1 && !(await fillBucket(bot, "lava"))) return false;
	for (let k = 0; k < 4; k++) {
		const keep = count(bot, "water_bucket") < 1 ? 1 : 0;
		if (count(bot, "bucket") <= keep) break;
		const before = count(bot, "lava_bucket");
		if (!(await fillBucket(bot, "lava")) || count(bot, "lava_bucket") <= before) break;
	}
	logEvent("cast", "front_load", \`lava \${count(bot, "lava_bucket")} water \${count(bot, "water_bucket")} empty \${count(bot, "bucket")}\`);
	return true;
};

export const castObsidianAt = async (`);
sub(`		if (count(bot, "lava_bucket") < 1 && !(await fillBucket(bot, "lava")))
			return false;`, `		if (count(bot, "lava_bucket") < 1 && !(await fillLavaAll(bot)))
			return false;`);
sub(`				if (count(bot, "lava_bucket") < 1 && count(bot, "bucket") >= 1) await fillBucket(bot, "lava");`, `				if (count(bot, "bucket") >= 1) await fillLavaAll(bot);`);
sub(`	setPhase("lava_fill");
	if (count(bot, "lava_bucket") < 1 && count(bot, "bucket") >= 1)
		await fillBucket(bot, "lava");`, `	setPhase("lava_fill");
	if (count(bot, "bucket") >= 1) await fillLavaAll(bot);`);
writeFileSync(f, s);
console.log("7.2 applied");
