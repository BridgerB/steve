/**
 * Minecraft crafting recipe parsing and lookup.
 * Replaces prismarine-recipe with a functional API.
 */

import type { RawRecipe, RawRecipeItem, Registry } from "../registry/types.ts";
import type { Recipe, RecipeItem } from "./types.ts";

// ── RecipeItem construction ──

/** Parse a raw recipe element into a RecipeItem. */
const parseItem = (raw: RawRecipeItem): RecipeItem => {
	if (raw === null) return { id: -1, metadata: null, count: 1 };
	if (typeof raw === "number") return { id: raw, metadata: null, count: 1 };
	return {
		id: raw.id,
		metadata: raw.metadata ?? null,
		count: 1,
		choices: raw.choices,
	};
};

const parseShape = (
	shape: readonly (readonly RawRecipeItem[])[],
): readonly (readonly RecipeItem[])[] => shape.map((row) => row.map(parseItem));

const parseIngredients = (
	ingredients: readonly RawRecipeItem[],
): readonly RecipeItem[] =>
	ingredients.map((raw) => ({ ...parseItem(raw), count: -1 }));

// ── Recipe computation ──

/** Whether a recipe requires a 3x3 crafting table (vs 2x2 inventory grid). */
const computeRequiresTable = (recipe: Recipe): boolean => {
	let spaceLeft = 4;
	if (recipe.inShape) {
		if (recipe.inShape.length > 2) return true;
		for (const row of recipe.inShape) {
			if (row.length > 2) return true;
			for (const item of row) {
				if (item.id !== -1) spaceLeft--;
			}
		}
	}
	if (recipe.ingredients) spaceLeft -= recipe.ingredients.length;
	return spaceLeft < 0;
};

/** Compute net inventory delta from crafting this recipe. */
const computeDelta = (recipe: Recipe): readonly RecipeItem[] => {
	const delta: RecipeItem[] = [];

	const add = (item: RecipeItem): void => {
		const existing = delta.find(
			(d) => d.id === item.id && d.metadata === item.metadata,
		);
		if (existing) {
			(existing as { count: number }).count += item.count;
		} else {
			delta.push({ ...item });
		}
	};

	const applyShape = (
		shape: readonly (readonly RecipeItem[])[],
		direction: number,
	): void => {
		for (const row of shape) {
			for (const item of row) {
				if (item.id !== -1) add({ ...item, count: direction });
			}
		}
	};

	if (recipe.inShape) applyShape(recipe.inShape, -1);
	if (recipe.outShape) applyShape(recipe.outShape, 1);
	if (recipe.ingredients) for (const item of recipe.ingredients) add(item);
	add(recipe.result);

	return delta;
};

// ── Public API ──

/** Parse a raw recipe into a Recipe. */
export const parseRecipe = (raw: RawRecipe): Recipe => {
	const result: RecipeItem = {
		id: raw.result.id,
		metadata: raw.result.metadata ?? null,
		count: raw.result.count,
	};
	const inShape = raw.inShape ? parseShape(raw.inShape) : null;
	const outShape = raw.outShape ? parseShape(raw.outShape) : null;
	const ingredients = raw.ingredients
		? parseIngredients(raw.ingredients)
		: null;

	const recipe: Recipe = {
		result,
		inShape,
		outShape,
		ingredients,
		delta: [],
		requiresTable: false,
	};

	return {
		...recipe,
		delta: computeDelta(recipe),
		requiresTable: computeRequiresTable(recipe),
	};
};

/** Find all recipes that produce the given item ID. */
export const findRecipes = (
	registry: Registry,
	itemId: number,
	metadata?: number | null,
): readonly Recipe[] => {
	const rawRecipes = registry.recipes[itemId];
	if (!rawRecipes) return [];

	return rawRecipes
		.filter(
			(raw) =>
				metadata == null ||
				!("metadata" in raw.result) ||
				raw.result.metadata === metadata,
		)
		.map(parseRecipe);
};
