/**
 * Bot factory — creates a connected Minecraft bot.
 */

import { EventEmitter } from "node:events";
import { createEntity } from "../entity/index.ts";
import { type Client, createClient } from "../protocol/index.ts";
import { createRegistry } from "../registry/index.ts";
import { type Vec3, ZERO } from "../vec3/index.ts";
import { initBlockActions } from "./block_actions.ts";
import { initBlocks } from "./blocks.ts";
import { initChat } from "./chat.ts";
import { initContainers } from "./containers.ts";
import { initCrafting } from "./crafting.ts";
import { initDigging } from "./digging.ts";
import { initEntities } from "./entities.ts";
import { initExtended } from "./extended.ts";
import { initGame } from "./game.ts";
import { initInventory } from "./inventory.ts";
import { initPhysics } from "./physics.ts";
import { initPlacing } from "./placing.ts";
import { initSocial } from "./social.ts";
import { initStatus } from "./status.ts";
import type {
	Bot,
	BotOptions,
	ControlState,
	GameSettings,
	MainHand,
} from "./types.ts";
import { initWorldState } from "./world_state.ts";

/** Create and connect a Minecraft bot. */
export const createBot = (options: BotOptions): Bot => {
	const client: Client =
		(options as unknown as { client?: Client }).client ?? createClient(options);

	const emitter = new EventEmitter();
	const loadedPlugins = new Set<(bot: Bot, options: BotOptions) => void>();

	// Default settings
	const settings: GameSettings = {
		chat: options.chat ?? "enabled",
		colorsEnabled: options.colorsEnabled ?? true,
		viewDistance: options.viewDistance ?? "far",
		difficulty: options.difficulty ?? 2,
		skinParts: options.skinParts ?? {
			showCape: true,
			showJacket: true,
			showLeftSleeve: true,
			showRightSleeve: true,
			showLeftPants: true,
			showRightPants: true,
			showHat: true,
		},
		mainHand: (options.mainHand ?? "right") as MainHand,
	};

	const bot = Object.assign(emitter, {
		// Identity
		client,
		registry: null,
		username: options.username,
		version: options.version,
		majorVersion: "",
		protocolVersion: client.protocolVersion,
		supportFeature: (_f: string) => false,

		// Self
		entity: createEntity(0),
		player: {
			uuid: "",
			username: options.username,
			displayName: null,
			gamemode: 0,
			ping: 0,
			entity: null,
			skinData: null,
		},

		// Game state
		game: {
			levelType: "default",
			gameMode: "survival" as const,
			hardcore: false,
			dimension: "overworld",
			difficulty: "normal" as const,
			maxPlayers: 0,
			serverBrand: "",
			minY: 0,
			height: 256,
		},
		isRaining: false,
		thunderState: 0,
		spawnPoint: { ...ZERO } as Vec3,
		time: {
			doDaylightCycle: true,
			bigTime: 0n,
			time: 0,
			timeOfDay: 0,
			day: 0,
			isDay: true,
			moonPhase: 0,
			bigAge: 0n,
			age: 0,
		},

		// Entities
		entities: {} as Record<number, never>,
		players: {} as Record<string, never>,
		uuidToUsername: {} as Record<string, string>,
		fireworkRocketDuration: 0,

		// World
		world: null,

		// Block vision
		watchBlocks: new Set(),

		// Physics
		physics: null,
		physicsEnabled: options.physicsEnabled ?? true,
		controlState: {
			forward: false,
			back: false,
			left: false,
			right: false,
			jump: false,
			sprint: false,
			sneak: false,
		},

		// Inventory (placeholder — initInventory replaces)
		inventory: null as never,
		currentWindow: null,
		heldItem: null,
		usingHeldItem: false,
		quickBarSlot: 0,

		// Status
		health: 20,
		food: 20,
		foodSaturation: 5,
		oxygenLevel: 20,
		experience: { level: 0, points: 0, progress: 0 },

		// Combat state
		isSleeping: false,
		targetDigBlock: null,
		lastDigTime: 0,

		// Chat
		chatPatterns: [],
		settings,

		// Social
		scoreboards: {},
		scoreboard: {},
		teams: {},
		teamMap: {},
		bossBars: {},
		tablist: { header: null, footer: null },

		// Lifecycle
		end: (reason?: string) => client.end(reason),
		quit: (reason?: string) => client.end(reason ?? "disconnect.quitting"),
		respawn: () => {},

		// Stubs — filled by init functions
		setControlState: (_c: ControlState, _s: boolean) => {},
		getControlState: (_c: ControlState) => false,
		clearControlStates: () => {},
		look: async (_y: number, _p: number, _f?: boolean) => {},
		lookAt: async (_pt: Vec3, _f?: boolean) => {},
		elytraFly: async () => {},
		waitForTicks: async (_n: number) => {},
		chat: (_m: string) => {},
		whisper: (_u: string, _m: string) => {},
		tabComplete: async () => [] as string[],
		chatAddPattern: () => 0,
		addChatPattern: () => 0,
		addChatPatternSet: () => 0,
		removeChatPattern: () => {},
		awaitMessage: async () => "",
		clickWindow: async () => {},
		putSelectedItemRange: async () => {},
		putAway: async () => {},
		closeWindow: () => {},
		transfer: async () => {},
		openBlock: async () => null as never,
		openEntity: async () => null as never,
		moveSlotItem: async () => {},
		setQuickBarSlot: () => {},
		updateHeldItem: () => {},
		activateItem: () => {},
		deactivateItem: () => {},
		consume: async () => {},
		equip: async () => {},
		unequip: async () => {},
		tossStack: async () => {},
		toss: async () => {},
		blockAt: () => null,
		findBlock: () => null,
		findBlocks: () => [],
		canSeeBlock: () => false,
		waitForChunksToLoad: async () => {},
		dig: async () => {},
		stopDigging: () => {},
		canDigBlock: () => false,
		digTime: () => 0,
		placeBlock: async () => {},
		placeBlockWithOptions: async () => {},
		placeEntity: async () => null as never,
		activateBlock: async () => {},
		attack: () => {},
		swingArm: () => {},
		useOn: () => {},
		mount: () => {},
		dismount: () => {},
		moveVehicle: () => {},
		nearestEntity: () => null,
		findPlayer: () => null,
		findPlayers: () => [],
		entityAtCursor: () => null,
		getExplosionDamages: () => 0,
		recipesFor: () => [],
		recipesAll: () => [],
		craft: async () => {},
		sleep: async () => {},
		wake: async () => {},
		fish: async () => {},
		setSettings: () => {},
		blockAtCursor: () => null,
		updateSign: () => {},
		writeBook: async () => {},
		signBook: async () => {},
		acceptResourcePack: () => {},
		denyResourcePack: () => {},
		setCommandBlock: () => {},
		openChest: async () => null as never,
		openFurnace: async () => null as never,
		openAnvil: async () => null as never,
		openEnchantmentTable: async () => null as never,
		openVillager: async () => null as never,
		trade: async () => {},
		loadPlugin: () => {},
		hasPlugin: () => false,
		creative: {
			setInventorySlot: async () => {},
			clearSlot: async () => {},
			clearInventory: async () => {},
			flyTo: async () => {},
			startFlying: () => {},
			stopFlying: () => {},
		},
	}) as unknown as Bot;

	bot.loadPlugin = (plugin: (bot: Bot, options: BotOptions) => void) => {
		if (!loadedPlugins.has(plugin)) {
			loadedPlugins.add(plugin);
			plugin(bot, options);
		}
	};

	bot.hasPlugin = (plugin: (bot: Bot, options: BotOptions) => void): boolean =>
		loadedPlugins.has(plugin);

	// Wire client events to bot
	client.on("error", (err: Error) => {
		if (!options.hideErrors) bot.emit("error", err);
	});
	client.on("end", (reason: string) => bot.emit("end", reason));
	client.on("connect", () => bot.emit("connect"));

	// On login, set registry and version info
	bot.on("login", () => {
		const version = client.version;
		const registry = createRegistry(version);
		bot.registry = registry;
		bot.version = registry.version.minecraftVersion;
		bot.majorVersion = registry.version.majorVersion;
		bot.protocolVersion = registry.version.version;
		bot.supportFeature = (f: string) => !!registry.supportFeature(f);
	});

	// Kick handling
	client.on("disconnect", (packet: Record<string, unknown>) => {
		// Play state disconnect (kick)
		bot.emit("kicked", packet.reason as string, true);
	});
	client.on("login_disconnect", (packet: Record<string, unknown>) => {
		// Login state disconnect
		bot.emit("kicked", packet.reason as string, false);
	});

	// Global packet sniffer — every packet goes to debug events for SQLite capture
	client.on("packet", (_data: unknown, meta: { name: string }) => {
		bot.emit("debug", "packet_rx", { name: meta.name });
	});

	// Initialize all subsystems
	initGame(bot, options);
	initEntities(bot, options);
	initBlocks(bot, options);
	initPhysics(bot, options);
	initStatus(bot, options);
	initInventory(bot, options);
	initChat(bot, options);
	initCrafting(bot, options);
	initDigging(bot, options);
	initPlacing(bot, options);
	initWorldState(bot, options);
	initSocial(bot, options);
	initExtended(bot, options);
	initContainers(bot, options);
	initBlockActions(bot, options);

	return bot;
};
