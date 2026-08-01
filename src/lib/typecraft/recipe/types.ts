/** An item in a recipe (ingredient or result). */
export type RecipeItem = {
	readonly id: number;
	readonly metadata: number | null;
	readonly count: number;
	// Tag ingredients (e.g. #minecraft:planks) accept any of these item IDs.
	// `id` is the representative member; `choices` lists all acceptable IDs.
	readonly choices?: readonly number[];
};

/** A parsed crafting recipe. */
export type Recipe = {
	readonly result: RecipeItem;
	readonly inShape: readonly (readonly RecipeItem[])[] | null;
	readonly outShape: readonly (readonly RecipeItem[])[] | null;
	readonly ingredients: readonly RecipeItem[] | null;
	readonly delta: readonly RecipeItem[];
	readonly requiresTable: boolean;
};
