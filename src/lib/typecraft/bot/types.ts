import type { EventEmitter } from "node:events";
import type { ChatMessage } from "../chat/index.ts";
import type { Entity } from "../entity/index.ts";
import type { Item } from "../item/index.ts";
import type { PhysicsEngine } from "../physics/index.ts";
import type { Client, ClientOptions } from "../protocol/index.ts";
import type { Recipe } from "../recipe/index.ts";
import type { Registry } from "../registry/index.ts";
import type { Vec3 } from "../vec3/index.ts";
import type { Window } from "../window/index.ts";
import type { World } from "../world/index.ts";

// ── Options ──

export type BotOptions = ClientOptions & {
	readonly logErrors?: boolean;
	readonly hideErrors?: boolean;
	readonly physicsEnabled?: boolean;
	readonly maxCatchupTicks?: number;
	readonly chat?: ChatLevel;
	readonly colorsEnabled?: boolean;
	readonly viewDistance?: ViewDistance;
	readonly mainHand?: MainHand;
	readonly difficulty?: number;
	readonly chatLengthLimit?: number;
	readonly brand?: string;
	readonly defaultChatPatterns?: boolean;
	readonly respawn?: boolean;
	readonly skinParts?: SkinParts;
};

export type ChatLevel = "enabled" | "commandsOnly" | "disabled";
export type ViewDistance = "far" | "normal" | "short" | "tiny" | number;
export type MainHand = "left" | "right";

// ── Game state ──

export type GameState = {
	levelType: string;
	gameMode: GameMode;
	hardcore: boolean;
	dimension: string;
	difficulty: Difficulty;
	maxPlayers: number;
	serverBrand: string;
	minY: number;
	height: number;
};

export type GameMode = "survival" | "creative" | "adventure" | "spectator";
export type Difficulty = "peaceful" | "easy" | "normal" | "hard";

// ── Player ──

export type Player = {
	uuid: string;
	username: string;
	displayName: ChatMessage | null;
	gamemode: number;
	ping: number;
	entity: Entity | null;
	skinData: SkinData | null;
};

export type SkinData = {
	readonly url: string;
	readonly model: string | null;
};

// ── Settings ──

export type SkinParts = {
	showCape: boolean;
	showJacket: boolean;
	showLeftSleeve: boolean;
	showRightSleeve: boolean;
	showLeftPants: boolean;
	showRightPants: boolean;
	showHat: boolean;
};

export type GameSettings = {
	chat: ChatLevel;
	colorsEnabled: boolean;
	viewDistance: ViewDistance;
	difficulty: number;
	skinParts: SkinParts;
	mainHand: MainHand;
};

// ── Experience ──

export type Experience = {
	level: number;
	points: number;
	progress: number;
};

// ── Time ──

export type Time = {
	doDaylightCycle: boolean;
	bigTime: bigint;
	time: number;
	timeOfDay: number;
	day: number;
	isDay: boolean;
	moonPhase: number;
	bigAge: bigint;
	age: number;
};

// ── Scoreboard ──

export type ScoreBoard = {
	name: string;
	title: string;
	itemsMap: Record<string, ScoreBoardItem>;
	items: ScoreBoardItem[];
};

export type ScoreBoardItem = {
	name: string;
	displayName: ChatMessage | null;
	value: number;
};

export type DisplaySlot =
	| "list"
	| "sidebar"
	| "belowName"
	| 3
	| 4
	| 5
	| 6
	| 7
	| 8
	| 9
	| 10
	| 11
	| 12
	| 13
	| 14
	| 15
	| 16
	| 17
	| 18;

// ── Team ──

export type Team = {
	team: string;
	name: ChatMessage | null;
	friendlyFire: number;
	nameTagVisibility: string;
	collisionRule: string;
	color: string;
	prefix: ChatMessage | null;
	suffix: ChatMessage | null;
	memberMap: Record<string, string>;
	members: string[];
};

// ── Boss bar ──

export type BossBar = {
	entityUUID: string;
	title: ChatMessage;
	health: number;
	dividers: number;
	color: BossBarColor;
	shouldDarkenSky: boolean;
	isDragonBar: boolean;
	shouldCreateFog: boolean;
};

export type BossBarColor =
	| "pink"
	| "blue"
	| "red"
	| "green"
	| "yellow"
	| "purple"
	| "white";

// ── Tablist ──

export type Tablist = {
	header: ChatMessage | null;
	footer: ChatMessage | null;
};

// ── Chat pattern ──

export type ChatPattern = {
	pattern: RegExp;
	type: string;
	description: string;
};

// ── Control state ──

export type ControlState =
	| "forward"
	| "back"
	| "left"
	| "right"
	| "jump"
	| "sprint"
	| "sneak";

export type ControlStateStatus = {
	forward: boolean;
	back: boolean;
	left: boolean;
	right: boolean;
	jump: boolean;
	sprint: boolean;
	sneak: boolean;
};

// ── Digging ──

export type DigFace = "auto" | Vec3 | "raycast";

// ── Equipment ──

export type EquipmentDestination =
	| "hand"
	| "head"
	| "torso"
	| "legs"
	| "feet"
	| "off-hand";

// ── Transfer ──

export type TransferOptions = {
	readonly window: Window;
	readonly itemType: number;
	readonly metadata: number | null;
	readonly count?: number;
	readonly sourceStart: number;
	readonly sourceEnd: number;
	readonly destStart: number;
	readonly destEnd: number;
};

// ── Block ──

/** A block in the world with position and state. */
export type Block = {
	readonly name: string;
	readonly stateId: number;
	readonly position: Vec3;
	readonly properties: Readonly<Record<string, string>>;
};

// ── Find block ──

export type FindBlockOptions = {
	readonly point?: Vec3;
	readonly matching:
		| number
		| number[]
		| ((name: string, stateId: number) => boolean);
	readonly maxDistance?: number;
	readonly count?: number;
	/** Only return blocks with at least one transparent neighbor AND line-of-sight from bot eye. Default: true */
	readonly exposed?: boolean;
};

// ── Command block ──

export type CommandBlockOptions = {
	readonly mode: number;
	readonly trackOutput: boolean;
	readonly conditional: boolean;
	readonly alwaysActive: boolean;
};

// ── Place block options ──

export type PlaceBlockOptions = {
	readonly half?: "top" | "bottom";
	readonly delta?: Vec3;
	readonly forceLook?: boolean | "ignore";
	readonly offhand?: boolean;
	readonly swingArm?: "left" | "right";
	readonly showHand?: boolean;
};

// ── Particle ──

export type Particle = {
	readonly id: number;
	readonly position: Vec3;
	readonly offset: Vec3;
	readonly count: number;
	readonly movementSpeed: number;
	readonly longDistanceRender: boolean;
};

// ── Villager trade ──

export type VillagerTrade = {
	inputItem1: Item;
	outputItem: Item;
	inputItem2: Item | null;
	hasItem2: boolean;
	tradeDisabled: boolean;
	nbTradeUses: number;
	maximumNbTradeUses: number;
	xp: number;
	specialPrice: number;
	priceMultiplier: number;
	demand: number;
	realPrice: number;
};

// ── Anvil window ──

export type AnvilWindow = Window & {
	combine: (itemOne: Item, itemTwo: Item, name?: string) => Promise<void>;
	rename: (item: Item, name?: string) => Promise<void>;
};

// ── Villager window ──

export type VillagerWindow = Window & {
	trades: VillagerTrade[] | null;
	selectedTrade: VillagerTrade | null;
	trade: (index: number, count?: number) => Promise<void>;
};

// ── Furnace window ──

export type FurnaceWindow = Window & {
	fuel: number | null;
	totalFuel: number | null;
	fuelSeconds: number | null;
	totalFuelSeconds: number | null;
	progress: number | null;
	totalProgress: number | null;
	progressSeconds: number | null;
	totalProgressSeconds: number | null;
	inputItem: () => Item | null;
	fuelItem: () => Item | null;
	outputItem: () => Item | null;
	takeInput: () => Promise<void>;
	takeFuel: () => Promise<void>;
	takeOutput: () => Promise<void>;
	putInput: (
		itemType: number,
		metadata: number | null,
		count: number,
	) => Promise<void>;
	putFuel: (
		itemType: number,
		metadata: number | null,
		count: number,
	) => Promise<void>;
};

// ── Enchantment table window ──

export type EnchantmentOption = {
	level: number;
	expected: { enchant: number; level: number };
};

export type EnchantmentTableWindow = Window & {
	xpseed: number;
	enchantments: EnchantmentOption[];
	enchant: (choice: number) => Promise<Item | null>;
	takeTargetItem: () => Promise<void>;
	putTargetItem: (item: Item) => Promise<void>;
	putLapis: (item: Item) => Promise<void>;
	targetItem: () => Item | null;
};

// ── Task (controllable promise) ──

export type Task<T> = {
	readonly promise: Promise<T>;
	readonly finish: (value: T) => void;
	readonly cancel: (err: Error) => void;
};

// ── Bot ──

export type Bot = EventEmitter & {
	// ── Identity ──
	readonly client: Client;
	registry: Registry | null;
	username: string;
	version: string;
	majorVersion: string;
	protocolVersion: number;
	supportFeature: (feature: string) => boolean;

	// ── Self ──
	entity: Entity;
	player: Player;

	// ── Game state ──
	game: GameState;
	isRaining: boolean;
	thunderState: number;
	spawnPoint: Vec3;
	time: Time;

	// ── Entities ──
	entities: Record<number, Entity>;
	players: Record<string, Player>;
	uuidToUsername: Record<string, string>;
	fireworkRocketDuration: number;

	// ── World ──
	world: World | null;

	// ── Block vision ──
	/** Block names to watch. Exposed instances emit "blockSeen" on chunk load and block_update. */
	watchBlocks: Set<string>;

	// ── Physics ──
	physics: PhysicsEngine | null;
	physicsEnabled: boolean;
	controlState: ControlStateStatus;

	// ── Inventory ──
	inventory: Window;
	currentWindow: Window | null;
	heldItem: Item | null;
	usingHeldItem: boolean;
	quickBarSlot: number;

	// ── Health / status ──
	health: number;
	food: number;
	foodSaturation: number;
	oxygenLevel: number;
	experience: Experience;

	// ── Combat ──
	isSleeping: boolean;
	targetDigBlock: Entity | null;
	lastDigTime: number;

	// ── Chat ──
	chatPatterns: ChatPattern[];
	settings: GameSettings;

	// ── Social ──
	scoreboards: Record<string, ScoreBoard>;
	scoreboard: Record<string, ScoreBoard>;
	teams: Record<string, Team>;
	teamMap: Record<string, Team>;
	bossBars: Record<string, BossBar>;
	tablist: Tablist;

	// ── Methods: Lifecycle ──
	end: (reason?: string) => void;
	quit: (reason?: string) => void;
	respawn: () => void;

	// ── Methods: Movement / look ──
	setControlState: (control: ControlState, state: boolean) => void;
	getControlState: (control: ControlState) => boolean;
	clearControlStates: () => void;
	look: (yaw: number, pitch: number, force?: boolean) => Promise<void>;
	lookAt: (point: Vec3, force?: boolean) => Promise<void>;
	lockLook: (pos: Vec3) => void;
	unlockLook: () => void;
	elytraFly: () => Promise<void>;
	waitForTicks: (ticks: number) => Promise<void>;

	// ── Methods: Chat ──
	chat: (message: string) => void;
	whisper: (username: string, message: string) => void;
	tabComplete: (
		str: string,
		assumeCommand?: boolean,
		sendBlockInSight?: boolean,
		timeout?: number,
	) => Promise<string[]>;
	chatAddPattern: (
		pattern: RegExp,
		chatType: string,
		description?: string,
	) => number;
	addChatPattern: (
		name: string,
		pattern: RegExp,
		options?: { repeat?: boolean; parse?: boolean },
	) => number;
	addChatPatternSet: (
		name: string,
		patterns: RegExp[],
		options?: { repeat?: boolean; parse?: boolean },
	) => number;
	removeChatPattern: (name: string | number) => void;
	awaitMessage: (...args: (string | RegExp | number)[]) => Promise<string>;

	// ── Methods: Inventory ──
	clickWindow: (
		slot: number,
		mouseButton: number,
		mode: number,
	) => Promise<void>;
	putSelectedItemRange: (
		start: number,
		end: number,
		window: Window,
		slot: number,
	) => Promise<void>;
	putAway: (slot: number) => Promise<void>;
	closeWindow: (window: Window) => void;
	transfer: (options: TransferOptions) => Promise<void>;
	openBlock: (
		block: Vec3,
		direction?: Vec3,
		cursorPos?: Vec3,
	) => Promise<Window>;
	openEntity: (entity: Entity) => Promise<Window>;
	moveSlotItem: (sourceSlot: number, destSlot: number) => Promise<void>;
	setQuickBarSlot: (slot: number) => void;
	updateHeldItem: () => void;
	activateItem: (offhand?: boolean) => void;
	deactivateItem: () => void;
	consume: () => Promise<void>;
	equip: (
		item: Item | number,
		destination: EquipmentDestination | null,
	) => Promise<void>;
	unequip: (destination: EquipmentDestination | null) => Promise<void>;
	tossStack: (item: Item) => Promise<void>;
	toss: (
		itemType: number,
		metadata: number | null,
		count: number | null,
	) => Promise<void>;

	// ── Methods: Blocks ──
	blockAt: (point: Vec3, extraInfos?: boolean) => Block | null;
	findBlock: (options: FindBlockOptions) => Block | null;
	findBlocks: (options: FindBlockOptions) => Vec3[];
	canSeeBlock: (block: Vec3) => boolean;
	waitForChunksToLoad: () => Promise<void>;

	// ── Methods: Digging ──
	dig: (
		block: Block,
		forceLook?: boolean | "ignore",
		digFace?: DigFace,
	) => Promise<void>;
	stopDigging: () => void;
	canDigBlock: (block: Block) => boolean;
	digTime: (block: Block) => number;
	collectDrops: (
		range?: number,
		timeout?: number,
		navigate?: (pos: Vec3) => Promise<void>,
	) => Promise<number>;

	// ── Methods: Placing ──
	placeBlock: (referenceBlock: Block, faceVector: Vec3) => Promise<void>;
	placeBlockWithOptions: (
		referenceBlock: Block,
		faceVector: Vec3,
		options?: PlaceBlockOptions,
	) => Promise<void>;
	placeEntity: (referenceBlock: Block, faceVector: Vec3) => Promise<Entity>;
	activateBlock: (
		block: Vec3,
		direction?: Vec3,
		cursorPos?: Vec3,
	) => Promise<void>;

	// ── Methods: Combat ──
	attack: (entity: Entity) => void;
	swingArm: (hand?: "left" | "right", showHand?: boolean) => void;
	useOn: (entity: Entity) => void;
	mount: (entity: Entity) => void;
	dismount: () => void;
	moveVehicle: (left: number, forward: number) => void;
	nearestEntity: (filter?: (entity: Entity) => boolean) => Entity | null;
	findPlayer: (
		filter: string | RegExp | ((player: Player) => boolean),
	) => Entity | null;
	findPlayers: (
		filter: string | RegExp | ((player: Player) => boolean),
	) => Entity[];
	entityAtCursor: (maxDistance?: number) => Entity | null;
	getExplosionDamages: (
		targetEntity: Entity,
		explosionPos: Vec3,
		power: number,
		rawDamages?: boolean,
	) => number;

	// ── Methods: Crafting ──
	recipesFor: (
		itemType: number,
		metadata: number | null,
		minResultCount: number | null,
		craftingTable: boolean | null,
	) => Recipe[];
	recipesAll: (
		itemType: number,
		metadata: number | null,
		craftingTable: boolean | null,
	) => Recipe[];
	craft: (
		recipe: Recipe,
		count?: number,
		craftingTable?: Block | null,
	) => Promise<void>;

	// ── Methods: Extended ──
	sleep: (bedBlock: Vec3) => Promise<void>;
	wake: () => Promise<void>;
	fish: () => Promise<void>;
	setSettings: (options: Partial<GameSettings>) => void;
	blockAtCursor: (maxDistance?: number) => Block | null;
	updateSign: (block: Vec3, text: string, back?: boolean) => void;
	writeBook: (slot: number, pages: string[]) => Promise<void>;
	signBook: (
		slot: number,
		pages: string[],
		title: string,
		author: string,
	) => Promise<void>;
	acceptResourcePack: () => void;
	denyResourcePack: () => void;
	setCommandBlock: (
		pos: Vec3,
		command: string,
		options: CommandBlockOptions,
	) => void;

	// ── Methods: Containers ──
	openChest: (
		chestBlock: Block,
		direction?: Vec3,
		cursorPos?: Vec3,
	) => Promise<Window>;
	openFurnace: (furnaceBlock: Block) => Promise<FurnaceWindow>;
	openAnvil: (anvilBlock: Block) => Promise<AnvilWindow>;
	openEnchantmentTable: (tableBlock: Block) => Promise<EnchantmentTableWindow>;
	openVillager: (villagerEntity: Entity) => Promise<VillagerWindow>;
	trade: (villager: Window, index: number, count?: number) => Promise<void>;

	// ── Methods: Plugins ──
	loadPlugin: (plugin: (bot: Bot, options: BotOptions) => void) => void;
	hasPlugin: (plugin: (bot: Bot, options: BotOptions) => void) => boolean;

	// ── Methods: Creative ──
	creative: {
		setInventorySlot: (slot: number, item: Item | null) => Promise<void>;
		clearSlot: (slot: number) => Promise<void>;
		clearInventory: () => Promise<void>;
		flyTo: (destination: Vec3) => Promise<void>;
		startFlying: () => void;
		stopFlying: () => void;
	};
};
