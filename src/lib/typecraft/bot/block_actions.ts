/**
 * Block actions — note blocks, pistons, chest lids, break animation.
 */

import { vec3 } from "../vec3/index.ts";
import type { Bot, BotOptions } from "./types.ts";

export const initBlockActions = (bot: Bot, _options: BotOptions): void => {
	const openCountByPos = new Map<string, number>();

	bot.client.on("block_event", (packet: Record<string, unknown>) => {
		const loc = packet.location as { x: number; y: number; z: number };
		if (!loc) return;

		const pos = vec3(loc.x, loc.y, loc.z);
		const block = bot.blockAt(pos);
		if (!block) return;

		const blockId = packet.blockId as number;
		const byte1 = packet.byte1 as number;
		const byte2 = packet.byte2 as number;

		if (!bot.registry) return;
		const blockDef = bot.registry.blocksById.get(blockId);
		if (!blockDef) return;
		const blockName = blockDef.name;

		if (blockName === "noteblock" || blockName === "note_block") {
			// Note block
			let instrumentId: number;
			let pitch: number;

			if (blockName === "noteblock") {
				// Pre-1.13: instrument from byte1, pitch from byte2
				instrumentId = byte1;
				pitch = byte2;
			} else {
				// 1.13+: derived from block metadata
				const blockObj = block as { metadata?: number };
				const meta = blockObj.metadata ?? 0;
				instrumentId = Math.floor(meta / 50);
				pitch = Math.floor((meta % 50) / 2);
			}

			bot.emit(
				"noteHeard",
				block,
				{ id: instrumentId, name: String(instrumentId) },
				pitch,
			);
		} else if (blockName === "sticky_piston" || blockName === "piston") {
			bot.emit("pistonMove", block, byte1, byte2);
		} else if (
			blockName === "chest" ||
			blockName === "trapped_chest" ||
			blockName === "ender_chest" ||
			blockName === "barrel" ||
			blockName === "shulker_box"
		) {
			const posKey = `${loc.x},${loc.y},${loc.z}`;
			const prevCount = openCountByPos.get(posKey) ?? 0;

			if (prevCount !== byte2) {
				bot.emit("chestLidMove", block, byte2, null);

				if (byte2 > 0) {
					openCountByPos.set(posKey, byte2);
				} else {
					openCountByPos.delete(posKey);
				}
			}
		}
	});

	bot.client.on("block_destruction", (packet: Record<string, unknown>) => {
		const loc = packet.location as { x: number; y: number; z: number };
		if (!loc) return;

		const pos = vec3(loc.x, loc.y, loc.z);
		const block = bot.blockAt(pos);
		const destroyStage = packet.destroyStage as number;

		if (destroyStage < 0 || destroyStage > 9) {
			bot.emit("blockBreakProgressEnd", block);
		} else {
			bot.emit("blockBreakProgressObserved", block, destroyStage);
		}
	});
};
