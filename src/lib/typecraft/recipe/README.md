# recipe

Functional replacement for [prismarine-recipe](https://github.com/PrismarineJS/prismarine-recipe). Parses and looks up Minecraft crafting recipes from the registry.

## Usage

```ts
import { createRegistry } from "../registry/index.js";
import { findRecipes, parseRecipe } from "./index.js";

const registry = createRegistry("1.20.4");

// Find all recipes that produce oak planks
const planks = registry.itemsByName.get("oak_planks")!;
const recipes = findRecipes(registry, planks.id);

recipes[0].result;       // { id: 36, metadata: null, count: 4 }
recipes[0].inShape;      // null (shapeless)
recipes[0].ingredients;  // [{ id: 131, metadata: null, count: -1 }]
recipes[0].requiresTable; // false (fits in 2x2)
recipes[0].delta;        // net inventory change
```

## Types

```ts
type RecipeItem = {
  readonly id: number;
  readonly metadata: number | null;
  readonly count: number;
};

type Recipe = {
  readonly result: RecipeItem;
  readonly inShape: readonly (readonly RecipeItem[])[] | null;
  readonly outShape: readonly (readonly RecipeItem[])[] | null;
  readonly ingredients: readonly RecipeItem[] | null;
  readonly delta: readonly RecipeItem[];
  readonly requiresTable: boolean;
};
```

## Functions

| Function | Description |
|----------|-------------|
| `findRecipes(registry, itemId, metadata?)` | Find all recipes producing the given item |
| `parseRecipe(raw)` | Parse a raw recipe from minecraft-data into a Recipe |

## Recipe formats

Minecraft-data stores recipes keyed by result item ID. Each raw recipe has:

- **Shaped**: `inShape` — 2D grid of item IDs (null = empty slot)
- **Shapeless**: `ingredients` — flat array of item IDs
- **Result**: `{ id, count, metadata? }`
- **outShape** (rare, pre-1.13): leftover items like empty buckets

## Computed fields

- **`requiresTable`** — `true` if the recipe needs a 3x3 crafting table (shape wider/taller than 2, or more than 4 ingredients)
- **`delta`** — net inventory change: negative counts for consumed items, positive for produced items
