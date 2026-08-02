/**
 * BASELINE / control — the current production escape, unchanged. Every new idea is
 * measured against this. `escapeWater` returns true when it thinks it's out; the step
 * re-invokes it, so we loop until dry or the lab caps us.
 *
 * This file is also the TEMPLATE: a strategy module default-exports (or exports
 * `escape`) an async `(bot) => Promise<void>`. Inside you have the full typecraft bot:
 *   bot.entity.position / .isInWater / .onGround
 *   bot.setControlState("forward"|"jump"|"sprint"|"back", true/false)
 *   bot.clearControlStates()
 *   await bot.lookAt(vec3(x,y,z), true)
 *   await bot.dig(block, true) ; bot.blockAt(x,y,z) ; bot.findBlock/findBlocks
 *   await bot.placeBlock(refBlock, faceVec)  // needs a held placeable
 *   bot.registry, bot.inventory, bot.setQuickBarSlot
 * Helpers you may import from ../src/lib/steve/lib/bot-utils.ts:
 *   isInWaterTrap, isOnDryLand, getBlock, goTo, getPathfinder, digAt-style patterns
 * Physics reality (typecraft): NO buoyancy, jump is IGNORED in water — the ONLY lift
 * in water is the wall-collision `outOfLiquidImpulse` (~0.3) when you press FORWARD
 * into a solid block with headroom. So you rise by pressing into a bank, or by
 * placing/standing on a block, not by holding jump.
 */
import { escapeWater, isOnDryLand } from "../src/lib/steve/lib/bot-utils.ts";

export const escape = async (bot: any): Promise<void> => {
	for (let i = 0; i < 12; i++) {
		if (isOnDryLand(bot)) return;
		const ok = await escapeWater(bot);
		if (ok && isOnDryLand(bot)) return;
	}
};
