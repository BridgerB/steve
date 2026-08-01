import { describe, expect, it } from "vitest";
import { createItemByName } from "../item/item.ts";
import { createRegistry } from "../registry/registry.ts";
import {
	addEffect,
	addPassenger,
	clearEffects,
	createEntity,
	entityValid,
	getArmor,
	getHeldItem,
	getOffhandItem,
	initEntity,
	invalidateEntity,
	removeEffect,
	removePassenger,
	setEquipment,
	setVehicle,
} from "./entity.ts";

const reg = createRegistry("1.20.4");

// ── Construction ──

describe("createEntity", () => {
	it("creates entity with defaults", () => {
		const entity = createEntity(42);
		expect(entity.id).toBe(42);
		expect(entity.type).toBe("other");
		expect(entity.position).toEqual({ x: 0, y: 0, z: 0 });
		expect(entity.velocity).toEqual({ x: 0, y: 0, z: 0 });
		expect(entity.yaw).toBe(0);
		expect(entity.pitch).toBe(0);
		expect(entity.onGround).toBe(true);
		expect(entity.health).toBe(20);
		expect(entity.food).toBe(20);
		expect(entity.isValid).toBe(true);
		expect(entity.uuid).toBeNull();
		expect(entity.vehicle).toBeNull();
		expect(entity.passengers).toEqual([]);
		expect(entity.equipment.length).toBe(6);
	});
});

// ── Initialization ──

describe("initEntity", () => {
	it("initializes entity from registry definition", () => {
		const entity = createEntity(1);
		const zombie = reg.entitiesByName.get("zombie")!;
		initEntity(entity, reg, zombie.id);

		expect(entity.name).toBe("zombie");
		expect(entity.displayName).toBe("Zombie");
		expect(entity.height).toBe(1.95);
		expect(entity.width).toBe(0.6);
		// Our datagen produces type "monster" (no separate category field)
		expect(entity.type).toBe("monster");
		expect(entity.entityType).toBe(zombie.id);
	});

	it("handles unknown entity type gracefully", () => {
		const entity = createEntity(1);
		initEntity(entity, reg, 99999);
		expect(entity.name).toBeNull();
		expect(entity.entityType).toBeNull();
	});

	it("initializes player entity", () => {
		const entity = createEntity(1);
		const player = reg.entitiesByName.get("player")!;
		initEntity(entity, reg, player.id);

		expect(entity.name).toBe("player");
		// Our datagen classifies player as "misc" (not a separate "player" type)
		expect(entity.type).toBe("misc");
		expect(entity.height).toBe(1.8);
	});
});

// ── Equipment ──

describe("equipment", () => {
	it("sets and gets held item", () => {
		const entity = createEntity(1);
		expect(getHeldItem(entity)).toBeNull();

		const sword = createItemByName(reg, "diamond_sword", 1);
		setEquipment(entity, 0, sword);
		expect(getHeldItem(entity)).toBe(sword);
	});

	it("sets and gets offhand item", () => {
		const entity = createEntity(1);
		const shield = createItemByName(reg, "shield", 1);
		setEquipment(entity, 1, shield);
		expect(getOffhandItem(entity)).toBe(shield);
	});

	it("gets armor slots", () => {
		const entity = createEntity(1);
		const helmet = createItemByName(reg, "diamond_helmet", 1);
		const chestplate = createItemByName(reg, "diamond_chestplate", 1);
		setEquipment(entity, 5, helmet);
		setEquipment(entity, 4, chestplate);

		const armor = getArmor(entity);
		expect(armor.length).toBe(4);
		expect(armor[3]).toBe(helmet);
		expect(armor[2]).toBe(chestplate);
	});
});

// ── Effects ──

describe("effects", () => {
	it("adds and retrieves effects", () => {
		const entity = createEntity(1);
		addEffect(entity, { id: 1, amplifier: 2, duration: 600 });
		addEffect(entity, { id: 3, amplifier: 0, duration: 1200 });

		expect(entity.effects.size).toBe(2);
		expect(entity.effects.get(1)).toEqual({
			id: 1,
			amplifier: 2,
			duration: 600,
		});
	});

	it("updates existing effect", () => {
		const entity = createEntity(1);
		addEffect(entity, { id: 1, amplifier: 0, duration: 600 });
		addEffect(entity, { id: 1, amplifier: 1, duration: 1200 });

		expect(entity.effects.size).toBe(1);
		expect(entity.effects.get(1)!.amplifier).toBe(1);
	});

	it("removes effect by ID", () => {
		const entity = createEntity(1);
		addEffect(entity, { id: 1, amplifier: 0, duration: 600 });
		addEffect(entity, { id: 3, amplifier: 0, duration: 600 });
		removeEffect(entity, 1);

		expect(entity.effects.size).toBe(1);
		expect(entity.effects.has(1)).toBe(false);
	});

	it("clears all effects", () => {
		const entity = createEntity(1);
		addEffect(entity, { id: 1, amplifier: 0, duration: 600 });
		addEffect(entity, { id: 3, amplifier: 0, duration: 600 });
		clearEffects(entity);

		expect(entity.effects.size).toBe(0);
	});
});

// ── Vehicle / passengers ──

describe("vehicle and passengers", () => {
	it("sets and clears vehicle", () => {
		const rider = createEntity(1);
		const horse = createEntity(2);

		setVehicle(rider, horse);
		expect(rider.vehicle).toBe(horse);

		setVehicle(rider, null);
		expect(rider.vehicle).toBeNull();
	});

	it("adds and removes passengers", () => {
		const boat = createEntity(1);
		const player1 = createEntity(2);
		const player2 = createEntity(3);

		addPassenger(boat, player1);
		addPassenger(boat, player2);
		expect(boat.passengers.length).toBe(2);

		removePassenger(boat, 2);
		expect(boat.passengers.length).toBe(1);
		expect(boat.passengers[0]!.id).toBe(3);
	});
});

// ── Validity ──

describe("validity", () => {
	it("entity starts valid", () => {
		const entity = createEntity(1);
		expect(entityValid(entity)).toBe(true);
	});

	it("invalidates entity", () => {
		const entity = createEntity(1);
		invalidateEntity(entity);
		expect(entityValid(entity)).toBe(false);
		expect(entity.isValid).toBe(false);
	});
});

// ── Registry entity data ──

describe("registry entity data", () => {
	it("has entities by ID and name", () => {
		const zombie = reg.entitiesByName.get("zombie");
		expect(zombie).toBeDefined();
		expect(zombie!.displayName).toBe("Zombie");

		const byId = reg.entitiesById.get(zombie!.id);
		expect(byId).toBe(zombie);
	});

	it("has correct entity count", () => {
		expect(reg.entitiesArray.length).toBeGreaterThan(100);
	});

	it("has player entity", () => {
		const player = reg.entitiesByName.get("player");
		expect(player).toBeDefined();
		expect(player!.type).toBe("misc");
	});
});
