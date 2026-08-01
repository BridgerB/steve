/**
 * Game state initialization — game mode, difficulty, dimension, brand.
 * Handles login, respawn, game_state_change, difficulty, and brand packets.
 */

import type { NbtTag } from "../nbt/index.ts";
import { simplifyNbt } from "../nbt/index.ts";
import {
	stringDeserializer,
	stringSerializer,
} from "../protocol/pluginChannels.ts";
import type { Bot, BotOptions, Difficulty, GameMode } from "./types.ts";

const DIFFICULTY_NAMES: readonly Difficulty[] = [
	"peaceful",
	"easy",
	"normal",
	"hard",
];
const GAME_MODES: readonly GameMode[] = [
	"survival",
	"creative",
	"adventure",
	"spectator",
];

const DIMENSION_NAMES: Record<string, string> = {
	"-1": "the_nether",
	"0": "overworld",
	"1": "the_end",
};

const parseGameMode = (bits: number): GameMode =>
	bits < 0 || bits > 0b11 ? "survival" : GAME_MODES[bits & 0b11]!;

export const initGame = (bot: Bot, options: BotOptions): void => {
	bot.game = {
		levelType: "default",
		gameMode: "survival",
		hardcore: false,
		dimension: "overworld",
		difficulty: "normal",
		maxPlayers: 0,
		serverBrand: "",
		minY: 0,
		height: 256,
	};

	// Dimension type registry — populated during configuration state
	type DimensionInfo = { height: number; minY: number };
	const dimensionTypes: DimensionInfo[] = [];

	bot.client.on("registry_data", (packet: Record<string, unknown>) => {
		const id = packet.id as string;
		if (id !== "minecraft:dimension_type") return;

		const entries = packet.entries as
			| Array<{ key: string; value: unknown }>
			| undefined;
		if (!entries) return;

		dimensionTypes.length = 0;
		for (const entry of entries) {
			if (!entry.value) {
				dimensionTypes.push({ height: 256, minY: 0 });
				continue;
			}
			const simplified = simplifyNbt(entry.value as NbtTag) as Record<
				string,
				unknown
			>;
			dimensionTypes.push({
				height: (simplified.height as number) ?? 256,
				minY: (simplified.min_y as number) ?? 0,
			});
		}
	});

	const applyDimensionHeight = (dimensionId: number | string) => {
		const idx = typeof dimensionId === "number" ? dimensionId : 0;
		const info = dimensionTypes[idx];
		if (info) {
			bot.game.minY = info.minY;
			bot.game.height = info.height;
		}
	};

	const handleRespawnData = (packet: Record<string, unknown>) => {
		bot.game.levelType =
			(packet.levelType as string) ?? (packet.isFlat ? "flat" : "default");
		bot.game.hardcore =
			(packet.isHardcore as boolean) ??
			Boolean((packet.gameMode as number) & 0b100);

		if (bot.supportFeature("spawnRespawnWorldDataField")) {
			bot.game.gameMode = packet.gamemode as GameMode;
		} else {
			bot.game.gameMode = parseGameMode(
				(packet.gamemode ?? packet.gameMode) as number,
			);
		}

		// Dimension resolution (version-dependent)
		if (bot.supportFeature("dimensionIsAnInt")) {
			bot.game.dimension =
				DIMENSION_NAMES[String(packet.dimension)] ?? "overworld";
		} else if (
			bot.supportFeature("dimensionIsAString") ||
			bot.supportFeature("segmentedRegistryCodecData")
		) {
			const dim = packet.dimension ?? packet.worldName;
			bot.game.dimension =
				typeof dim === "string"
					? dim.replace("minecraft:", "")
					: String(dim ?? "overworld");
		} else if (bot.supportFeature("dimensionIsAWorld")) {
			const wn = packet.worldName;
			bot.game.dimension =
				typeof wn === "string"
					? wn.replace("minecraft:", "")
					: String(wn ?? "overworld");
		}

		// World height — resolve from dimension registry
		const dim = packet.dimension ?? packet.dimensionId;
		if (dim != null) {
			applyDimensionHeight(dim as number | string);
		}

		if (packet.difficulty != null) {
			bot.game.difficulty =
				DIFFICULTY_NAMES[packet.difficulty as number] ?? "normal";
		}
	};

	// Login packet
	bot.client.on("login", (packet: Record<string, unknown>) => {
		handleRespawnData((packet.worldState as Record<string, unknown>) ?? packet);
		bot.game.maxPlayers = (packet.maxPlayers as number) ?? 0;
		bot.emit("login");
		bot.emit("game");

		// Send brand via plugin channel
		const brand = options.brand ?? "vanilla";
		const brandChannel = bot.supportFeature("customChannelMCPrefixed")
			? "minecraft:brand"
			: "MC|Brand";
		bot.client.registerChannel(
			brandChannel,
			stringSerializer,
			stringDeserializer,
		);
		bot.client.writeChannel(brandChannel, brand);

		// 1.21.4+ (protocol 769+) requires player_loaded acknowledgement
		if (bot.protocolVersion >= 769) {
			bot.client.write("player_loaded", {});
		}
	});

	// Respawn packet
	bot.client.on("respawn", (packet: Record<string, unknown>) => {
		handleRespawnData((packet.worldState as Record<string, unknown>) ?? packet);
		bot.emit("game");
	});

	// Game state change
	bot.client.on("game_event", (packet: Record<string, unknown>) => {
		const reason = packet.reason as number | string;

		// Win game — send respawn
		if ((reason === 4 || reason === "win_game") && packet.gameMode === 1) {
			bot.client.write("client_command", { action: 0 });
		}

		// Game mode change
		if (reason === 3 || reason === "change_game_mode") {
			bot.game.gameMode = parseGameMode(packet.gameMode as number);
			bot.emit("game");
		}
	});

	// Difficulty
	bot.client.on("change_difficulty", (packet: Record<string, unknown>) => {
		bot.game.difficulty =
			DIFFICULTY_NAMES[packet.difficulty as number] ?? "normal";
	});

	// Ping (anti-cheat compatibility)
	bot.client.on("ping", (packet: Record<string, unknown>) => {
		bot.client.write("pong", { id: packet.id });
	});
};
