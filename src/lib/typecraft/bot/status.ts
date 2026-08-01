/**
 * Health, food, XP, oxygen, and player settings.
 * Combines upstream health.js, experience.js, breath.js, settings.js.
 */

import type { Bot, BotOptions, GameSettings } from "./types.ts";

const CHAT_TO_BITS: Record<string, number> = {
	enabled: 0,
	commandsOnly: 1,
	disabled: 2,
};

const HAND_TO_BITS: Record<string, number> = {
	left: 0,
	right: 1,
};

const VIEW_DISTANCE_TO_BITS: Record<string, number> = {
	far: 12,
	normal: 10,
	short: 8,
	tiny: 6,
};

export const initStatus = (bot: Bot, options: BotOptions): void => {
	let isAlive = true;
	let firstHealthUpdate = true;

	// ── Health ──

	bot.client.on("set_health", (packet: Record<string, unknown>) => {
		bot.health = packet.health as number;
		bot.food = packet.food as number;
		bot.foodSaturation = packet.foodSaturation as number;
		bot.emit("health");

		if (firstHealthUpdate) {
			firstHealthUpdate = false;
			if (bot.health > 0) {
				bot.emit("spawn");
			}
		}

		if (bot.health <= 0) {
			if (isAlive) {
				isAlive = false;
				bot.emit("death");
			}
			if (options.respawn !== false) {
				bot.respawn();
			}
		} else if (bot.health > 0 && !isAlive) {
			isAlive = true;
			bot.emit("spawn");
		}
	});

	bot.respawn = () => {
		if (isAlive) return;
		bot.client.write(
			"client_command",
			bot.supportFeature("respawnIsPayload") ? { payload: 0 } : { actionId: 0 },
		);
	};

	bot.client.on("respawn", () => {
		isAlive = false;
		firstHealthUpdate = true;
		bot.emit("respawn");
	});

	// ── Experience ──

	bot.client.on("set_experience", (packet: Record<string, unknown>) => {
		bot.experience = {
			level: packet.level as number,
			points: packet.totalExperience as number,
			progress: packet.experienceBar as number,
		};
		bot.emit("experience");
	});

	// ── Settings ──

	const setSettings = (settings: Partial<GameSettings>) => {
		Object.assign(bot.settings, settings);

		const chatBits = CHAT_TO_BITS[bot.settings.chat] ?? 0;
		const viewDistanceBits =
			typeof bot.settings.viewDistance === "string"
				? (VIEW_DISTANCE_TO_BITS[bot.settings.viewDistance] ?? 10)
				: bot.settings.viewDistance;
		const handBits = HAND_TO_BITS[bot.settings.mainHand] ?? 1;

		const sp = bot.settings.skinParts;
		const skinParts =
			(sp.showCape ? 1 : 0) |
			(sp.showJacket ? 2 : 0) |
			(sp.showLeftSleeve ? 4 : 0) |
			(sp.showRightSleeve ? 8 : 0) |
			(sp.showLeftPants ? 16 : 0) |
			(sp.showRightPants ? 32 : 0) |
			(sp.showHat ? 64 : 0);

		const payload: Record<string, unknown> = {
			// Field names differ between configuration and play states
			// Configuration: locale, chatFlags, skinParts, enableTextFiltering, enableServerListing
			// Play (extracted): language, chatVisibility, modelCustomisation, textFilteringEnabled, allowsListing
			locale: "en_US",
			language: "en_US",
			viewDistance: viewDistanceBits,
			chatFlags: chatBits,
			chatVisibility: chatBits,
			chatColors: bot.settings.colorsEnabled,
			skinParts,
			modelCustomisation: skinParts,
			mainHand: handBits,
			enableTextFiltering: false,
			textFilteringEnabled: false,
			enableServerListing: true,
			allowsListing: true,
		};

		// 1.21.3+ (protocol 768+) requires particleStatus
		if (bot.protocolVersion >= 768) {
			payload.particleStatus = "all";
		}

		bot.client.write("client_information", payload);
	};

	bot.setSettings = setSettings;

	// Send settings on login
	bot.client.on("login", () => {
		setSettings({});
	});
};
