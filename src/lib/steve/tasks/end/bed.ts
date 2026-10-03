/**
 * Dragon by beds (cycle 4 Part 8, skill 12): beds explode in the End. Wait for the
 * dragon to perch on the fountain, then from a stand S facing it along one axis d:
 *   - a 1-high shield block at S+d (feet level),
 *   - a bed with its foot at S+3d (head at S+4d), right-clicked → explosion.
 * The eye ray to the bed top clears the shield (eye 1.62, shield top 1.0 at 1.5 out,
 * bed top 0.56 at 2.6 out), while most explosion rays to the body cross the shield,
 * so the bot takes a fraction of the blast. Every detonation is logged with the
 * dragon's position and the bot's hp: the first deliverable is the failure log.
 */
import type { Bot } from "typecraft";
import { vec3, windowItems, type Vec3 } from "typecraft";
import { logEvent, setPhase } from "../../lib/logger.ts";
import type { Block, StepResult } from "../../types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const item = (bot: Bot, pred: (n: string) => boolean) => windowItems(bot.inventory).find((i) => pred(i.name));
const blockName = (bot: Bot, p: Vec3): string => (bot.blockAt(p) as { name?: string } | null)?.name ?? "air";
const isAirish = (n: string) => n === "air" || n === "cave_air" || n === "void_air" || n === "fire";
const solid = (n: string) => !isAirish(n) && n !== "water" && n !== "lava" && !n.endsWith("_bed");

const dragonOf = (bot: Bot) => Object.values(bot.entities).find((e) => e.name === "ender_dragon");

const eat = async (bot: Bot): Promise<void> => {
	const food = item(bot, (n) => n.startsWith("cooked_") || n === "bread");
	if (!food) return;
	try {
		await bot.equip(food, "hand");
		bot.activateItem();
		await sleep(1800);
		bot.deactivateItem();
	} catch {}
	(bot as unknown as { usingHeldItem: boolean }).usingHeldItem = false;
};

/** Place `name` into `cell` against the block below it. */
const placeOn = async (bot: Bot, name: string, cell: Vec3): Promise<boolean> => {
	if (blockName(bot, cell) === name || (name.endsWith("_bed") && blockName(bot, cell).endsWith("_bed"))) return true;
	const it = item(bot, (n) => n === name || (name === "bed" && n.endsWith("_bed")));
	if (!it) return false;
	const floor = bot.blockAt(vec3(cell.x, cell.y - 1, cell.z)) as Block | null;
	if (!floor || !solid(floor.name)) return false;
	try {
		await bot.equip(it, "hand");
		await bot.placeBlockWithOptions(floor as never, vec3(0, 1, 0), { forceLook: true });
	} catch {}
	await sleep(250);
	const now = blockName(bot, cell);
	return now === name || (name === "bed" && now.endsWith("_bed"));
};

export const bedDragon = async (bot: Bot, budgetMs: number): Promise<StepResult> => {
	const t0 = Date.now();
	let beds = 0;
	let gone = 0;
	setPhase("dragon_wait");
	while (Date.now() - t0 < budgetMs) {
		if ((bot.health ?? 20) < 10) await eat(bot);
		const dragon = dragonOf(bot);
		if (!dragon) {
			// Not tracked: out of entity range, or dead. Two quiet checks in a row → let the
			// harness confirm by RCON.
			if (++gone >= 20) return { success: true, message: `no dragon in view for 10 s after ${beds} bed(s)` };
			await sleep(500);
			continue;
		}
		gone = 0;
		const dp = dragon.position;
		const p = bot.entity.position;
		const perch = Math.hypot(dp.x, dp.z) < 8 && dp.y < p.y + 8;
		if (!perch) {
			await sleep(400);
			continue;
		}
		setPhase("dragon_perch");
		if (!item(bot, (n) => n.endsWith("_bed"))) return { success: false, message: `out of beds after ${beds}` };
		const ax = Math.abs(dp.x - p.x) >= Math.abs(dp.z - p.z);
		const d = ax ? vec3(Math.sign(dp.x - p.x) || 1, 0, 0) : vec3(0, 0, Math.sign(dp.z - p.z) || 1);
		const S = vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
		const shield = vec3(S.x + d.x, S.y, S.z + d.z);
		const foot = vec3(S.x + 3 * d.x, S.y, S.z + 3 * d.z);
		const head = vec3(S.x + 4 * d.x, S.y, S.z + 4 * d.z);
		const shieldOk = solid(blockName(bot, shield)) || (await placeOn(bot, "obsidian", shield));
		if (!isAirish(blockName(bot, foot)) || !isAirish(blockName(bot, head))) {
			logEvent("end", "bed_blocked", `foot ${foot.x},${foot.y},${foot.z}=${blockName(bot, foot)} head=${blockName(bot, head)}`, p);
			await sleep(1000);
			continue;
		}
		// The bed's head extends the way the bot faces: look along d first.
		try {
			await bot.lookAt(vec3(p.x + d.x * 4, p.y + 1, p.z + d.z * 4), true);
		} catch {}
		const placed = await placeOn(bot, "bed", foot);
		const hp0 = bot.health ?? 0;
		if (!placed) {
			logEvent("end", "bed_place_fail", `foot ${foot.x},${foot.y},${foot.z} floor=${blockName(bot, vec3(foot.x, foot.y - 1, foot.z))}`, p);
			await sleep(800);
			continue;
		}
		try {
			await bot.activateBlock(foot, vec3(0, 1, 0), vec3(0.5, 0.5, 0.5));
		} catch {}
		beds++;
		await sleep(600);
		const dragonNow = dragonOf(bot)?.position ?? dp;
		logEvent(
			"end",
			"bed_detonate",
			`#${beds} dragon ${dp.x.toFixed(1)},${dp.y.toFixed(1)},${dp.z.toFixed(1)} → ${dragonNow.x.toFixed(1)},${dragonNow.y.toFixed(1)},${dragonNow.z.toFixed(1)} bot hp ${hp0.toFixed(1)} → ${(bot.health ?? 0).toFixed(1)} shield=${shieldOk ? 1 : 0} d=${d.x},${d.z} bed=${blockName(bot, foot)}`,
			bot.entity.position,
		);
		await sleep(400);
	}
	return { success: false, message: `dragon alive after ${Math.round(budgetMs / 1000)} s, ${beds} bed(s)` };
};
