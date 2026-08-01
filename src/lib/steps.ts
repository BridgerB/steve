// The 30-step Ender-Dragon speedrun chain, mirrored from steve/src/steps.ts
// (names + order) and the icon map in the original /private/tmp/steve-dash.mjs.
// Kept as a flat list here rather than importing across packages — it's stable.

export const STEPS = [
	'Gather Wood', 'Craft Planks', 'Craft Crafting Table', 'Craft Sticks',
	'Craft Wooden Pickaxe', 'Mine Cobblestone', 'Craft Stone Pickaxe',
	'Craft Stone Sword', 'Craft Furnace', 'Mine Coal', 'Mine Iron Ore',
	'Smelt Iron', 'Craft Iron Pickaxe', 'Craft Buckets', 'Fill Water Buckets',
	'Gather Food', 'Get Flint and Steel', 'Build Nether Portal', 'Enter Nether',
	'Find Nether Fortress', 'Kill Blazes', 'Hunt Endermen', 'Return to Overworld',
	'Craft Eyes of Ender', 'Find Stronghold', 'Activate End Portal',
	'Craft Bow and Arrows', 'Enter The End', 'Destroy End Crystals',
	'Kill Ender Dragon'
] as const;

// Minecraft item/block icon (relative to ICON_BASE) for each step.
export const ICON = [
	'block/oak_log', 'block/oak_planks', 'block/crafting_table_front', 'item/stick',
	'item/wooden_pickaxe', 'block/cobblestone', 'item/stone_pickaxe', 'item/stone_sword',
	'block/furnace_front', 'item/coal', 'item/raw_iron', 'item/iron_ingot',
	'item/iron_pickaxe', 'item/bucket', 'item/water_bucket', 'item/cooked_beef',
	'item/flint_and_steel', 'block/obsidian', 'block/netherrack', 'block/nether_bricks',
	'item/blaze_rod', 'item/ender_pearl', 'block/grass_block_side', 'item/ender_eye',
	'block/end_stone_bricks', 'block/end_portal_frame_top', 'item/bow', 'block/end_stone',
	'item/end_crystal', 'block/dragon_egg'
] as const;

export const ICON_BASE =
	'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.21.1/assets/minecraft/textures';

export const STEP_IDX = new Map(STEPS.map((n, i) => [n as string, i]));
export const GOAL = STEP_IDX.get('Enter Nether')!; // 18
export const IRON = STEP_IDX.get('Mine Iron Ore')!; // 10
