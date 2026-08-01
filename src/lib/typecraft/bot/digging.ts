/**
 * Block mining — dig, stopDigging, canDigBlock, digTime.
 */

import { getEnchants } from "../item/index.ts";
import { length, subtract, type Vec3, vec3 } from "../vec3/index.ts";
import { PLAYER_EYE_HEIGHT, raycast } from "../world/index.ts";
import type { Block, Bot, BotOptions, Task } from "./types.ts";
import { createTask, nextSequence } from "./utils.ts";

// ── Tool speed lookup (fallback when registry.materials is empty) ──

const TOOL_TIERS: Record<string, number> = {
	wooden: 2.0,
	stone: 4.0,
	iron: 6.0,
	golden: 12.0,
	diamond: 8.0,
	netherite: 9.0,
};

const PICKAXE_BLOCKS = new Set([
	"stone",
	"cobblestone",
	"deepslate",
	"cobbled_deepslate",
	"andesite",
	"diorite",
	"granite",
	"netherrack",
	"basalt",
	"blackstone",
	"end_stone",
	"sandstone",
	"red_sandstone",
	"obsidian",
	"crying_obsidian",
	"coal_ore",
	"iron_ore",
	"gold_ore",
	"diamond_ore",
	"emerald_ore",
	"lapis_ore",
	"redstone_ore",
	"copper_ore",
	"nether_gold_ore",
	"nether_quartz_ore",
	"ancient_debris",
	"deepslate_coal_ore",
	"deepslate_iron_ore",
	"deepslate_gold_ore",
	"deepslate_diamond_ore",
	"deepslate_emerald_ore",
	"deepslate_lapis_ore",
	"deepslate_redstone_ore",
	"deepslate_copper_ore",
	"tuff",
	"calcite",
	"dripstone_block",
	"pointed_dripstone",
	"amethyst_block",
	"budding_amethyst",
	"smooth_stone",
	"bricks",
	"mossy_cobblestone",
	"stone_bricks",
	"mossy_stone_bricks",
	"prismarine",
	"dark_prismarine",
	"purpur_block",
	"purpur_pillar",
	"terracotta",
	"ice",
	"packed_ice",
	"blue_ice",
	"iron_block",
	"gold_block",
	"diamond_block",
	"emerald_block",
	"lapis_block",
	"redstone_block",
	"copper_block",
	"raw_iron_block",
	"raw_gold_block",
	"raw_copper_block",
	"netherite_block",
	"furnace",
	"blast_furnace",
	"smoker",
	"stonecutter",
	"grindstone",
	"brewing_stand",
	"cauldron",
	"hopper",
	"anvil",
	"chipped_anvil",
	"damaged_anvil",
	"chain",
	"lantern",
	"soul_lantern",
	"rail",
	"powered_rail",
	"detector_rail",
	"activator_rail",
]);

const AXE_BLOCKS = new Set([
	"oak_log",
	"spruce_log",
	"birch_log",
	"jungle_log",
	"acacia_log",
	"dark_oak_log",
	"mangrove_log",
	"cherry_log",
	"pale_oak_log",
	"crimson_stem",
	"warped_stem",
	"oak_planks",
	"spruce_planks",
	"birch_planks",
	"jungle_planks",
	"acacia_planks",
	"dark_oak_planks",
	"mangrove_planks",
	"cherry_planks",
	"pale_oak_planks",
	"crimson_planks",
	"warped_planks",
	"bamboo_planks",
	"crafting_table",
	"chest",
	"trapped_chest",
	"barrel",
	"bookshelf",
	"note_block",
	"jukebox",
	"fence",
	"oak_fence",
	"spruce_fence",
	"birch_fence",
	"jungle_fence",
	"ladder",
	"scaffolding",
]);

const SHOVEL_BLOCKS = new Set([
	"dirt",
	"grass_block",
	"sand",
	"red_sand",
	"gravel",
	"clay",
	"soul_sand",
	"soul_soil",
	"mycelium",
	"podzol",
	"farmland",
	"dirt_path",
	"snow",
	"snow_block",
	"mud",
	"muddy_mangrove_roots",
]);

const getToolSpeed = (toolName: string, blockName?: string): number => {
	if (!blockName) return 1.0;

	// Parse tool tier and type from name: "wooden_pickaxe" → tier="wooden", type="pickaxe"
	const parts = toolName.split("_");
	if (parts.length < 2) return 1.0;
	const tier = parts[0]!;
	const toolType = parts.slice(1).join("_");
	const tierSpeed = TOOL_TIERS[tier];
	if (!tierSpeed) return 1.0;

	// Check if tool type matches block
	const cleanBlock = blockName.replace("stripped_", "").replace("waxed_", "");
	if (
		toolType === "pickaxe" &&
		(PICKAXE_BLOCKS.has(cleanBlock) ||
			cleanBlock.includes("ore") ||
			cleanBlock.includes("stone") ||
			cleanBlock.includes("brick"))
	)
		return tierSpeed;
	if (
		toolType === "axe" &&
		(AXE_BLOCKS.has(cleanBlock) ||
			cleanBlock.includes("log") ||
			cleanBlock.includes("planks") ||
			cleanBlock.includes("wood"))
	)
		return tierSpeed;
	if (
		toolType === "shovel" &&
		(SHOVEL_BLOCKS.has(cleanBlock) ||
			cleanBlock.includes("dirt") ||
			cleanBlock.includes("sand"))
	)
		return tierSpeed;
	if (
		toolType === "hoe" &&
		(cleanBlock.includes("leaves") ||
			cleanBlock === "hay_block" ||
			cleanBlock === "sponge" ||
			cleanBlock === "wet_sponge")
	)
		return tierSpeed;
	if (toolType === "sword" && cleanBlock === "cobweb") return 15.0;
	if (
		toolType === "shears" &&
		(cleanBlock.includes("wool") || cleanBlock.includes("leaves"))
	)
		return 5.0;

	return 1.0;
};

export const initDigging = (bot: Bot, _options: BotOptions): void => {
	let digging = false;
	let digTask: Task<void> | null = null;
	let swingInterval: ReturnType<typeof setInterval> | null = null;
	let digGeneration = 0; // increments each dig — stale timeouts are ignored

	bot.dig = async (
		block: Block,
		forceLook?: boolean | "ignore",
		digFace?: unknown,
	): Promise<void> => {
		if (!block || !bot.registry) return;

		const blockObj = block as Block;
		const pos = blockObj.position;
		if (!pos) return;

		const time = bot.digTime(block);
		if (time === Infinity)
			throw new Error(`dig time for ${blockObj.name} is Infinity`);

		// Determine face
		let face = 1; // default top

		if (forceLook !== "ignore") {
			const faceVec = digFace as Vec3 | "raycast" | "auto" | undefined;

			if (faceVec && typeof faceVec === "object" && "x" in faceVec) {
				// Explicit Vec3 face direction
				const v = faceVec as Vec3;
				if (v.x)
					face = v.x > 0 ? 5 : 4; // EAST : WEST
				else if (v.y)
					face = v.y > 0 ? 1 : 0; // TOP : BOTTOM
				else if (v.z) face = v.z > 0 ? 3 : 2; // SOUTH : NORTH

				await bot.lookAt(
					vec3(
						pos.x + 0.5 + v.x * 0.5,
						pos.y + 0.5 + v.y * 0.5,
						pos.z + 0.5 + v.z * 0.5,
					),
					forceLook === true,
				);
			} else if (faceVec === "raycast" && bot.world) {
				// Raycast face detection
				const eyePos = vec3(
					bot.entity.position.x,
					bot.entity.position.y + PLAYER_EYE_HEIGHT,
					bot.entity.position.z,
				);
				const dx = bot.entity.position.x - (pos.x + 0.5);
				const dy = bot.entity.position.y + PLAYER_EYE_HEIGHT - (pos.y + 0.5);
				const dz = bot.entity.position.z - (pos.z + 0.5);

				// Check visible faces based on player position relative to block
				const visibleFaces = {
					y: Math.sign(Math.abs(dy) > 0.5 ? dy : 0),
					x: Math.sign(Math.abs(dx) > 0.5 ? dx : 0),
					z: Math.sign(Math.abs(dz) > 0.5 ? dz : 0),
				};

				let bestFace: { face: number; target: Vec3 } | null = null;
				let bestDist = Infinity;

				for (const axis of ["y", "x", "z"] as const) {
					const sign = visibleFaces[axis];
					if (!sign) continue;

					const targetPos = vec3(
						pos.x + 0.5 + (axis === "x" ? sign * 0.5 : 0),
						pos.y + 0.5 + (axis === "y" ? sign * 0.5 : 0),
						pos.z + 0.5 + (axis === "z" ? sign * 0.5 : 0),
					);

					const rayDir = vec3(
						targetPos.x - eyePos.x,
						targetPos.y - eyePos.y,
						targetPos.z - eyePos.z,
					);
					const rayLen = Math.sqrt(
						rayDir.x * rayDir.x + rayDir.y * rayDir.y + rayDir.z * rayDir.z,
					);
					if (rayLen === 0) continue;

					const normDir = vec3(
						rayDir.x / rayLen,
						rayDir.y / rayLen,
						rayDir.z / rayLen,
					);
					const hit = raycast(bot.world, eyePos, normDir, 5);

					if (
						hit &&
						hit.position.x === pos.x &&
						hit.position.y === pos.y &&
						hit.position.z === pos.z
					) {
						const dist = rayLen;
						if (dist < bestDist) {
							bestDist = dist;
							bestFace = { face: hit.face, target: hit.intersect };
						}
					}
				}

				if (bestFace) {
					face = bestFace.face;
					await bot.lookAt(bestFace.target, forceLook === true);
				} else {
					// Fallback: look at block center
					await bot.lookAt(
						vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5),
						forceLook === true,
					);
				}
			} else {
				// Default: look at block center
				await bot.lookAt(
					vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5),
					forceLook === true,
				);
			}
		}

		// Cancel current dig if any
		if (digging) bot.stopDigging();

		digging = true;
		bot.targetDigBlock = block as never;
		const thisGen = ++digGeneration;

		// Lock look at block center for the entire dig
		bot.lockLook(vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5));

		const seq = nextSequence();
		bot.emit("debug", "dig", {
			event: "start",
			pos: { x: pos.x, y: pos.y, z: pos.z },
			face,
			seq,
			time,
			held: bot.heldItem?.name ?? null,
			quickBar: bot.quickBarSlot,
		});

		bot.client.write("player_action", {
			status: 0,
			location: { x: pos.x, y: pos.y, z: pos.z },
			face,
			sequence: seq,
		});

		bot.swingArm();
		swingInterval = setInterval(() => bot.swingArm(), 350);

		if (time === 0) {
			finishDig(pos, face);
			return;
		}

		digTask = createTask<void>();

		// Primary: send status=2 after calculated dig time
		const digTimeout = setTimeout(() => {
			if (digging && digGeneration === thisGen) finishDig(pos, face);
		}, time);

		// Bonus: if blockUpdate fires (e.g., another player broke it, or server
		// sends it to the digger in some versions), complete early
		const onBlockUpdate = (
			updatePos: unknown,
			_oldStateId: unknown,
			newStateId: unknown,
		) => {
			if (digGeneration !== thisGen) return;
			const p = updatePos as Vec3;
			if (!p || p.x !== pos.x || p.y !== pos.y || p.z !== pos.z) return;
			if ((newStateId as number) === 0 && digging) {
				clearTimeout(digTimeout);
				finishDig(pos, face);
			}
		};

		// Unused but kept for listener cleanup symmetry
		const onAck = () => {};

		bot.on("blockUpdate", onBlockUpdate);
		bot.client.on("block_changed_ack", onAck);

		try {
			await digTask.promise;
		} finally {
			clearTimeout(digTimeout);
			bot.removeListener("blockUpdate", onBlockUpdate);
			bot.client.removeListener("block_changed_ack", onAck);
		}
	};

	const finishDig = (pos: Vec3, face: number) => {
		if (!digging) return;
		digging = false;
		bot.unlockLook();
		if (swingInterval) {
			clearInterval(swingInterval);
			swingInterval = null;
		}

		const finishSeq = nextSequence();
		bot.emit("debug", "dig", {
			event: "finish",
			pos: { x: pos.x, y: pos.y, z: pos.z },
			face,
			seq: finishSeq,
		});

		bot.client.write("player_action", {
			status: 2,
			location: { x: pos.x, y: pos.y, z: pos.z },
			face,
			sequence: finishSeq,
		});

		const block = bot.targetDigBlock;
		bot.targetDigBlock = null;
		bot.lastDigTime = Date.now();

		if (block) {
			bot.emit("diggingCompleted", block);
		}

		// Resolve the dig promise
		if (digTask) {
			digTask.finish(undefined as never);
			digTask = null;
		}
	};

	bot.stopDigging = () => {
		if (!digging) return;
		bot.emit("debug", "dig", {
			event: "stop",
			stack: new Error().stack?.split("\n").slice(1, 4).join(" ← "),
		});
		digging = false;
		bot.unlockLook();

		if (swingInterval) {
			clearInterval(swingInterval);
			swingInterval = null;
		}

		const block = bot.targetDigBlock;
		bot.targetDigBlock = null;

		bot.client.write("player_action", {
			status: 1,
			location: { x: 0, y: 0, z: 0 },
			face: 0,
			sequence: nextSequence(),
		});

		if (digTask) {
			digTask.cancel(new Error("Digging aborted"));
			digTask = null;
		}

		if (block) {
			bot.emit("diggingAborted", block);
		}
	};

	bot.canDigBlock = (block: unknown): boolean => {
		if (!block) return false;
		const blockObj = block as {
			position: Vec3;
			diggable?: boolean;
			name?: string;
		};
		if (blockObj.diggable === false) return false;
		if (!blockObj.position) return false;

		// Check registry for diggable status
		if (blockObj.name && bot.registry) {
			const def = bot.registry.blocksByName.get(blockObj.name);
			if (def && def.diggable === false) return false;
		}

		const dist = length(subtract(blockObj.position, bot.entity.position));
		return dist <= 6;
	};

	bot.digTime = (block: unknown): number => {
		if (bot.game.gameMode === "creative") return 0;

		const blockObj = block as {
			hardness?: number;
			name?: string;
			stateId?: number;
		};
		const registry = bot.registry;

		// Get hardness from block object, or look up from registry
		let hardness: number | undefined = blockObj.hardness;
		const blockDef =
			blockObj.name && registry
				? registry.blocksByName.get(blockObj.name)
				: null;
		if (hardness == null && blockDef?.hardness != null) {
			hardness = blockDef.hardness;
		}
		if (hardness == null || hardness < 0) return Infinity;
		if (hardness === 0) return 0;

		if (!registry) return Math.ceil(hardness * 1500);

		let speed = 1.0;
		let canHarvest = !blockDef?.harvestTools; // If no harvestTools, any tool can harvest

		// Check held tool against block's material speeds
		const heldItem = bot.heldItem;
		if (heldItem && blockDef?.material) {
			const materialSpeeds = registry.materials[blockDef.material];
			if (materialSpeeds) {
				const toolSpeed = materialSpeeds[heldItem.type];
				if (toolSpeed) {
					speed = toolSpeed;
				}
			}
			if (blockDef.harvestTools?.[heldItem.type]) {
				canHarvest = true;
			}
		}

		// Fallback: derive tool speed from item/block names when materials data is missing
		if (speed === 1.0 && heldItem) {
			const toolSpeed = getToolSpeed(heldItem.name, blockDef?.name);
			if (toolSpeed > 1.0) {
				speed = toolSpeed;
				canHarvest = true;
			}
		}

		// Efficiency enchantment
		if (heldItem && registry) {
			const enchants = getEnchants(registry, heldItem);
			const efficiency = enchants.find((e) => e.name === "efficiency");
			if (efficiency) {
				speed += efficiency.level * efficiency.level + 1;
			}
		}

		// Haste effect (id 2)
		const haste = bot.entity.effects.get(2);
		if (haste) {
			speed *= 1 + (haste.amplifier + 1) * 0.2;
		}

		// Mining Fatigue effect (id 3)
		const fatigue = bot.entity.effects.get(3);
		if (fatigue) {
			speed *= 0.3 ** (fatigue.amplifier + 1);
		}

		// Underwater penalty (unless Aqua Affinity helmet)
		if (bot.entity.isInWater) {
			let hasAquaAffinity = false;
			// Helmet is slot 5 in inventory
			const helmet = bot.inventory?.slots[5];
			if (helmet && registry) {
				const enchants = getEnchants(registry, helmet);
				hasAquaAffinity = enchants.some((e) => e.name === "aqua_affinity");
			}
			if (!hasAquaAffinity) {
				speed *= 0.2;
			}
		}

		// Not on ground penalty
		if (!bot.entity.onGround) {
			speed *= 0.2;
		}

		// Calculate damage per tick
		const damage = speed / hardness / (canHarvest ? 30 : 100);

		// Instant break check
		if (damage >= 1) return 0;

		// Calculate ticks and convert to ms
		const ticks = Math.ceil(1 / damage);
		return ticks * 50;
	};

	// ── Item collection ──

	bot.collectDrops = async (
		range = 6,
		timeout = 5000,
		navigate?: (pos: Vec3) => Promise<void>,
	): Promise<number> => {
		const startTime = Date.now();
		let collected = 0;
		const itemEntityType = bot.registry?.entitiesByName.get("item")?.id;

		while (Date.now() - startTime < timeout) {
			// Find nearest item entity
			let nearest: { id: number; pos: Vec3 } | null = null;
			let nearestDist = Infinity;
			for (const entity of Object.values(bot.entities)) {
				if (entity.id === bot.entity?.id) continue;
				if (itemEntityType != null && entity.entityType !== itemEntityType)
					continue;
				const dx = entity.position.x - bot.entity.position.x;
				const dy = entity.position.y - bot.entity.position.y;
				const dz = entity.position.z - bot.entity.position.z;
				const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (dist > range) continue;
				if (dist < nearestDist) {
					nearestDist = dist;
					nearest = { id: entity.id, pos: entity.position };
				}
			}

			if (!nearest) {
				bot.emit("debug", "collect", {
					event: "no_items",
					entityCount: Object.keys(bot.entities).length,
					itemType: itemEntityType,
				});
				break;
			}

			bot.emit("debug", "collect", {
				event: "found",
				itemId: nearest.id,
				itemPos: {
					x: nearest.pos.x.toFixed(1),
					y: nearest.pos.y.toFixed(1),
					z: nearest.pos.z.toFixed(1),
				},
				botPos: {
					x: bot.entity.position.x.toFixed(1),
					y: bot.entity.position.y.toFixed(1),
					z: bot.entity.position.z.toFixed(1),
				},
				dist: nearestDist.toFixed(1),
				hasNavigate: !!navigate,
			});

			// Navigate to the block the item is sitting on
			const targetBlock = vec3(
				Math.floor(nearest.pos.x),
				Math.floor(nearest.pos.y),
				Math.floor(nearest.pos.z),
			);

			try {
				if (navigate) {
					await Promise.race([
						navigate(targetBlock),
						new Promise<void>((_, reject) =>
							setTimeout(() => reject(new Error("navigate timeout")), 5000),
						),
					]);
				} else {
					await bot.lookAt(
						vec3(nearest.pos.x, bot.entity.position.y + 1.6, nearest.pos.z),
					);
					bot.setControlState("forward", true);
					await new Promise((r) => setTimeout(r, 1500));
					bot.setControlState("forward", false);
				}
			} catch {
				// Navigation failed — try fallback below
			}

			// If bot is above the item (mined hole below), walk toward it to fall in
			const dy = bot.entity.position.y - nearest.pos.y;
			const dxz = Math.sqrt(
				(bot.entity.position.x - nearest.pos.x) ** 2 +
					(bot.entity.position.z - nearest.pos.z) ** 2,
			);
			if (dy > 0.5 && dxz < 1.5) {
				// Bot is above item — walk toward the item's XZ to fall into the hole
				await bot.lookAt(vec3(nearest.pos.x, nearest.pos.y, nearest.pos.z));
				bot.setControlState("forward", true);
				for (let t = 0; t < 20; t++) {
					await new Promise((r) => setTimeout(r, 100));
					if (!bot.entities[nearest.id]) break; // picked up
					if (Math.abs(bot.entity.position.y - nearest.pos.y) < 0.5) break; // fell down
				}
				bot.setControlState("forward", false);
			}

			// Wait for server to process pickup
			await new Promise((r) => setTimeout(r, 300));
			if (!bot.entities[nearest.id]) {
				collected++;
				continue;
			}

			// Still there — try waiting a bit more
			await new Promise((r) => setTimeout(r, 500));
			if (!bot.entities[nearest.id]) {
				collected++;
			}
		}

		bot.setControlState("forward", false);
		return collected;
	};

	// Stop digging on death
	bot.on("death", () => {
		if (digging) bot.stopDigging();
	});
};
