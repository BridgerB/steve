import type { Vec3 } from "../vec3/index.ts";

/** Mutable position/velocity used during physics simulation. */
export type MutableVec3 = { x: number; y: number; z: number };

/** Axis-aligned bounding box — mutable for performance during collision resolution. */
export type AABB = {
	minX: number;
	minY: number;
	minZ: number;
	maxX: number;
	maxY: number;
	maxZ: number;
};

/** Player movement controls. */
export type PlayerControls = {
	readonly forward: boolean;
	readonly back: boolean;
	readonly left: boolean;
	readonly right: boolean;
	readonly jump: boolean;
	readonly sprint: boolean;
	readonly sneak: boolean;
};

/** Attribute modifier (operation: 0 = add, 1 = multiply base, 2 = multiply total). */
export type AttributeModifier = {
	readonly uuid: string;
	readonly amount: number;
	readonly operation: 0 | 1 | 2;
};

/** Attribute value with base and modifier list. */
export type AttributeValue = {
	readonly value: number;
	readonly modifiers: readonly AttributeModifier[];
};

/** Server-side attributes keyed by resource string. */
export type AttributeMap = Readonly<Record<string, AttributeValue>>;

/** Mutable player state for physics simulation. */
export type PlayerState = {
	pos: MutableVec3;
	vel: MutableVec3;

	onGround: boolean;
	isInWater: boolean;
	isInLava: boolean;
	isInWeb: boolean;
	isCollidedHorizontally: boolean;
	isCollidedVertically: boolean;

	elytraFlying: boolean;
	fireworkRocketDuration: number;
	riptideTicks: number;

	jumpTicks: number;
	jumpQueued: boolean;

	readonly yaw: number;
	readonly pitch: number;
	readonly control: PlayerControls;
	readonly attributes: AttributeMap | null;

	readonly jumpBoost: number;
	readonly speed: number;
	readonly slowness: number;
	readonly dolphinsGrace: number;
	readonly slowFalling: number;
	readonly levitation: number;

	readonly depthStrider: number;
	readonly soulSpeed: number;
	readonly swiftSneak: number;
	readonly elytraEquipped: boolean;
};

/** Block info as needed by the physics engine. */
export type PhysicsBlock = {
	readonly id: number;
	readonly name: string;
	readonly stateId: number;
	readonly shapes: readonly (readonly number[])[];
	readonly boundingBox: "block" | "empty";
	readonly properties: Readonly<Record<string, string>>;
};

/** World interface for physics — decoupled from our World type. */
export type PhysicsWorld = {
	readonly getBlock: (pos: Vec3) => PhysicsBlock | null;
};

/** Bubble column drag constants. */
export type BubbleDrag = {
	readonly down: number;
	readonly maxDown: number;
	readonly up: number;
	readonly maxUp: number;
};

/** Physics tuning constants. */
export type PhysicsConfig = {
	readonly gravity: number;
	readonly airdrag: number;
	readonly yawSpeed: number;
	readonly pitchSpeed: number;
	readonly playerSpeed: number;
	readonly sprintSpeed: number;
	readonly sneakSpeed: number;
	readonly stepHeight: number;
	readonly negligeableVelocity: number;
	readonly soulsandSpeed: number;
	readonly honeyblockSpeed: number;
	readonly honeyblockJumpSpeed: number;
	readonly ladderMaxSpeed: number;
	readonly ladderClimbSpeed: number;
	readonly playerHalfWidth: number;
	readonly playerHeight: number;
	readonly waterInertia: number;
	readonly lavaInertia: number;
	readonly liquidAcceleration: number;
	readonly airborneInertia: number;
	readonly airborneAcceleration: number;
	readonly defaultSlipperiness: number;
	readonly outOfLiquidImpulse: number;
	readonly autojumpCooldown: number;
	readonly bubbleColumnSurfaceDrag: BubbleDrag;
	readonly bubbleColumnDrag: BubbleDrag;
	readonly slowFalling: number;
	readonly waterGravity: number;
	readonly lavaGravity: number;
	readonly movementSpeedAttribute: string;
	readonly sprintingUUID: string;
};

/** The physics engine returned by createPhysics. */
export type PhysicsEngine = {
	readonly config: PhysicsConfig;
	readonly simulatePlayer: (
		state: PlayerState,
		world: PhysicsWorld,
	) => PlayerState;
	readonly adjustPositionHeight: (
		pos: MutableVec3,
		world: PhysicsWorld,
	) => void;
};
