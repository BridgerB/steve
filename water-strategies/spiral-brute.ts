/**
 * spiral-brute — the dumb-but-robust control. No targeting, no digging: hold forward
 * and drive the surface in a lawnmower/widening-spiral pattern until the bot presses
 * into SOME shore ≤1 block above the water, where the wall-collision impulse lifts it
 * onto land.
 *
 * Physics reality (typecraft): NO buoyancy, jump IGNORED in water. The ONLY lift is
 * pressing forward into a solid block with headroom, ~0.3/tick, so climbing a 1-high
 * lip takes only a fraction of a second of SUSTAINED press.
 *
 * Why not a continuous sweep: rotating the heading every couple seconds makes the bot
 * ORBIT a fixed bowl (a closed limit cycle) and it turns away from each bank before the
 * lift stacks. So instead we drive in straight LEGS: hold one heading and press forward;
 * when blocked against a wall, keep pressing briefly (let the impulse try to climb it);
 * if it doesn't lift us, turn and drive a fresh leg. Straight legs translate across the
 * map (a drunkard's walk biased by walls) instead of orbiting, so we actually reach out
 * to shore.
 *
 * Exit: onDryLand, OR solid-below + out-of-water sustained ~1s.
 */
import { getBlock, isOnDryLand } from "../src/lib/steve/lib/bot-utils.ts";
import { vec3 } from "typecraft";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TWO_PI = Math.PI * 2;
const norm = (y: number) => ((y % TWO_PI) + TWO_PI) % TWO_PI;

const solidBelow = (bot: any): boolean => {
	const p = bot.entity?.position;
	if (!p) return false;
	const b = getBlock(bot, vec3(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)));
	if (!b) return false;
	const n = b.name;
	return !n.includes("water") && !n.includes("air") && !n.includes("lily");
};

export const escape = async (bot: any): Promise<void> => {
	const p0 = bot.entity.position;
	const start = { x: p0.x, z: p0.z };

	bot.setControlState("forward", true);
	bot.setControlState("jump", true); // ignored underwater, helps the instant we surface
	bot.setControlState("sprint", true);

	let yaw = bot.entity.yaw ?? 0;
	const applyLook = () => bot.look(norm(yaw), 0.12, true);
	await applyLook();

	// Leg driving. Each leg holds one heading. A leg ends when either it's driven long
	// enough (LEG_MS — keep scanning new ground) or it's been pinned against a wall
	// without climbing out for STUCK_MS (this bank is un-climbable, go elsewhere).
	const LEG_MS = 4500;
	const STUCK_MS = 2200; // pressed a wall this long without rising → turn away
	const MOVE_EPS = 1.4; // blocks/sample below this = "not moving" (blocked)
	const SAMPLE_MS = 900;

	// Turn amounts: a big turn to peel off a wall we couldn't climb, a small step to
	// fan across open water. Golden angle avoids periodic orbits.
	const TURN_STUCK = 2.399963; // ~137.5° — leave the wall, explore a new sector
	const TURN_SCAN = 0.9; // ~52° — sweep onward after an uneventful leg

	// Global anti-stall: if net distance from START hasn't improved past our best for a
	// while, we're trapped in a small region — rotate through fresh sectors. Deterministic
	// large steps (not random) so we methodically try many outward headings within the cap
	// instead of possibly re-committing to the same dead sector.
	let bestDist = 0;
	let bestAt = Date.now();
	const GLOBAL_STALL_MS = 10000;
	let stallTurns = 0;

	let dryStreakAt = 0;
	const DRY_HOLD_MS = 1000;

	let legStart = Date.now();
	let pinnedSince = 0; // when we first went below MOVE_EPS this leg
	let lastSample = Date.now();
	let lastPos = { x: p0.x, z: p0.z };
	let lastLog = 0;

	for (let i = 0; i < 3000; i++) {
		if (isOnDryLand(bot)) break;

		const now = Date.now();
		const p = bot.entity.position;
		const inWater = bot.entity.isInWater;

		if (!inWater && bot.entity.onGround && solidBelow(bot)) {
			if (!dryStreakAt) dryStreakAt = now;
			else if (now - dryStreakAt >= DRY_HOLD_MS) break;
		} else {
			dryStreakAt = 0;
		}

		// Per-sample movement → are we pinned against a wall?
		if (now - lastSample >= SAMPLE_MS) {
			const moved = Math.hypot(p.x - lastPos.x, p.z - lastPos.z);
			if (moved < MOVE_EPS && inWater) {
				if (!pinnedSince) pinnedSince = now;
			} else {
				pinnedSince = 0; // moving freely (or climbed out) — reset
			}
			lastSample = now;
			lastPos = { x: p.x, z: p.z };
		}

		const distFromStart = Math.hypot(p.x - start.x, p.z - start.z);
		if (distFromStart > bestDist + 1) {
			bestDist = distFromStart;
			bestAt = now;
		}

		// Decide whether to end this leg and turn.
		const pinnedTooLong = pinnedSince && now - pinnedSince >= STUCK_MS;
		const legTimedOut = now - legStart >= LEG_MS;
		const globalStall = now - bestAt >= GLOBAL_STALL_MS;

		if (pinnedTooLong || globalStall) {
			if (globalStall) stallTurns++;
			yaw += globalStall ? 2.0 + stallTurns * 0.7 : TURN_STUCK;
			await applyLook();
			console.log(
				`[spiral-brute] turn(${globalStall ? "GLOBAL-STALL" : "wall-stuck"}) → yaw=${norm(yaw).toFixed(2)} x=${Math.round(p.x)} z=${Math.round(p.z)} dxz=${Math.round(distFromStart)}`,
			);
			legStart = now;
			pinnedSince = 0;
			bestAt = now;
			lastPos = { x: p.x, z: p.z };
		} else if (legTimedOut) {
			yaw += TURN_SCAN;
			await applyLook();
			legStart = now;
			pinnedSince = 0;
		}

		if (now - lastLog >= 3000) {
			lastLog = now;
			console.log(
				`[spiral-brute] t=${i} x=${Math.round(p.x)} y=${Math.round(p.y * 10) / 10} z=${Math.round(p.z)} inWater=${inWater} onGround=${bot.entity.onGround} yaw=${norm(yaw).toFixed(2)} dxz=${Math.round(distFromStart)}`,
			);
		}

		await sleep(150);
	}

	bot.clearControlStates();
};

export default escape;
