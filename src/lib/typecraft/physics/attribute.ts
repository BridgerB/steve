import type { AttributeModifier, AttributeValue } from "./types.ts";

/** Create an attribute value with no modifiers. */
export const createAttributeValue = (base: number): AttributeValue => ({
	value: base,
	modifiers: [],
});

/** Compute the final value: op0 (add to base), op1 (multiply base), op2 (multiply total). */
export const getAttributeValue = (prop: AttributeValue): number => {
	let base = prop.value;
	for (const mod of prop.modifiers) {
		if (mod.operation === 0) base += mod.amount;
	}
	let total = base;
	for (const mod of prop.modifiers) {
		if (mod.operation === 1) total += base * mod.amount;
	}
	for (const mod of prop.modifiers) {
		if (mod.operation === 2) total += total * mod.amount;
	}
	return total;
};

/** Return a new attribute value with the modifier added. */
export const addAttributeModifier = (
	attr: AttributeValue,
	modifier: AttributeModifier,
): AttributeValue => ({
	...attr,
	modifiers: [...attr.modifiers, modifier],
});

/** Return a new attribute value with modifiers matching uuid removed. */
export const deleteAttributeModifier = (
	attr: AttributeValue,
	uuid: string,
): AttributeValue => ({
	...attr,
	modifiers: attr.modifiers.filter((m) => m.uuid !== uuid),
});

/** Check if a modifier with the given uuid exists. */
export const hasAttributeModifier = (
	attr: AttributeValue,
	uuid: string,
): boolean => attr.modifiers.some((m) => m.uuid === uuid);
