// The frame origin is the stored site anchor whenever it is within 16 blocks — never
// "where the bot stands". The anchor cell is the frame's corner: once the left column
// is cast there is obsidian at its head height and the bot can never stand on it, so
// the old "onAnchor = within 1.5" test failed on every late re-dispatch and the cast
// started a NEW frame at the bot (p0b-6 4×; base3-2 lost a 9/10 frame this way).
// Anchor farther than 16 → fail the attempt (the next one walks back / re-plans).
// Also: log when a cell an earlier event called obsidian is no longer obsidian.
import { readFileSync, writeFileSync } from "node:fs";
const f = "src/lib/steve/tasks/portal/cast.ts";
let s = readFileSync(f, "utf8");
const sub = (a: string, b: string) => {
	if (!s.includes(a)) throw new Error(`missing: ${a.slice(0, 70)}`);
	s = s.replace(a, b);
};
sub(`	const onAnchor = !!anchor && distance(bot.entity.position, offset(anchor, 0.5, 0, 0.5)) <= 1.5;
	logEvent("cast", "frame_origin", onAnchor ? \`anchor \${anchor!.x},\${anchor!.y},\${anchor!.z}\` : \`no anchor (\${anchor ? "far" : "none"}) — using the bot's position\`);`, `	const anchorD = anchor ? distance(bot.entity.position, offset(anchor, 0.5, 0, 0.5)) : Number.POSITIVE_INFINITY;
	if (anchor && anchorD > 16) {
		logEvent("cast", "anchor_unreached", \`anchor \${anchor.x},\${anchor.y},\${anchor.z} still \${anchorD.toFixed(1)} away — not starting a second frame\`, bot.entity.position);
		return { success: false, message: \`Could not reach the cast anchor (\${anchorD.toFixed(0)} away) — retry\` };
	}
	const onAnchor = !!anchor;
	logEvent("cast", "frame_origin", onAnchor ? \`anchor \${anchor!.x},\${anchor!.y},\${anchor!.z} (bot \${anchorD.toFixed(1)} off)\` : "no anchor (none) — using the bot's position");`);
sub(`	if (getBlock(bot, pos)?.name === "obsidian") return true;
	// Stand 1 block in front`, `	if (getBlock(bot, pos)?.name === "obsidian") return true;
	if (castDone.has(\`\${pos.x},\${pos.y},\${pos.z}\`))
		logEvent("cast", "obsidian_lost", \`\${pos.x},\${pos.y},\${pos.z} was cast earlier, now \${getBlock(bot, pos)?.name ?? "?"}\`, bot.entity.position);
	// Stand 1 block in front`);
sub(`			logEvent("cast", "obsidian", \`\${pos.x},\${pos.y},\${pos.z}\`);`, `			logEvent("cast", "obsidian", \`\${pos.x},\${pos.y},\${pos.z}\`);
			castDone.add(\`\${pos.x},\${pos.y},\${pos.z}\`);`);
sub(`export const castObsidianAt = async (`, `// Cells this process has cast (for the obsidian_lost diagnostic).
const castDone = new Set<string>();

export const castObsidianAt = async (`);
writeFileSync(f, s);
console.log("farfix applied");
