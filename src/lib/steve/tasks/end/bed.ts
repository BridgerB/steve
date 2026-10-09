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
const inEnd = (bot: Bot) => /the_end/.test(String(bot.game?.dimension ?? ""));

/** Dragon's breath (an area_effect_cloud) or a dragon fireball within 4 blocks of the feet. */
const breathNear = (bot: Bot): Vec3 | null => {
	const p = bot.entity.position;
	const e = Object.values(bot.entities).find(
		(x) => (x.name === "area_effect_cloud" || x.name === "dragon_fireball") && Math.hypot(x.position.x - p.x, x.position.z - p.z) < 4 && Math.abs(x.position.y - p.y) < 4,
	);
	return e ? (e.position as Vec3) : null;
};

// Endermen turn hostile when looked at. f7 dragon-1/3/5 were all "slain by Enderman" before
// a single bed, with the gaze level (the tp sets pitch 0). Keep the eyes on the ground except
// to place a bed, which is below eye level too.
const GAZE_DOWN = -1.2;
const gazeDown = async (bot: Bot): Promise<void> => {
	if ((bot.entity.pitch ?? 0) > GAZE_DOWN + 0.1) await bot.look(bot.entity.yaw, GAZE_DOWN, true).catch(() => {});
};

/** An enderman within 3.5 blocks: sword out, hit its body, gaze back down. */
const fendEnderman = async (bot: Bot): Promise<boolean> => {
	const p = bot.entity.position;
	const e = Object.values(bot.entities).find((x) => x.name === "enderman" && Math.hypot(x.position.x - p.x, x.position.z - p.z) < 3.5 && Math.abs(x.position.y - p.y) < 3);
	if (!e) return false;
	const sword = item(bot, (n) => n.endsWith("_sword"));
	try {
		if (sword && bot.heldItem?.name !== sword.name) await bot.equip(sword, "hand");
		await bot.lookAt(vec3(e.position.x, e.position.y + 1, e.position.z), true);
		bot.attack(e as never);
	} catch {}
	logEvent("end", "enderman_hit", `at ${e.position.x.toFixed(1)},${e.position.z.toFixed(1)} hp ${(bot.health ?? 0).toFixed(1)}`, p);
	await sleep(650); // sword cooldown
	await gazeDown(bot);
	return true;
};

/** Sprint ~5 blocks directly away from the cloud (f4 dragon-2 died to breath at 39 s, standing still). */
const dodge = async (bot: Bot, from: Vec3): Promise<void> => {
	const p = bot.entity.position;
	const dx = p.x - from.x || 1;
	const dz = p.z - from.z || 1;
	const n = Math.hypot(dx, dz);
	try {
		await bot.look(Math.atan2(-dx, -dz), GAZE_DOWN / 2, true);
	} catch {}
	bot.setControlState("forward", true);
	bot.setControlState("sprint", true);
	await sleep(1200);
	bot.setControlState("forward", false);
	bot.setControlState("sprint", false);
	await gazeDown(bot);
	logEvent("end", "breath_dodge", `cloud ${from.x.toFixed(1)},${from.z.toFixed(1)} → ${bot.entity.position.x.toFixed(1)},${bot.entity.position.z.toFixed(1)} hp ${(bot.health ?? 0).toFixed(1)}`, bot.entity.position);
};

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
	// The harness teleports the bot into the End; the client inventory view is reset on
	// the dimension change (d1-1: "out of beds after 0" with 6 beds given). Resync first.
	try {
		await (bot as Bot & { resyncInventory?: () => Promise<void> }).resyncInventory?.();
	} catch {}
	await sleep(1000);
	logEvent("end", "dragon_start", `beds ${windowItems(bot.inventory).filter((i) => i.name.endsWith("_bed")).reduce((a, i) => a + i.count, 0)} obsidian ${windowItems(bot.inventory).filter((i) => i.name === "obsidian").reduce((a, i) => a + i.count, 0)} dim ${String(bot.game?.dimension ?? "?")}`, bot.entity.position);
	const t0 = Date.now();
	let beds = 0;
	let gone = 0;
	// A death ends the attempt (f4 dragon: after a death the loop kept running in the
	// overworld, where "no dragon in view" read as a win).
	let died = false;
	const onDeath = () => {
		died = true;
	};
	bot.once("death", onDeath);
	const dead = (): StepResult => ({ success: false, message: `died after ${beds} bed(s) at ${Math.round((Date.now() - t0) / 1000)} s` });
	setPhase("dragon_wait");
	try {
		while (Date.now() - t0 < budgetMs) {
			if (died || (bot.health ?? 20) <= 0 || !inEnd(bot)) return dead();
			await gazeDown(bot);
			if (await fendEnderman(bot)) continue;
			if ((bot.health ?? 20) < 10) await eat(bot);
			const cloud = breathNear(bot);
			if (cloud) await dodge(bot, cloud);
			const dragon = dragonOf(bot);
			if (!dragon) {
				// Not tracked: out of entity range, or dead. Twenty quiet checks in a row → let the
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
				await bot.lookAt(vec3(p.x + d.x * 4 + 0.5, p.y, p.z + d.z * 4 + 0.5), true);
			} catch {}
			const placed = await placeOn(bot, "bed", foot);
			const hp0 = bot.health ?? 0;
			if (!placed) {
				logEvent("end", "bed_place_fail", `foot ${foot.x},${foot.y},${foot.z} floor=${blockName(bot, vec3(foot.x, foot.y - 1, foot.z))} held=${bot.heldItem?.name ?? "none"} slot=${bot.quickBarSlot} bot=${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`, p);
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
	} finally {
		bot.removeListener("death", onDeath);
	}
};
