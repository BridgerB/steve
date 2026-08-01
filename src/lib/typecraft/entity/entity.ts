/**
 * Entity module — functions for creating and managing Minecraft entities.
 * Replaces prismarine-entity with a functional API.
 */

import type { Item } from "../item/types.ts";
import type { Registry } from "../registry/types.ts";
import { ZERO } from "../vec3/index.ts";
import type { Effect, Entity, EntityType } from "./types.ts";

// ── Construction ──

/** Create an entity with default values. */
export const createEntity = (id: number): Entity => ({
	id,
	type: "other",
	uuid: null,
	username: null,
	name: null,
	displayName: null,
	entityType: null,
	kind: null,
	position: { ...ZERO },
	velocity: { ...ZERO },
	yaw: 0,
	pitch: 0,
	onGround: true,
	height: 0,
	width: 0,
	equipment: new Array(6).fill(null),
	metadata: [],
	effects: new Map(),
	attributes: {},
	vehicle: null,
	passengers: [],
	health: 20,
	food: 20,
	foodSaturation: 5,
	isInWater: false,
	elytraFlying: false,
	isValid: true,
	count: null,
	_fixedX: 0,
	_fixedY: 0,
	_fixedZ: 0,
});

// ── Initialization ──

/** Initialize entity fields from the registry entity definition. */
export const initEntity = (
	entity: Entity,
	registry: Registry,
	entityTypeId: number,
): void => {
	const def = registry.entitiesById.get(entityTypeId);
	if (!def) return;

	entity.entityType = entityTypeId;
	entity.name = def.name;
	entity.displayName = def.displayName;
	entity.height = def.height;
	entity.width = def.width;
	entity.kind = def.category;
	entity.type = def.type as EntityType;
};

// ── Equipment ──

/** Set an equipment slot. */
export const setEquipment = (
	entity: Entity,
	slot: number,
	item: Item | null,
): void => {
	entity.equipment[slot] = item;
};

/** Get the held item (main hand, slot 0). */
export const getHeldItem = (entity: Entity): Item | null =>
	entity.equipment[0] ?? null;

/** Get the offhand item (slot 1, 1.9+). */
export const getOffhandItem = (entity: Entity): Item | null =>
	entity.equipment[1] ?? null;

/** Get armor slots as an array (boots, leggings, chestplate, helmet). */
export const getArmor = (entity: Entity): (Item | null)[] =>
	entity.equipment.slice(2);

// ── Effects ──

/** Add or update a potion effect. */
export const addEffect = (entity: Entity, effect: Effect): void => {
	entity.effects.set(effect.id, effect);
};

/** Remove a potion effect by ID. */
export const removeEffect = (entity: Entity, effectId: number): void => {
	entity.effects.delete(effectId);
};

/** Remove all potion effects. */
export const clearEffects = (entity: Entity): void => {
	entity.effects.clear();
};

// ── Vehicle / passengers ──

/** Set the vehicle this entity is riding. */
export const setVehicle = (entity: Entity, vehicle: Entity | null): void => {
	entity.vehicle = vehicle;
};

/** Add a passenger riding this entity. */
export const addPassenger = (entity: Entity, passenger: Entity): void => {
	entity.passengers.push(passenger);
};

/** Remove a passenger by entity ID. */
export const removePassenger = (entity: Entity, passengerId: number): void => {
	entity.passengers = entity.passengers.filter((p) => p.id !== passengerId);
};

// ── Validity ──

/** Check if an entity is still valid. */
export const entityValid = (entity: Entity): boolean => entity.isValid;

/** Mark an entity as invalid (despawned/removed). */
export const invalidateEntity = (entity: Entity): void => {
	entity.isValid = false;
};
