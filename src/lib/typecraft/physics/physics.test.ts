import { describe, expect, it } from "vitest";
import { createEntity } from "../entity/entity.ts";
import { createRegistry } from "../registry/registry.ts";
import {
	cloneAABB,
	computeOffsetX,
	computeOffsetY,
	computeOffsetZ,
	contractAABB,
	createAABB,
	extendAABB,
	intersectsAABB,
	offsetAABB,
} from "./aabb.ts";
import {
	addAttributeModifier,
	createAttributeValue,
	deleteAttributeModifier,
	getAttributeValue,
	hasAttributeModifier,
} from "./attribute.ts";
import {
	applyPlayerState,
	createPhysics,
	createPlayerState,
} from "./physics.ts";
import type { PhysicsBlock, PhysicsWorld, PlayerControls } from "./types.ts";

const registry = createRegistry("1.20.4");

// ── Helpers ──

const NO_CONTROLS: PlayerControls = {
	forward: false,
	back: false,
	left: false,
	right: false,
	jump: false,
	sprint: false,
	sneak: false,
};

/** A stone block (full cube collision). */
const stoneBlock: PhysicsBlock = {
	id: 1,
	name: "stone",
	stateId: 1,
	shapes: [[0, 0, 0, 1, 1, 1]],
	boundingBox: "block",
	properties: {},
};

/** An air block (no collision). */
const airBlock: PhysicsBlock = {
	id: 0,
	name: "air",
	stateId: 0,
	shapes: [],
	boundingBox: "empty",
	properties: {},
};

/** Fake world: stone below groundLevel, air above. */
const createFakeWorld = (groundLevel: number): PhysicsWorld => ({
	getBlock: (pos) =>
		pos.y < groundLevel ? { ...stoneBlock } : { ...airBlock },
});

// ── AABB tests ──

describe("AABB", () => {
	it("creates with correct values", () => {
		const bb = createAABB(1, 2, 3, 4, 5, 6);
		expect(bb).toEqual({
			minX: 1,
			minY: 2,
			minZ: 3,
			maxX: 4,
			maxY: 5,
			maxZ: 6,
		});
	});

	it("clones independently", () => {
		const bb = createAABB(0, 0, 0, 1, 1, 1);
		const copy = cloneAABB(bb);
		copy.minX = 99;
		expect(bb.minX).toBe(0);
	});

	it("offsets in place", () => {
		const bb = createAABB(0, 0, 0, 1, 1, 1);
		offsetAABB(bb, 2, 3, 4);
		expect(bb).toEqual({
			minX: 2,
			minY: 3,
			minZ: 4,
			maxX: 3,
			maxY: 4,
			maxZ: 5,
		});
	});

	it("extends positive direction", () => {
		const bb = createAABB(0, 0, 0, 1, 1, 1);
		extendAABB(bb, 2, 0, 0);
		expect(bb.maxX).toBe(3);
		expect(bb.minX).toBe(0);
	});

	it("extends negative direction", () => {
		const bb = createAABB(0, 0, 0, 1, 1, 1);
		extendAABB(bb, -2, 0, 0);
		expect(bb.minX).toBe(-2);
		expect(bb.maxX).toBe(1);
	});

	it("contracts symmetrically", () => {
		const bb = createAABB(0, 0, 0, 4, 4, 4);
		contractAABB(bb, 1, 1, 1);
		expect(bb).toEqual({
			minX: 1,
			minY: 1,
			minZ: 1,
			maxX: 3,
			maxY: 3,
			maxZ: 3,
		});
	});

	it("computes Y offset for downward collision", () => {
		const floor = createAABB(0, 0, 0, 1, 1, 1);
		const player = createAABB(0.25, 1.5, 0.25, 0.75, 3.3, 0.75);
		const clamped = computeOffsetY(floor, player, -2);
		expect(clamped).toBeCloseTo(-0.5, 10);
	});

	it("computes X offset when not overlapping on Y", () => {
		const wall = createAABB(2, 0, 0, 3, 2, 1);
		const player = createAABB(0, 3, 0, 1, 5, 1);
		// player is above wall — no clamping
		const result = computeOffsetX(wall, player, 5);
		expect(result).toBe(5);
	});

	it("computes X offset when overlapping on Y/Z", () => {
		const wall = createAABB(2, 0, 0, 3, 2, 1);
		const player = createAABB(0, 0.5, 0.25, 1, 2.3, 0.75);
		const result = computeOffsetX(wall, player, 5);
		expect(result).toBeCloseTo(1, 10); // wall.minX - player.maxX = 2 - 1 = 1
	});

	it("computes Z offset correctly", () => {
		const wall = createAABB(0, 0, 3, 1, 2, 4);
		const player = createAABB(0.25, 0.5, 0, 0.75, 2.3, 1);
		const result = computeOffsetZ(wall, player, 5);
		expect(result).toBeCloseTo(2, 10); // wall.minZ - player.maxZ = 3 - 1 = 2
	});

	it("detects intersections", () => {
		const a = createAABB(0, 0, 0, 2, 2, 2);
		const b = createAABB(1, 1, 1, 3, 3, 3);
		expect(intersectsAABB(a, b)).toBe(true);
	});

	it("detects non-intersections", () => {
		const a = createAABB(0, 0, 0, 1, 1, 1);
		const b = createAABB(2, 2, 2, 3, 3, 3);
		expect(intersectsAABB(a, b)).toBe(false);
	});
});

// ── Attribute tests ──

describe("Attribute", () => {
	it("returns base value with no modifiers", () => {
		const attr = createAttributeValue(10);
		expect(getAttributeValue(attr)).toBe(10);
	});

	it("applies operation 0 (add to base)", () => {
		let attr = createAttributeValue(10);
		attr = addAttributeModifier(attr, {
			uuid: "a",
			amount: 5,
			operation: 0,
		});
		expect(getAttributeValue(attr)).toBe(15);
	});

	it("applies operation 1 (multiply base)", () => {
		let attr = createAttributeValue(10);
		attr = addAttributeModifier(attr, {
			uuid: "a",
			amount: 0.5,
			operation: 1,
		});
		expect(getAttributeValue(attr)).toBe(15); // 10 + 10 * 0.5
	});

	it("applies operation 2 (multiply total)", () => {
		let attr = createAttributeValue(10);
		attr = addAttributeModifier(attr, {
			uuid: "a",
			amount: 1,
			operation: 2,
		});
		expect(getAttributeValue(attr)).toBe(20); // 10 + 10 * 1
	});

	it("combines all operations in order", () => {
		let attr = createAttributeValue(10);
		attr = addAttributeModifier(attr, {
			uuid: "a",
			amount: 2,
			operation: 0,
		});
		attr = addAttributeModifier(attr, {
			uuid: "b",
			amount: 0.5,
			operation: 1,
		});
		attr = addAttributeModifier(attr, {
			uuid: "c",
			amount: 0.25,
			operation: 2,
		});
		// base after op0: 10 + 2 = 12
		// after op1: 12 + 12 * 0.5 = 18
		// after op2: 18 + 18 * 0.25 = 22.5
		expect(getAttributeValue(attr)).toBe(22.5);
	});

	it("adds and deletes modifiers", () => {
		let attr = createAttributeValue(10);
		attr = addAttributeModifier(attr, {
			uuid: "x",
			amount: 5,
			operation: 0,
		});
		expect(hasAttributeModifier(attr, "x")).toBe(true);
		expect(hasAttributeModifier(attr, "y")).toBe(false);

		attr = deleteAttributeModifier(attr, "x");
		expect(hasAttributeModifier(attr, "x")).toBe(false);
		expect(getAttributeValue(attr)).toBe(10);
	});
});

// ── Physics simulation tests ──

describe("Physics simulation", () => {
	const physics = createPhysics(registry);

	it("has a config with expected defaults", () => {
		expect(physics.config.gravity).toBeCloseTo(0.08, 5);
		expect(physics.config.playerHeight).toBeCloseTo(1.8, 5);
		expect(physics.config.playerHalfWidth).toBeCloseTo(0.3, 5);
		expect(physics.config.stepHeight).toBeCloseTo(0.6, 5);
	});

	it("gravity: player falls to ground", () => {
		const world = createFakeWorld(60);
		const entity = createEntity(1);
		entity.position = { x: 0.5, y: 80, z: 0.5 };
		entity.velocity = { x: 0, y: 0, z: 0 };
		entity.onGround = false;

		let state = createPlayerState(registry, entity, NO_CONTROLS);

		let ticks = 0;
		while (!state.onGround && ticks < 300) {
			state = physics.simulatePlayer(state, world);
			ticks++;
		}

		expect(state.onGround).toBe(true);
		expect(state.pos.y).toBeCloseTo(60, 0);
		expect(ticks).toBeLessThan(300);
	});

	it("gravity: applies results back to entity", () => {
		const world = createFakeWorld(60);
		const entity = createEntity(1);
		entity.position = { x: 0.5, y: 80, z: 0.5 };
		entity.velocity = { x: 0, y: 0, z: 0 };
		entity.onGround = false;

		let state = createPlayerState(registry, entity, NO_CONTROLS);

		while (!state.onGround) {
			state = physics.simulatePlayer(state, world);
		}

		applyPlayerState(state, entity);

		expect(entity.onGround).toBe(true);
		expect(entity.position.y).toBeCloseTo(60, 0);
	});

	it("jump: sets positive y velocity", () => {
		const world = createFakeWorld(60);
		const entity = createEntity(1);
		entity.position = { x: 0.5, y: 60, z: 0.5 };
		entity.velocity = { x: 0, y: 0, z: 0 };
		entity.onGround = true;

		const jumpControls: PlayerControls = { ...NO_CONTROLS, jump: true };
		let state = createPlayerState(registry, entity, jumpControls);
		state.onGround = true;

		state = physics.simulatePlayer(state, world);

		expect(state.vel.y).toBeGreaterThan(0);
	});

	it("jump: lands back at ground level", () => {
		const world = createFakeWorld(60);
		const entity = createEntity(1);
		entity.position = { x: 0.5, y: 60, z: 0.5 };
		entity.velocity = { x: 0, y: 0, z: 0 };
		entity.onGround = true;

		const jumpControls: PlayerControls = { ...NO_CONTROLS, jump: true };
		let state = createPlayerState(registry, entity, jumpControls);
		state.onGround = true;

		// First tick: jump
		state = physics.simulatePlayer(state, world);
		expect(state.vel.y).toBeGreaterThan(0);

		// Subsequent ticks: fall back down (no more jump input)
		const noJumpState = { ...state, control: NO_CONTROLS };
		let s = noJumpState;
		let ticks = 0;
		while (!s.onGround && ticks < 60) {
			s = physics.simulatePlayer(s, world);
			ticks++;
		}

		expect(s.onGround).toBe(true);
		expect(s.pos.y).toBeCloseTo(60, 0);
	});

	it("walking: forward sprint produces displacement", () => {
		const world = createFakeWorld(60);
		const entity = createEntity(1);
		entity.position = { x: 0.5, y: 60, z: 0.5 };
		entity.velocity = { x: 0, y: 0, z: 0 };
		entity.onGround = true;
		entity.yaw = 0; // facing -z

		const sprintControls: PlayerControls = {
			...NO_CONTROLS,
			forward: true,
			sprint: true,
		};
		let state = createPlayerState(registry, entity, sprintControls);
		state.onGround = true;

		for (let i = 0; i < 10; i++) {
			state = physics.simulatePlayer(state, world);
		}

		// yaw=0 faces -z, so sprinting forward should decrease z
		const distance = Math.sqrt(
			(state.pos.x - 0.5) ** 2 + (state.pos.z - 0.5) ** 2,
		);
		expect(distance).toBeGreaterThan(0.5);
	});

	it("collision: wall stops horizontal movement", () => {
		// Wall at x=5: stone column from y=60 to y=64
		const world: PhysicsWorld = {
			getBlock: (pos) => {
				if (pos.y < 60) return { ...stoneBlock };
				if (pos.x >= 5 && pos.x < 6 && pos.y >= 60 && pos.y < 64)
					return { ...stoneBlock };
				return { ...airBlock };
			},
		};

		const entity = createEntity(1);
		entity.position = { x: 3.5, y: 60, z: 0.5 };
		entity.velocity = { x: 0, y: 0, z: 0 };
		entity.onGround = true;
		entity.yaw = Math.PI / 2; // facing -x... actually let's face +x via yaw = -PI/2

		// yaw in Minecraft: 0 = -z, PI/2 = -x, -PI/2 = +x, PI = +z
		entity.yaw = -Math.PI / 2; // facing +x

		const sprintControls: PlayerControls = {
			...NO_CONTROLS,
			forward: true,
			sprint: true,
		};
		let state = createPlayerState(registry, entity, sprintControls);
		state.onGround = true;

		for (let i = 0; i < 40; i++) {
			state = physics.simulatePlayer(state, world);
		}

		// Should be blocked by wall at x=5, player halfWidth is 0.3, so max x ≈ 4.7
		expect(state.pos.x).toBeLessThan(5);
		expect(state.isCollidedHorizontally).toBe(true);
	});

	it("adjustPositionHeight: snaps down by one block", () => {
		const world = createFakeWorld(60);
		const pos = { x: 0.5, y: 61, z: 0.5 };
		physics.adjustPositionHeight(pos, world);
		expect(pos.y).toBe(60);
	});
});
