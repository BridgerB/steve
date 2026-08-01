import type { ChatMessage } from "../chat/index.ts";
import type { Entity } from "../entity/index.ts";
import type { Vec3 } from "../vec3/index.ts";
import type { Window } from "../window/index.ts";
import type {
	BossBar,
	DisplaySlot,
	Particle,
	Player,
	ScoreBoard,
	Team,
} from "./types.ts";

/**
 * Typed event map for the Bot.
 * Each key maps to the argument tuple for that event's listeners.
 */
export type BotEventMap = {
	// ── Lifecycle ──
	login: [];
	spawn: [];
	respawn: [];
	game: [];
	death: [];
	end: [reason: string];
	kicked: [reason: string, loggedIn: boolean];
	error: [err: Error];
	connect: [];

	// ── Chat ──
	chat: [
		username: string,
		message: string,
		translate: string | null,
		jsonMsg: ChatMessage,
		matches: string[] | null,
	];
	whisper: [
		username: string,
		message: string,
		translate: string | null,
		jsonMsg: ChatMessage,
		matches: string[] | null,
	];
	actionBar: [jsonMsg: ChatMessage];
	message: [jsonMsg: ChatMessage, position: string];
	messagestr: [message: string, position: string, jsonMsg: ChatMessage];
	unmatchedMessage: [stringMsg: string, jsonMsg: ChatMessage];

	// ── Entity lifecycle ──
	entitySpawn: [entity: Entity];
	entityGone: [entity: Entity];
	entityMoved: [entity: Entity];
	entityUpdate: [entity: Entity];
	entityEquip: [entity: Entity];
	entityAttributes: [entity: Entity];

	// ── Entity actions ──
	entitySwingArm: [entity: Entity];
	entityHurt: [entity: Entity, source: Entity | null];
	entityDead: [entity: Entity];
	entityTaming: [entity: Entity];
	entityTamed: [entity: Entity];
	entityShakingOffWater: [entity: Entity];
	entityEatingGrass: [entity: Entity];
	entityHandSwap: [entity: Entity];
	entityWake: [entity: Entity];
	entityEat: [entity: Entity];
	entityCriticalEffect: [entity: Entity];
	entityMagicCriticalEffect: [entity: Entity];
	entityCrouch: [entity: Entity];
	entityUncrouch: [entity: Entity];
	entitySleep: [entity: Entity];
	entityElytraFlew: [entity: Entity];

	// ── Entity relationships ──
	entityAttach: [entity: Entity, vehicle: Entity];
	entityDetach: [entity: Entity, vehicle: Entity];
	itemDrop: [entity: Entity];
	playerCollect: [collector: Entity, collected: Entity];

	// ── Entity effects ──
	entityEffect: [
		entity: Entity,
		effect: { id: number; amplifier: number; duration: number },
	];
	entityEffectEnd: [entity: Entity, effect: { id: number }];

	// ── Players ──
	playerJoined: [player: Player];
	playerUpdated: [player: Player];
	playerLeft: [player: Player];

	// ── Blocks / world ──
	blockUpdate: [oldBlock: unknown, newBlock: unknown];
	blockPlaced: [oldBlock: unknown, newBlock: unknown];
	chunkColumnLoad: [point: Vec3];
	chunkColumnUnload: [point: Vec3];

	// ── Sounds ──
	soundEffectHeard: [
		soundName: string,
		position: Vec3,
		volume: number,
		pitch: number,
	];
	hardcodedSoundEffectHeard: [
		soundId: number,
		soundCategory: number,
		position: Vec3,
		volume: number,
		pitch: number,
	];

	// ── Block events ──
	noteHeard: [
		block: unknown,
		instrument: { id: number; name: string },
		pitch: number,
	];
	pistonMove: [block: unknown, isPulling: number, direction: number];
	chestLidMove: [block: unknown, isOpen: number, block2: unknown];
	blockBreakProgressObserved: [block: unknown, destroyStage: number];
	blockBreakProgressEnd: [block: unknown];

	// ── Movement ──
	move: [position: Vec3];
	forcedMove: [];
	mount: [];
	dismount: [vehicle: Entity];
	physicsTick: [];

	// ── Pathfinder ──
	goal_reached: [goal: unknown];
	goal_updated: [goal: unknown, isDynamic: boolean];
	path_update: [result: unknown];
	path_reset: [reason: string];

	// ── Digging ──
	diggingCompleted: [block: unknown];
	diggingAborted: [block: unknown];

	// ── Windows ──
	windowOpen: [window: Window];
	windowClose: [window: Window];

	// ── Status ──
	health: [];
	breath: [];
	experience: [];
	usedFirework: [];

	// ── Sleeping ──
	sleep: [];
	wake: [];

	// ── Title ──
	title: [text: string, type: "subtitle" | "title"];

	// ── Weather / time ──
	rain: [];
	time: [];
	spawnReset: [];

	// ── Scoreboard ──
	scoreboardCreated: [scoreboard: ScoreBoard];
	scoreboardDeleted: [scoreboard: ScoreBoard];
	scoreboardTitleChanged: [scoreboard: ScoreBoard];
	scoreUpdated: [scoreboard: ScoreBoard, item: number];
	scoreRemoved: [scoreboard: ScoreBoard, item: number];
	scoreboardPosition: [position: DisplaySlot, scoreboard: ScoreBoard];

	// ── Teams ──
	teamCreated: [team: Team];
	teamRemoved: [team: Team];
	teamUpdated: [team: Team];
	teamMemberAdded: [team: Team];
	teamMemberRemoved: [team: Team];

	// ── Boss bar ──
	bossBarCreated: [bossBar: BossBar];
	bossBarDeleted: [bossBar: BossBar];
	bossBarUpdated: [bossBar: BossBar];

	// ── Block vision ──
	blockSeen: [name: string, pos: Vec3];

	// ── Debug ──
	debug: [category: string, detail: Record<string, unknown>];

	// ── Other ──
	resourcePack: [
		url: string,
		hash: string | undefined,
		uuid: string | undefined,
	];
	particle: [particle: Particle];
};
