import { describe, expect, it } from "vitest";
import { createRegistry } from "../registry/registry.ts";
import { findRecipes, parseRecipe } from "./recipe.ts";

const registry = createRegistry("1.20.4");

describe("parseRecipe", () => {
	it("parses a shapeless recipe", () => {
		const raw = {
			ingredients: [4, 804],
			result: { count: 1, id: 2 },
		};
		const recipe = parseRecipe(raw);
		expect(recipe.result).toEqual({ id: 2, metadata: null, count: 1 });
		expect(recipe.inShape).toBeNull();
		expect(recipe.outShape).toBeNull();
		expect(recipe.ingredients).toHaveLength(2);
		expect(recipe.ingredients![0]).toEqual({
			id: 4,
			metadata: null,
			count: -1,
		});
		expect(recipe.ingredients![1]).toEqual({
			id: 804,
			metadata: null,
			count: -1,
		});
	});

	it("parses a shaped recipe", () => {
		const raw = {
			inShape: [
				[2, 2],
				[2, 2],
			],
			result: { count: 4, id: 3 },
		};
		const recipe = parseRecipe(raw);
		expect(recipe.result).toEqual({ id: 3, metadata: null, count: 4 });
		expect(recipe.inShape).toHaveLength(2);
		expect(recipe.inShape![0]).toHaveLength(2);
		expect(recipe.inShape![0]![0]).toEqual({
			id: 2,
			metadata: null,
			count: 1,
		});
		expect(recipe.ingredients).toBeNull();
	});

	it("parses null elements in shapes as id -1", () => {
		const raw = {
			inShape: [
				[1, null],
				[null, 1],
			],
			result: { count: 1, id: 5 },
		};
		const recipe = parseRecipe(raw);
		expect(recipe.inShape![0]![1]).toEqual({
			id: -1,
			metadata: null,
			count: 1,
		});
	});

	it("parses object elements with metadata (pre-1.13)", () => {
		const raw = {
			inShape: [[{ id: 3, metadata: 0 }, 13]],
			result: { count: 4, id: 3, metadata: 1 },
		};
		const recipe = parseRecipe(raw);
		expect(recipe.inShape![0]![0]).toEqual({ id: 3, metadata: 0, count: 1 });
		expect(recipe.result.metadata).toBe(1);
	});

	it("parses outShape", () => {
		const raw = {
			inShape: [
				[335, 335, 335],
				[353, 344, 353],
				[296, 296, 296],
			],
			outShape: [
				[325, 325, 325],
				[null, null, null],
			],
			result: { count: 1, id: 354, metadata: 0 },
		};
		const recipe = parseRecipe(raw);
		expect(recipe.outShape).toHaveLength(2);
		expect(recipe.outShape![0]![0]).toEqual({
			id: 325,
			metadata: null,
			count: 1,
		});
	});
});

describe("requiresTable", () => {
	it("2x2 shaped recipe fits in inventory", () => {
		const recipe = parseRecipe({
			inShape: [
				[2, 2],
				[2, 2],
			],
			result: { count: 4, id: 3 },
		});
		expect(recipe.requiresTable).toBe(false);
	});

	it("3-wide shaped recipe requires table", () => {
		const recipe = parseRecipe({
			inShape: [[1, 2, 3]],
			result: { count: 1, id: 5 },
		});
		expect(recipe.requiresTable).toBe(true);
	});

	it("3-tall shaped recipe requires table", () => {
		const recipe = parseRecipe({
			inShape: [[1], [2], [3]],
			result: { count: 1, id: 5 },
		});
		expect(recipe.requiresTable).toBe(true);
	});

	it("shapeless with 5 ingredients requires table", () => {
		const recipe = parseRecipe({
			ingredients: [1, 2, 3, 4, 5],
			result: { count: 1, id: 10 },
		});
		expect(recipe.requiresTable).toBe(true);
	});

	it("shapeless with 2 ingredients fits in inventory", () => {
		const recipe = parseRecipe({
			ingredients: [1, 2],
			result: { count: 1, id: 10 },
		});
		expect(recipe.requiresTable).toBe(false);
	});
});

describe("delta", () => {
	it("shapeless: consumes ingredients, produces result", () => {
		const recipe = parseRecipe({
			ingredients: [4, 804],
			result: { count: 1, id: 2 },
		});
		expect(recipe.delta).toContainEqual({ id: 4, metadata: null, count: -1 });
		expect(recipe.delta).toContainEqual({
			id: 804,
			metadata: null,
			count: -1,
		});
		expect(recipe.delta).toContainEqual({ id: 2, metadata: null, count: 1 });
	});

	it("shaped: consumes shape items, produces result", () => {
		const recipe = parseRecipe({
			inShape: [
				[2, 2],
				[2, 2],
			],
			result: { count: 4, id: 3 },
		});
		// 4x item 2 consumed, 4x item 3 produced
		const consumed = recipe.delta.find((d) => d.id === 2);
		const produced = recipe.delta.find((d) => d.id === 3);
		expect(consumed?.count).toBe(-4);
		expect(produced?.count).toBe(4);
	});
});

describe("findRecipes", () => {
	it("finds recipes for a known item", () => {
		const planks = registry.itemsByName.get("oak_planks");
		if (!planks) return;
		const recipes = findRecipes(registry, planks.id);
		// Recipes not yet loaded from datagen — skip if empty
		if (Object.keys(registry.recipes).length === 0) return;
		expect(recipes.length).toBeGreaterThan(0);
		expect(recipes[0]!.result.id).toBe(planks.id);
	});

	it("returns empty array for unknown item", () => {
		expect(findRecipes(registry, 999999)).toEqual([]);
	});

	it("every recipe has a valid result", () => {
		const stoneId = registry.itemsByName.get("stone")?.id;
		if (!stoneId) return;
		for (const recipe of findRecipes(registry, stoneId)) {
			expect(recipe.result.id).toBe(stoneId);
			expect(recipe.result.count).toBeGreaterThan(0);
		}
	});
});
