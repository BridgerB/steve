/**
 * Shared protocol type definitions — ProtoDef schemas for complex Minecraft
 * wire format types. Written from the Java Edition protocol specification.
 *
 * These types are referenced by name in packet definitions (e.g., "Slot",
 * "position", "entityMetadata") and resolved by the codec's type registry.
 *
 * Sources: wiki.vg/Protocol, Minecraft decompiled source (Mojang mappings).
 * Target version: 1.21.11 (protocol 774).
 */

import generatedMappings from "./generated-mappings.json" with { type: "json" };

// biome-ignore format: ProtoDef schemas are data, not code — compact formatting is clearer
type Schema = unknown;

// ── Simple aliases ──

const string: Schema = ["pstring", { countType: "varint" }];
const ByteArray: Schema = ["buffer", { countType: "varint" }];
const optvarint: Schema = "varint"; // 0 = absent at app level
const ContainerID: Schema = "varint";

// ── Vector & position types ──

const vec2f: Schema = [
	"container",
	[
		{ name: "x", type: "f32" },
		{ name: "y", type: "f32" },
	],
];

const vec3f: Schema = [
	"container",
	[
		{ name: "x", type: "f32" },
		{ name: "y", type: "f32" },
		{ name: "z", type: "f32" },
	],
];

const vec3i: Schema = [
	"container",
	[
		{ name: "x", type: "i32" },
		{ name: "y", type: "i32" },
		{ name: "z", type: "i32" },
	],
];

const vec4f: Schema = [
	"container",
	[
		{ name: "x", type: "f32" },
		{ name: "y", type: "f32" },
		{ name: "z", type: "f32" },
		{ name: "w", type: "f32" },
	],
];

const vec3f64: Schema = [
	"container",
	[
		{ name: "x", type: "f64" },
		{ name: "y", type: "f64" },
		{ name: "z", type: "f64" },
	],
];

// Block position: x (26 bits signed) | z (26 bits signed) | y (12 bits signed)
// Packed into a single i64 on the wire.
const position: Schema = [
	"bitfield",
	[
		{ name: "x", size: 26, signed: true },
		{ name: "z", size: 26, signed: true },
		{ name: "y", size: 12, signed: true },
	],
];

const packedChunkPos: Schema = [
	"container",
	[
		{ name: "z", type: "i32" },
		{ name: "x", type: "i32" },
	],
];

// ── Registry types ──

const IDSet: Schema = [
	"registryEntryHolderSet",
	{
		base: { name: "name", type: "string" },
		otherwise: { name: "ids", type: "varint" },
	},
];

// ── Sound ──

const soundSource: Schema = [
	"mapper",
	{
		type: "varint",
		mappings: generatedMappings.soundSource,
	},
];

// ── Item system ──

// Sound event: inline sound definition (name + optional fixed range)
const ItemSoundEvent: Schema = [
	"container",
	[
		{ name: "soundName", type: "string" },
		{ name: "fixedRange", type: ["option", "f32"] },
	],
];

// Registry entry holder for sounds: either a registry ID or inline data
const ItemSoundHolder: Schema = [
	"registryEntryHolder",
	{
		baseName: "soundId",
		otherwise: { name: "data", type: "ItemSoundEvent" },
	},
];

const ItemFireworkExplosion: Schema = [
	"container",
	[
		{
			name: "shape",
			type: [
				"mapper",
				{
					type: "varint",
					mappings: {
						"0": "small_ball",
						"1": "large_ball",
						"2": "star",
						"3": "creeper",
						"4": "burst",
					},
				},
			],
		},
		{ name: "colors", type: ["array", { countType: "varint", type: "i32" }] },
		{
			name: "fadeColors",
			type: ["array", { countType: "varint", type: "i32" }],
		},
		{ name: "hasTrail", type: "bool" },
		{ name: "hasTwinkle", type: "bool" },
	],
];

const ItemEffectDetail: Schema = [
	"container",
	[
		{ name: "amplifier", type: "varint" },
		{ name: "duration", type: "varint" },
		{ name: "ambient", type: "bool" },
		{ name: "showParticles", type: "bool" },
		{ name: "showIcon", type: "bool" },
		{ name: "hiddenEffect", type: ["option", "ItemEffectDetail"] },
	],
];

const ItemPotionEffect: Schema = [
	"container",
	[
		{ name: "id", type: "varint" },
		{ name: "details", type: "ItemEffectDetail" },
	],
];

const ItemBlockProperty: Schema = [
	"container",
	[
		{ name: "name", type: "string" },
		{ name: "isExactMatch", type: "bool" },
		{
			name: "value",
			type: [
				"switch",
				{
					compareTo: "isExactMatch",
					fields: {
						true: ["container", [{ name: "exactValue", type: "string" }]],
						false: [
							"container",
							[
								{ name: "minValue", type: "string" },
								{ name: "maxValue", type: "string" },
							],
						],
					},
				},
			],
		},
	],
];

const ItemBlockPredicate: Schema = [
	"container",
	[
		{
			name: "blockSet",
			type: [
				"option",
				[
					"registryEntryHolderSet",
					{
						base: { name: "name", type: "string" },
						otherwise: { name: "blockIds", type: "varint" },
					},
				],
			],
		},
		{
			name: "properties",
			type: [
				"option",
				["array", { countType: "varint", type: "ItemBlockProperty" }],
			],
		},
		{ name: "nbt", type: "anonOptionalNbt" },
	],
];

const ItemBookPage: Schema = [
	"container",
	[
		{ name: "content", type: "string" },
		{ name: "filteredContent", type: ["option", "string"] },
	],
];

const ItemWrittenBookPage: Schema = [
	"container",
	[
		{ name: "content", type: "anonymousNbt" },
		{ name: "filteredContent", type: "anonOptionalNbt" },
	],
];

const ItemConsumeEffect: Schema = [
	"container",
	[
		{
			name: "type",
			type: [
				"mapper",
				{
					type: "varint",
					mappings: {
						"0": "apply_effects",
						"1": "remove_effects",
						"2": "clear_all_effects",
						"3": "teleport_randomly",
						"4": "play_sound",
					},
				},
			],
		},
		{
			anon: true,
			type: [
				"switch",
				{
					compareTo: "type",
					fields: {
						apply_effects: [
							"container",
							[
								{
									name: "effects",
									type: [
										"array",
										{ countType: "varint", type: "ItemPotionEffect" },
									],
								},
								{ name: "probability", type: "f32" },
							],
						],
						remove_effects: ["container", [{ name: "effects", type: "IDSet" }]],
						clear_all_effects: "void",
						teleport_randomly: [
							"container",
							[{ name: "diameter", type: "f32" }],
						],
						play_sound: [
							"container",
							[{ name: "sound", type: "ItemSoundHolder" }],
						],
					},
				},
			],
		},
	],
];

const ArmorTrimMaterial: Schema = [
	"container",
	[
		{ name: "assetName", type: "string" },
		{ name: "ingredientId", type: "varint" },
		{
			name: "overrideArmorAssets",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "key", type: "string" },
							{ name: "value", type: "string" },
						],
					],
				},
			],
		},
		{ name: "description", type: "anonymousNbt" },
	],
];

const ArmorTrimPattern: Schema = [
	"container",
	[
		{ name: "assetId", type: "string" },
		{ name: "templateItemId", type: "varint" },
		{ name: "description", type: "anonymousNbt" },
		{ name: "decal", type: "bool" },
	],
];

const InstrumentData: Schema = [
	"container",
	[
		{ name: "soundEvent", type: "ItemSoundHolder" },
		{ name: "useDuration", type: "f32" },
		{ name: "range", type: "f32" },
		{ name: "description", type: "anonymousNbt" },
	],
];

const JukeboxSongData: Schema = [
	"container",
	[
		{ name: "soundEvent", type: "ItemSoundHolder" },
		{ name: "description", type: "anonymousNbt" },
		{ name: "lengthInSeconds", type: "f32" },
		{ name: "comparatorOutput", type: "varint" },
	],
];

const BannerPattern: Schema = [
	"container",
	[
		{ name: "assetId", type: "string" },
		{ name: "translationKey", type: "string" },
	],
];

const BannerPatternLayer: Schema = [
	"container",
	[
		{
			name: "pattern",
			type: [
				"registryEntryHolder",
				{
					baseName: "patternId",
					otherwise: { name: "data", type: "BannerPattern" },
				},
			],
		},
		{ name: "colorId", type: "varint" },
	],
];

// SlotComponentType: maps varint IDs to component type names (1.21.11, 104 types)
const SlotComponentType: Schema = [
	"mapper",
	{
		type: "varint",
		mappings: generatedMappings.SlotComponentType,
	},
];

// Enchantment list (shared between enchantments and stored_enchantments)
const enchantmentList = [
	"container",
	[
		{
			name: "enchantments",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "id", type: "varint" },
							{ name: "level", type: "varint" },
						],
					],
				},
			],
		},
		{ name: "showTooltip", type: "bool" },
	],
];

// Can place on / can break predicate list
const predicateList = [
	"container",
	[
		{
			name: "predicates",
			type: ["array", { countType: "varint", type: "ItemBlockPredicate" }],
		},
		{ name: "showTooltip", type: "bool" },
	],
];

// SlotComponent: type ID + type-specific data
const SlotComponent: Schema = [
	"container",
	[
		{ name: "type", type: "SlotComponentType" },
		{
			name: "data",
			type: [
				"switch",
				{
					compareTo: "type",
					fields: {
						custom_data: "anonymousNbt",
						use_effects: [
							"array",
							{ countType: "varint", type: "ItemConsumeEffect" },
						],
						minimum_attack_charge: "f32",
						damage_type: "string",
						max_stack_size: "varint",
						max_damage: "varint",
						damage: "varint",
						unbreakable: "bool",
						custom_name: "anonymousNbt",
						item_name: "anonymousNbt",
						item_model: "string",
						lore: ["array", { countType: "varint", type: "anonOptionalNbt" }],
						rarity: [
							"mapper",
							{
								type: "varint",
								mappings: {
									"0": "common",
									"1": "uncommon",
									"2": "rare",
									"3": "epic",
								},
							},
						],
						enchantments: enchantmentList,
						can_place_on: predicateList,
						can_break: predicateList,
						attribute_modifiers: [
							"container",
							[
								{
									name: "attributes",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "typeId", type: "varint" },
													{ name: "name", type: "string" },
													{ name: "value", type: "f64" },
													{
														name: "operation",
														type: [
															"mapper",
															{
																type: "varint",
																mappings: {
																	"0": "add",
																	"1": "multiply_base",
																	"2": "multiply_total",
																},
															},
														],
													},
													{
														name: "slot",
														type: [
															"mapper",
															{
																type: "varint",
																mappings: {
																	"0": "any",
																	"1": "main_hand",
																	"2": "off_hand",
																	"3": "hand",
																	"4": "feet",
																	"5": "legs",
																	"6": "chest",
																	"7": "head",
																	"8": "armor",
																	"9": "body",
																	"10": "saddle",
																},
															},
														],
													},
												],
											],
										},
									],
								},
								{ name: "showTooltip", type: "bool" },
							],
						],
						custom_model_data: [
							"container",
							[
								{
									name: "floats",
									type: ["array", { countType: "varint", type: "f32" }],
								},
								{
									name: "flags",
									type: ["array", { countType: "varint", type: "bool" }],
								},
								{
									name: "strings",
									type: ["array", { countType: "varint", type: "string" }],
								},
								{
									name: "colors",
									type: ["array", { countType: "varint", type: "i32" }],
								},
							],
						],
						tooltip_display: [
							"container",
							[
								{ name: "hideTooltip", type: "bool" },
								{
									name: "hiddenComponents",
									type: [
										"array",
										{ countType: "varint", type: "SlotComponentType" },
									],
								},
							],
						],
						repair_cost: "varint",
						creative_slot_lock: "void",
						enchantment_glint_override: "bool",
						intangible_projectile: "anonymousNbt",
						food: [
							"container",
							[
								{ name: "nutrition", type: "varint" },
								{ name: "saturationModifier", type: "f32" },
								{ name: "canAlwaysEat", type: "bool" },
							],
						],
						consumable: [
							"container",
							[
								{ name: "consume_seconds", type: "f32" },
								{
									name: "animation",
									type: [
										"mapper",
										{
											type: "varint",
											mappings: {
												"0": "none",
												"1": "eat",
												"2": "drink",
												"3": "block",
												"4": "bow",
												"5": "spear",
												"6": "crossbow",
												"7": "spyglass",
												"8": "toot_horn",
												"9": "brush",
												"10": "bundle",
											},
										},
									],
								},
								{ name: "sound", type: "ItemSoundHolder" },
								{ name: "makes_particles", type: "bool" },
								{
									name: "effects",
									type: [
										"array",
										{ countType: "varint", type: "ItemConsumeEffect" },
									],
								},
							],
						],
						use_remainder: "Slot",
						use_cooldown: [
							"container",
							[
								{ name: "seconds", type: "f32" },
								{ name: "cooldownGroup", type: ["option", "string"] },
							],
						],
						damage_resistant: "string",
						tool: [
							"container",
							[
								{
									name: "rules",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "blocks", type: "IDSet" },
													{ name: "speed", type: ["option", "f32"] },
													{
														name: "correctDropForBlocks",
														type: ["option", "bool"],
													},
												],
											],
										},
									],
								},
								{ name: "defaultMiningSpeed", type: "f32" },
								{ name: "damagePerBlock", type: "varint" },
							],
						],
						weapon: [
							"container",
							[
								{ name: "damagePerAttack", type: "varint" },
								{ name: "canDisableBlocking", type: "bool" },
							],
						],
						attack_range: "f32",
						enchantable: "varint",
						equippable: [
							"container",
							[
								{
									name: "slot",
									type: [
										"mapper",
										{
											type: "varint",
											mappings: {
												"0": "main_hand",
												"1": "off_hand",
												"2": "feet",
												"3": "legs",
												"4": "chest",
												"5": "head",
												"6": "body",
												"7": "saddle",
											},
										},
									],
								},
								{ name: "sound", type: "ItemSoundHolder" },
								{ name: "model", type: ["option", "string"] },
								{ name: "cameraOverlay", type: ["option", "string"] },
								{ name: "allowedEntities", type: ["option", "IDSet"] },
								{ name: "dispensable", type: "bool" },
								{ name: "swappable", type: "bool" },
								{ name: "damageable", type: "bool" },
							],
						],
						repairable: ["container", [{ name: "items", type: "IDSet" }]],
						glider: "void",
						tooltip_style: "string",
						death_protection: [
							"container",
							[
								{
									name: "effects",
									type: [
										"array",
										{ countType: "varint", type: "ItemConsumeEffect" },
									],
								},
							],
						],
						blocks_attacks: [
							"container",
							[
								{ name: "blockDelaySeconds", type: "f32" },
								{ name: "disableCooldownScale", type: "f32" },
								{
									name: "damageReductions",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "horizontalBlockingAngle", type: "f32" },
													{ name: "type", type: "IDSet" },
													{ name: "base", type: "f32" },
													{ name: "factor", type: "f32" },
												],
											],
										},
									],
								},
								{ name: "itemDamage", type: "varint" },
								{ name: "bypassedBy", type: ["option", "IDSet"] },
								{ name: "blockSound", type: ["option", "ItemSoundHolder"] },
								{ name: "disableSound", type: ["option", "ItemSoundHolder"] },
							],
						],
						piercing_weapon: "void",
						kinetic_weapon: "void",
						swing_animation: "varint",
						stored_enchantments: [
							"container",
							[
								{
									name: "enchantments",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "id", type: "varint" },
													{ name: "level", type: "varint" },
												],
											],
										},
									],
								},
								{ name: "showInTooltip", type: "bool" },
							],
						],
						dyed_color: [
							"container",
							[
								{ name: "color", type: "i32" },
								{ name: "showTooltip", type: "bool" },
							],
						],
						map_color: "i32",
						map_id: "varint",
						map_decorations: "anonymousNbt",
						map_post_processing: "varint",
						charged_projectiles: [
							"container",
							[
								{
									name: "projectiles",
									type: ["array", { countType: "varint", type: "Slot" }],
								},
							],
						],
						bundle_contents: [
							"container",
							[
								{
									name: "contents",
									type: ["array", { countType: "varint", type: "Slot" }],
								},
							],
						],
						potion_contents: [
							"container",
							[
								{ name: "potionId", type: ["option", "varint"] },
								{ name: "customColor", type: ["option", "i32"] },
								{
									name: "customEffects",
									type: [
										"array",
										{ countType: "varint", type: "ItemPotionEffect" },
									],
								},
								{ name: "customName", type: ["option", "string"] },
							],
						],
						potion_duration_scale: "f32",
						suspicious_stew_effects: [
							"container",
							[
								{
									name: "effects",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "effect", type: "varint" },
													{ name: "duration", type: "varint" },
												],
											],
										},
									],
								},
							],
						],
						writable_book_content: [
							"container",
							[
								{
									name: "pages",
									type: [
										"array",
										{ countType: "varint", type: "ItemBookPage" },
									],
								},
							],
						],
						written_book_content: [
							"container",
							[
								{ name: "rawTitle", type: "string" },
								{ name: "filteredTitle", type: ["option", "string"] },
								{ name: "author", type: "string" },
								{ name: "generation", type: "varint" },
								{
									name: "pages",
									type: [
										"array",
										{ countType: "varint", type: "ItemWrittenBookPage" },
									],
								},
								{ name: "resolved", type: "bool" },
							],
						],
						trim: [
							"container",
							[
								{
									name: "material",
									type: [
										"registryEntryHolder",
										{
											baseName: "materialId",
											otherwise: { name: "data", type: "ArmorTrimMaterial" },
										},
									],
								},
								{
									name: "pattern",
									type: [
										"registryEntryHolder",
										{
											baseName: "patternId",
											otherwise: { name: "data", type: "ArmorTrimPattern" },
										},
									],
								},
							],
						],
						debug_stick_state: "anonymousNbt",
						entity_data: "anonymousNbt",
						bucket_entity_data: "anonymousNbt",
						block_entity_data: "anonymousNbt",
						instrument: [
							"registryEntryHolder",
							{
								baseName: "instrumentId",
								otherwise: { name: "data", type: "InstrumentData" },
							},
						],
						provides_trim_material: [
							"registryEntryHolder",
							{
								baseName: "materialId",
								otherwise: { name: "data", type: "ArmorTrimMaterial" },
							},
						],
						ominous_bottle_amplifier: "varint",
						jukebox_playable: [
							"container",
							[
								{ name: "hasHolder", type: "bool" },
								{
									name: "song",
									type: [
										"switch",
										{
											compareTo: "hasHolder",
											fields: {
												true: [
													"registryEntryHolder",
													{
														baseName: "songId",
														otherwise: {
															name: "data",
															type: "JukeboxSongData",
														},
													},
												],
												false: "string",
											},
										},
									],
								},
								{ name: "showInTooltip", type: "bool" },
							],
						],
						provides_banner_patterns: "IDSet",
						recipes: "anonymousNbt",
						lodestone_tracker: [
							"container",
							[
								{
									name: "globalPosition",
									type: [
										"option",
										[
											"container",
											[
												{ name: "dimension", type: "string" },
												{ name: "position", type: "position" },
											],
										],
									],
								},
								{ name: "tracked", type: "bool" },
							],
						],
						firework_explosion: "ItemFireworkExplosion",
						fireworks: [
							"container",
							[
								{ name: "flightDuration", type: "varint" },
								{
									name: "explosions",
									type: [
										"array",
										{ countType: "varint", type: "ItemFireworkExplosion" },
									],
								},
							],
						],
						profile: [
							"container",
							[
								{ name: "name", type: ["option", "string"] },
								{ name: "uuid", type: ["option", "UUID"] },
								{
									name: "properties",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "name", type: "string" },
													{ name: "value", type: "string" },
													{ name: "signature", type: ["option", "string"] },
												],
											],
										},
									],
								},
							],
						],
						note_block_sound: "string",
						banner_patterns: [
							"container",
							[
								{
									name: "layers",
									type: [
										"array",
										{ countType: "varint", type: "BannerPatternLayer" },
									],
								},
							],
						],
						base_color: "varint",
						pot_decorations: [
							"container",
							[
								{
									name: "decorations",
									type: ["array", { countType: "varint", type: "varint" }],
								},
							],
						],
						container: [
							"container",
							[
								{
									name: "contents",
									type: ["array", { countType: "varint", type: "Slot" }],
								},
							],
						],
						block_state: [
							"container",
							[
								{
									name: "properties",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "name", type: "string" },
													{ name: "value", type: "string" },
												],
											],
										},
									],
								},
							],
						],
						bees: [
							"container",
							[
								{
									name: "bees",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "nbtData", type: "anonymousNbt" },
													{ name: "ticksInHive", type: "varint" },
													{ name: "minTicksInHive", type: "varint" },
												],
											],
										},
									],
								},
							],
						],
						lock: "anonymousNbt",
						container_loot: "anonymousNbt",
						break_sound: "ItemSoundHolder",
						villager_variant: "varint",
						wolf_variant: "varint",
						wolf_sound_variant: "varint",
						wolf_collar: "varint",
						fox_variant: "varint",
						salmon_size: "varint",
						parrot_variant: "varint",
						tropical_fish_pattern: "varint",
						tropical_fish_base_color: "varint",
						tropical_fish_pattern_color: "varint",
						mooshroom_variant: "varint",
						rabbit_variant: "varint",
						pig_variant: "varint",
						cow_variant: "varint",
						chicken_variant: [
							"container",
							[
								{
									name: "mode",
									type: [
										"mapper",
										{
											type: "u8",
											mappings: { "0": "identifier", "1": "registry_id" },
										},
									],
								},
								{
									name: "value",
									type: [
										"switch",
										{
											compareTo: "mode",
											fields: {
												identifier: "string",
												registry_id: "varint",
											},
										},
									],
								},
							],
						],
						frog_variant: "varint",
						horse_variant: "varint",
						painting_variant: [
							"registryEntryHolder",
							{
								baseName: "variantId",
								otherwise: {
									name: "variantData",
									type: "EntityMetadataPaintingVariant",
								},
							},
						],
						llama_variant: "varint",
						axolotl_variant: "varint",
						cat_variant: "varint",
						cat_collar: "varint",
						sheep_color: "varint",
						shulker_color: "varint",
					},
				},
			],
		},
	],
];

// Slot: item count + conditional item data (1.20.5+ HashedSlot format)
// itemCount=0 means empty slot, otherwise itemId + components follow
const Slot: Schema = [
	"container",
	[
		{ name: "itemCount", type: "varint" },
		{
			anon: true,
			type: [
				"switch",
				{
					compareTo: "itemCount",
					fields: {
						"0": "void",
					},
					default: [
						"container",
						[
							{ name: "itemId", type: "varint" },
							{ name: "addedComponentCount", type: "varint" },
							{ name: "removedComponentCount", type: "varint" },
							{
								name: "components",
								type: [
									"array",
									{ count: "addedComponentCount", type: "SlotComponent" },
								],
							},
							{
								name: "removeComponents",
								type: [
									"array",
									{
										count: "removedComponentCount",
										type: [
											"container",
											[{ name: "type", type: "SlotComponentType" }],
										],
									},
								],
							},
						],
					],
				},
			],
		},
	],
];

// HashedSlot: used in window_click for inventory prediction (1.21.11+)
// Unlike Slot, always present (no itemCount==0 empty check) — wrapped in option at usage site.
const HashedSlot: Schema = [
	"container",
	[
		{ name: "itemId", type: "varint" },
		{ name: "itemCount", type: "varint" },
		{
			name: "components",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "type", type: "SlotComponentType" },
							{ name: "hash", type: "i32" },
						],
					],
				},
			],
		},
		{
			name: "removeComponents",
			type: [
				"array",
				{
					countType: "varint",
					type: ["container", [{ name: "type", type: "SlotComponentType" }]],
				},
			],
		},
	],
];

// UntrustedSlot: same as Slot but read from untrusted input (client → server)
const UntrustedSlot: Schema = Slot;

// ── Particle system ──

// Particle: type mapper (112 types in 1.21.4) + type-specific data
const Particle: Schema = [
	"container",
	[
		{
			name: "type",
			type: [
				"mapper",
				{
					type: "varint",
					mappings: generatedMappings.ParticleType,
				},
			],
		},
		{
			name: "data",
			type: [
				"switch",
				{
					compareTo: "type",
					fields: {
						block: "varint",
						block_marker: "varint",
						falling_dust: "varint",
						dust_pillar: "varint",
						block_crumble: "varint",
						dust: [
							"container",
							[
								{ name: "color", type: "i32" },
								{ name: "scale", type: "f32" },
							],
						],
						dust_color_transition: [
							"container",
							[
								{ name: "fromColor", type: "i32" },
								{ name: "toColor", type: "i32" },
								{ name: "scale", type: "f32" },
							],
						],
						entity_effect: "i32",
						item: "Slot",
						sculk_charge: "f32",
						shriek: "varint",
						vibration: [
							"container",
							[
								{
									name: "positionType",
									type: [
										"mapper",
										{
											type: "varint",
											mappings: { "0": "block", "1": "entity" },
										},
									],
								},
								{
									name: "position",
									type: [
										"switch",
										{
											compareTo: "positionType",
											fields: {
												block: "position",
												entity: [
													"container",
													[
														{ name: "entityId", type: "varint" },
														{ name: "entityEyeHeight", type: "f32" },
													],
												],
											},
										},
									],
								},
								{ name: "ticks", type: "varint" },
							],
						],
						trail: [
							"container",
							[
								{ name: "target", type: "vec3f64" },
								{ name: "color", type: "i32" },
								{ name: "duration", type: "varint" },
							],
						],
						tinted_leaves: "i32",
					},
				},
			],
		},
	],
];

// ── Entity metadata ──

const EntityMetadataPaintingVariant: Schema = [
	"container",
	[
		{ name: "width", type: "i32" },
		{ name: "height", type: "i32" },
		{ name: "assetId", type: "string" },
		{ name: "title", type: ["option", "anonymousNbt"] },
		{ name: "author", type: ["option", "anonymousNbt"] },
	],
];

// Explosion particle entry: used in packet_explode blockParticles array
const ExplosionParticleEntry: Schema = [
	"container",
	[
		{
			name: "data",
			type: [
				"container",
				[
					{ name: "particle", type: "Particle" },
					{ name: "scaling", type: "f32" },
					{ name: "speed", type: "f32" },
				],
			],
		},
		{ name: "weight", type: "varint" },
	],
];

// Entity metadata entry: key (u8) + type (varint mapper) + value (switch on type)
const entityMetadataEntry: Schema = [
	"container",
	[
		{ name: "key", type: "u8" },
		{
			name: "type",
			type: [
				"mapper",
				{
					type: "varint",
					mappings: generatedMappings.entityMetadataType,
				},
			],
		},
		{
			name: "value",
			type: [
				"switch",
				{
					compareTo: "type",
					fields: {
						byte: "i8",
						int: "varint",
						long: "varlong",
						float: "f32",
						string: "string",
						component: "anonymousNbt",
						optional_component: ["option", "anonymousNbt"],
						item_stack: "Slot",
						boolean: "bool",
						rotations: [
							"container",
							[
								{ name: "pitch", type: "f32" },
								{ name: "yaw", type: "f32" },
								{ name: "roll", type: "f32" },
							],
						],
						block_pos: "position",
						optional_block_pos: ["option", "position"],
						direction: "varint",
						optional_uuid: ["option", "UUID"],
						block_state: "varint",
						optional_block_state: "optvarint",
						nbt: "anonymousNbt",
						particle: "Particle",
						particles: ["array", { countType: "varint", type: "Particle" }],
						villager_data: [
							"container",
							[
								{ name: "villagerType", type: "varint" },
								{ name: "villagerProfession", type: "varint" },
								{ name: "level", type: "varint" },
							],
						],
						optional_unsigned_int: "optvarint",
						pose: "varint",
						cat_variant: "varint",
						cow_variant: "varint",
						wolf_variant: "varint",
						wolf_sound_variant: "varint",
						frog_variant: "varint",
						pig_variant: "varint",
						chicken_variant: "varint",
						zombie_nautilus_variant: "varint",
						optional_global_pos: ["option", "GlobalPos"],
						painting_variant: [
							"registryEntryHolder",
							{
								baseName: "variantId",
								otherwise: {
									name: "variantData",
									type: "EntityMetadataPaintingVariant",
								},
							},
						],
						sniffer_state: "varint",
						armadillo_state: "varint",
						copper_golem_state: "varint",
						weathering_copper_golem_state: "varint",
						humanoid_arm: "varint",
						vector3: "vec3f",
						quaternion: "vec4f",
					},
				},
			],
		},
	],
];

// Entity metadata: loop until 0xFF terminator
const entityMetadata: Schema = [
	"entityMetadataLoop",
	{ endVal: 255, type: "entityMetadataEntry" },
];

// ── Ingredient (recipe) ──

const ingredient: Schema = ["array", { countType: "varint", type: "Slot" }];

// ── Chat / social ──

const previousMessages: Schema = [
	"array",
	{
		countType: "varint",
		type: [
			"container",
			[
				{ name: "id", type: "varint" },
				{
					name: "signature",
					type: [
						"switch",
						{
							compareTo: "id",
							fields: {
								"0": ["buffer", { count: 256 }],
							},
							default: "void",
						},
					],
				},
			],
		],
	},
];

const chat_session: Schema = [
	"option",
	[
		"container",
		[
			{ name: "uuid", type: "UUID" },
			{
				name: "publicKey",
				type: [
					"container",
					[
						{ name: "expireTime", type: "i64" },
						{ name: "keyBytes", type: ["buffer", { countType: "varint" }] },
						{ name: "keySignature", type: ["buffer", { countType: "varint" }] },
					],
				],
			},
		],
	],
];

const game_profile: Schema = [
	"container",
	[
		{ name: "name", type: "string" },
		{
			name: "properties",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "name", type: "string" },
							{ name: "value", type: "string" },
							{ name: "signature", type: ["option", "string"] },
						],
					],
				},
			],
		},
	],
];

// ── Tags ──

const tags: Schema = [
	"array",
	{
		countType: "varint",
		type: [
			"container",
			[
				{ name: "tagName", type: "string" },
				{
					name: "entries",
					type: ["array", { countType: "varint", type: "varint" }],
				},
			],
		],
	},
];

// ── Chunk ──

const chunkBlockEntity: Schema = [
	"container",
	[
		{
			anon: true,
			type: [
				"bitfield",
				[
					{ name: "x", size: 4, signed: false },
					{ name: "z", size: 4, signed: false },
				],
			],
		},
		{ name: "y", type: "i16" },
		{ name: "type", type: "varint" },
		{ name: "nbtData", type: "anonOptionalNbt" },
	],
];

// ── Command tree ──

const command_node: Schema = [
	"container",
	[
		{
			name: "flags",
			type: [
				"bitfield",
				[
					{ name: "unused", size: 2, signed: false },
					{ name: "allows_restricted", size: 1, signed: false },
					{ name: "has_custom_suggestions", size: 1, signed: false },
					{ name: "has_redirect_node", size: 1, signed: false },
					{ name: "has_command", size: 1, signed: false },
					{ name: "command_node_type", size: 2, signed: false },
				],
			],
		},
		{
			name: "children",
			type: ["array", { countType: "varint", type: "varint" }],
		},
		{
			name: "redirectNode",
			type: [
				"switch",
				{
					compareTo: "flags/has_redirect_node",
					fields: { "1": "varint" },
					default: "void",
				},
			],
		},
		{
			name: "extraNodeData",
			type: [
				"switch",
				{
					compareTo: "flags/command_node_type",
					fields: {
						"0": "void",
						"1": ["container", [{ name: "name", type: "string" }]],
						"2": [
							"container",
							[
								{ name: "name", type: "string" },
								{
									name: "parser",
									type: [
										"mapper",
										{
											type: "varint",
											mappings: {
												"0": "brigadier:bool",
												"1": "brigadier:float",
												"2": "brigadier:double",
												"3": "brigadier:integer",
												"4": "brigadier:long",
												"5": "brigadier:string",
												"6": "minecraft:entity",
												"7": "minecraft:game_profile",
												"8": "minecraft:block_pos",
												"9": "minecraft:column_pos",
												"10": "minecraft:vec3",
												"11": "minecraft:vec2",
												"12": "minecraft:block_state",
												"13": "minecraft:block_predicate",
												"14": "minecraft:item_stack",
												"15": "minecraft:item_predicate",
												"16": "minecraft:color",
												"17": "minecraft:hex_color",
												"18": "minecraft:component",
												"19": "minecraft:style",
												"20": "minecraft:message",
												"21": "minecraft:nbt",
												"22": "minecraft:nbt_tag",
												"23": "minecraft:nbt_path",
												"24": "minecraft:objective",
												"25": "minecraft:objective_criteria",
												"26": "minecraft:operation",
												"27": "minecraft:particle",
												"28": "minecraft:angle",
												"29": "minecraft:rotation",
												"30": "minecraft:scoreboard_slot",
												"31": "minecraft:score_holder",
												"32": "minecraft:swizzle",
												"33": "minecraft:team",
												"34": "minecraft:item_slot",
												"35": "minecraft:item_slots",
												"36": "minecraft:resource_location",
												"37": "minecraft:function",
												"38": "minecraft:entity_anchor",
												"39": "minecraft:int_range",
												"40": "minecraft:float_range",
												"41": "minecraft:dimension",
												"42": "minecraft:gamemode",
												"43": "minecraft:time",
												"44": "minecraft:resource_or_tag",
												"45": "minecraft:resource_or_tag_key",
												"46": "minecraft:resource",
												"47": "minecraft:resource_key",
												"48": "minecraft:resource_selector",
												"49": "minecraft:template_mirror",
												"50": "minecraft:template_rotation",
												"51": "minecraft:heightmap",
												"52": "minecraft:loot_table",
												"53": "minecraft:loot_predicate",
												"54": "minecraft:loot_modifier",
												"55": "minecraft:dialog",
												"56": "minecraft:uuid",
											},
										},
									],
								},
								{
									name: "properties",
									type: [
										"switch",
										{
											compareTo: "parser",
											fields: {
												"brigadier:bool": "void",
												"brigadier:float": [
													"container",
													[
														{
															name: "flags",
															type: [
																"bitfield",
																[
																	{ name: "unused", size: 6, signed: false },
																	{
																		name: "max_present",
																		size: 1,
																		signed: false,
																	},
																	{
																		name: "min_present",
																		size: 1,
																		signed: false,
																	},
																],
															],
														},
														{
															name: "min",
															type: [
																"switch",
																{
																	compareTo: "flags/min_present",
																	fields: { "1": "f32" },
																	default: "void",
																},
															],
														},
														{
															name: "max",
															type: [
																"switch",
																{
																	compareTo: "flags/max_present",
																	fields: { "1": "f32" },
																	default: "void",
																},
															],
														},
													],
												],
												"brigadier:double": [
													"container",
													[
														{
															name: "flags",
															type: [
																"bitfield",
																[
																	{ name: "unused", size: 6, signed: false },
																	{
																		name: "max_present",
																		size: 1,
																		signed: false,
																	},
																	{
																		name: "min_present",
																		size: 1,
																		signed: false,
																	},
																],
															],
														},
														{
															name: "min",
															type: [
																"switch",
																{
																	compareTo: "flags/min_present",
																	fields: { "1": "f64" },
																	default: "void",
																},
															],
														},
														{
															name: "max",
															type: [
																"switch",
																{
																	compareTo: "flags/max_present",
																	fields: { "1": "f64" },
																	default: "void",
																},
															],
														},
													],
												],
												"brigadier:integer": [
													"container",
													[
														{
															name: "flags",
															type: [
																"bitfield",
																[
																	{ name: "unused", size: 6, signed: false },
																	{
																		name: "max_present",
																		size: 1,
																		signed: false,
																	},
																	{
																		name: "min_present",
																		size: 1,
																		signed: false,
																	},
																],
															],
														},
														{
															name: "min",
															type: [
																"switch",
																{
																	compareTo: "flags/min_present",
																	fields: { "1": "i32" },
																	default: "void",
																},
															],
														},
														{
															name: "max",
															type: [
																"switch",
																{
																	compareTo: "flags/max_present",
																	fields: { "1": "i32" },
																	default: "void",
																},
															],
														},
													],
												],
												"brigadier:long": [
													"container",
													[
														{
															name: "flags",
															type: [
																"bitfield",
																[
																	{ name: "unused", size: 6, signed: false },
																	{
																		name: "max_present",
																		size: 1,
																		signed: false,
																	},
																	{
																		name: "min_present",
																		size: 1,
																		signed: false,
																	},
																],
															],
														},
														{
															name: "min",
															type: [
																"switch",
																{
																	compareTo: "flags/min_present",
																	fields: { "1": "i64" },
																	default: "void",
																},
															],
														},
														{
															name: "max",
															type: [
																"switch",
																{
																	compareTo: "flags/max_present",
																	fields: { "1": "i64" },
																	default: "void",
																},
															],
														},
													],
												],
												"brigadier:string": [
													"mapper",
													{
														type: "varint",
														mappings: {
															"0": "SINGLE_WORD",
															"1": "QUOTABLE_PHRASE",
															"2": "GREEDY_PHRASE",
														},
													},
												],
												"minecraft:entity": [
													"bitfield",
													[
														{ name: "unused", size: 6, signed: false },
														{
															name: "onlyAllowPlayers",
															size: 1,
															signed: false,
														},
														{
															name: "onlyAllowEntities",
															size: 1,
															signed: false,
														},
													],
												],
												"minecraft:score_holder": [
													"bitfield",
													[
														{ name: "unused", size: 7, signed: false },
														{ name: "allowMultiple", size: 1, signed: false },
													],
												],
												"minecraft:time": [
													"container",
													[{ name: "min", type: "i32" }],
												],
												"minecraft:resource_or_tag": [
													"container",
													[{ name: "registry", type: "string" }],
												],
												"minecraft:resource_or_tag_key": [
													"container",
													[{ name: "registry", type: "string" }],
												],
												"minecraft:resource": [
													"container",
													[{ name: "registry", type: "string" }],
												],
												"minecraft:resource_key": [
													"container",
													[{ name: "registry", type: "string" }],
												],
												"minecraft:resource_selector": [
													"container",
													[{ name: "registry", type: "string" }],
												],
											},
											default: "void",
										},
									],
								},
								{
									name: "suggestionType",
									type: [
										"switch",
										{
											compareTo: "../flags/has_custom_suggestions",
											fields: { "1": "string" },
											default: "void",
										},
									],
								},
							],
						],
					},
				},
			],
		},
	],
];

// ── Global position ──

const GlobalPos: Schema = [
	"container",
	[
		{ name: "dimensionName", type: "string" },
		{ name: "location", type: "position" },
	],
];

// ── Game profiles (1.21.11) ──

const GameProfileProperty: Schema = [
	"container",
	[
		{ name: "name", type: "string" },
		{ name: "value", type: "string" },
		{ name: "signature", type: ["option", "string"] },
	],
];

const GameProfile: Schema = [
	"container",
	[
		{ name: "uuid", type: "UUID" },
		{ name: "name", type: "string" },
		{
			name: "properties",
			type: ["array", { countType: "varint", type: "GameProfileProperty" }],
		},
	],
];

// Profile without UUID — used in player_info_update
const game_profile_name_prop: Schema = [
	"container",
	[
		{ name: "name", type: "string" },
		{
			name: "properties",
			type: ["array", { countType: "varint", type: "GameProfileProperty" }],
		},
	],
];

const PartialResolvableProfile: Schema = [
	"container",
	[
		{ name: "name", type: ["option", "string"] },
		{ name: "uuid", type: ["option", "UUID"] },
		{
			name: "properties",
			type: ["array", { countType: "varint", type: "GameProfileProperty" }],
		},
	],
];

const PlayerSkinPatch: Schema = [
	"container",
	[
		{ name: "body", type: ["option", "string"] },
		{ name: "cape", type: ["option", "string"] },
		{ name: "elytra", type: ["option", "string"] },
		{
			name: "model",
			type: [
				"option",
				["mapper", { type: "varint", mappings: { "0": "wide", "1": "slim" } }],
			],
		},
	],
];

const ResolvableProfile: Schema = [
	"container",
	[
		{
			name: "type",
			type: [
				"mapper",
				{ type: "varint", mappings: { "0": "partial", "1": "complete" } },
			],
		},
		{
			anon: true,
			type: [
				"switch",
				{
					compareTo: "type",
					fields: {
						partial: "PartialResolvableProfile",
						complete: "GameProfile",
					},
				},
			],
		},
		{ name: "skinPatch", type: "PlayerSkinPatch" },
	],
];

// ── Spawn / respawn data (1.21.11) ──

const RespawnData: Schema = [
	"container",
	[
		{ name: "globalPos", type: "GlobalPos" },
		{ name: "yaw", type: "f32" },
		{ name: "pitch", type: "f32" },
	],
];

const SpawnInfo: Schema = [
	"container",
	[
		{ name: "dimension", type: "varint" },
		{ name: "name", type: "string" },
		{ name: "hashedSeed", type: "i64" },
		{
			name: "gamemode",
			type: [
				"mapper",
				{
					type: "u8",
					mappings: {
						"0": "survival",
						"1": "creative",
						"2": "adventure",
						"3": "spectator",
					},
				},
			],
		},
		{ name: "previousGamemode", type: "i8" },
		{ name: "isDebug", type: "bool" },
		{ name: "isFlat", type: "bool" },
		{ name: "death", type: ["option", "GlobalPos"] },
		{ name: "portalCooldown", type: "varint" },
		{ name: "seaLevel", type: "varint" },
	],
];

// ── Position update flags ──

const PositionUpdateRelatives: Schema = [
	"bitflags",
	{
		type: "u32",
		flags: ["x", "y", "z", "yaw", "pitch", "dx", "dy", "dz", "yawDelta"],
	},
];

// ── Recipe system (1.21.11) ──

const RecipeBookSetting: Schema = [
	"container",
	[
		{ name: "open", type: "bool" },
		{ name: "filtering", type: "bool" },
	],
];

// Movement flags — 1.21.2+ replaced onGround boolean with a bitfield
const MovementFlags: Schema = [
	"bitfield",
	[
		{ name: "onGround", size: 1, signed: false },
		{ name: "horizontalCollision", size: 1, signed: false },
		{ name: "_padding", size: 6, signed: false },
	],
];

const SlotDisplay: Schema = [
	"container",
	[
		{
			name: "type",
			type: [
				"mapper",
				{
					type: "varint",
					mappings: {
						"0": "empty",
						"1": "any_fuel",
						"2": "item",
						"3": "item_stack",
						"4": "tag",
						"5": "smithing_trim",
						"6": "with_remainder",
						"7": "composite",
					},
				},
			],
		},
		{
			name: "data",
			type: [
				"switch",
				{
					compareTo: "type",
					fields: {
						empty: "void",
						any_fuel: "void",
						item: "varint",
						item_stack: "Slot",
						tag: "string",
						smithing_trim: [
							"container",
							[
								{ name: "base", type: "SlotDisplay" },
								{ name: "material", type: "SlotDisplay" },
								{
									name: "pattern",
									type: [
										"registryEntryHolder",
										{
											baseName: "patternId",
											otherwise: { name: "data", type: "ArmorTrimPattern" },
										},
									],
								},
							],
						],
						with_remainder: [
							"container",
							[
								{ name: "input", type: "SlotDisplay" },
								{ name: "remainder", type: "SlotDisplay" },
							],
						],
						composite: ["array", { countType: "varint", type: "SlotDisplay" }],
					},
				},
			],
		},
	],
];

const RecipeDisplay: Schema = [
	"container",
	[
		{
			name: "type",
			type: [
				"mapper",
				{
					type: "varint",
					mappings: {
						"0": "crafting_shapeless",
						"1": "crafting_shaped",
						"2": "furnace",
						"3": "stonecutter",
						"4": "smithing",
					},
				},
			],
		},
		{
			name: "data",
			type: [
				"switch",
				{
					compareTo: "type",
					fields: {
						crafting_shapeless: [
							"container",
							[
								{
									name: "ingredients",
									type: ["array", { countType: "varint", type: "SlotDisplay" }],
								},
								{ name: "result", type: "SlotDisplay" },
								{ name: "craftingStation", type: "SlotDisplay" },
							],
						],
						crafting_shaped: [
							"container",
							[
								{ name: "width", type: "varint" },
								{ name: "height", type: "varint" },
								{
									name: "ingredients",
									type: ["array", { countType: "varint", type: "SlotDisplay" }],
								},
								{ name: "result", type: "SlotDisplay" },
								{ name: "craftingStation", type: "SlotDisplay" },
							],
						],
						furnace: [
							"container",
							[
								{ name: "ingredient", type: "SlotDisplay" },
								{ name: "fuel", type: "SlotDisplay" },
								{ name: "result", type: "SlotDisplay" },
								{ name: "craftingStation", type: "SlotDisplay" },
								{ name: "duration", type: "varint" },
								{ name: "experience", type: "f32" },
							],
						],
						stonecutter: [
							"container",
							[
								{ name: "ingredient", type: "SlotDisplay" },
								{ name: "result", type: "SlotDisplay" },
								{ name: "craftingStation", type: "SlotDisplay" },
							],
						],
						smithing: [
							"container",
							[
								{ name: "template", type: "SlotDisplay" },
								{ name: "base", type: "SlotDisplay" },
								{ name: "addition", type: "SlotDisplay" },
								{ name: "result", type: "SlotDisplay" },
								{ name: "craftingStation", type: "SlotDisplay" },
							],
						],
					},
				},
			],
		},
	],
];

// ── Player info update ──

const packet_common_player_info_update: Schema = [
	"container",
	[
		{
			name: "action",
			type: [
				"bitflags",
				{
					type: "u8",
					flags: [
						"add_player",
						"initialize_chat",
						"update_game_mode",
						"update_listed",
						"update_latency",
						"update_display_name",
						"update_hat",
						"update_list_order",
					],
				},
			],
		},
		{
			name: "data",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "uuid", type: "UUID" },
							{
								name: "player",
								type: [
									"switch",
									{
										compareTo: "../action/add_player",
										fields: { true: "game_profile_name_prop" },
										default: "void",
									},
								],
							},
							{
								name: "chatSession",
								type: [
									"switch",
									{
										compareTo: "../action/initialize_chat",
										fields: { true: "chat_session" },
										default: "void",
									},
								],
							},
							{
								name: "gamemode",
								type: [
									"switch",
									{
										compareTo: "../action/update_game_mode",
										fields: { true: "varint" },
										default: "void",
									},
								],
							},
							{
								name: "listed",
								type: [
									"switch",
									{
										compareTo: "../action/update_listed",
										fields: { true: "varint" },
										default: "void",
									},
								],
							},
							{
								name: "latency",
								type: [
									"switch",
									{
										compareTo: "../action/update_latency",
										fields: { true: "varint" },
										default: "void",
									},
								],
							},
							{
								name: "displayName",
								type: [
									"switch",
									{
										compareTo: "../action/update_display_name",
										fields: { true: ["option", "anonymousNbt"] },
										default: "void",
									},
								],
							},
							{
								name: "hat",
								type: [
									"switch",
									{
										compareTo: "../action/update_hat",
										fields: { true: "bool" },
										default: "void",
									},
								],
							},
							{
								name: "listPriority",
								type: [
									"switch",
									{
										compareTo: "../action/update_list_order",
										fields: { true: "varint" },
										default: "void",
									},
								],
							},
						],
					],
				},
			],
		},
	],
];

// ── Common packets (shared between configuration and play) ──

const packet_common_client_information: Schema = [
	"container",
	[
		{ name: "locale", type: "string" },
		{ name: "viewDistance", type: "i8" },
		{ name: "chatFlags", type: "varint" },
		{ name: "chatColors", type: "bool" },
		{ name: "skinParts", type: "u8" },
		{ name: "mainHand", type: "varint" },
		{ name: "enableTextFiltering", type: "bool" },
		{ name: "enableServerListing", type: "bool" },
		{
			name: "particleStatus",
			type: [
				"mapper",
				{
					type: "varint",
					mappings: { "0": "all", "1": "decreased", "2": "minimal" },
				},
			],
		},
	],
];

const packet_common_cookie_request: Schema = [
	"container",
	[{ name: "cookie", type: "string" }],
];

const packet_common_store_cookie: Schema = [
	"container",
	[
		{ name: "key", type: "string" },
		{ name: "value", type: "ByteArray" },
	],
];

const packet_common_transfer: Schema = [
	"container",
	[
		{ name: "host", type: "string" },
		{ name: "port", type: "varint" },
	],
];

const packet_common_cookie_response: Schema = [
	"container",
	[
		{ name: "key", type: "string" },
		{ name: "value", type: ["option", "ByteArray"] },
	],
];

const packet_common_select_known_packs: Schema = [
	"container",
	[
		{
			name: "packs",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "namespace", type: "string" },
							{ name: "id", type: "string" },
							{ name: "version", type: "string" },
						],
					],
				},
			],
		},
	],
];

const packet_common_custom_report_details: Schema = [
	"container",
	[
		{
			name: "details",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "key", type: "string" },
							{ name: "value", type: "string" },
						],
					],
				},
			],
		},
	],
];

const packet_common_resource_pack_pop: Schema = [
	"container",
	[{ name: "uuid", type: ["option", "UUID"] }],
];

const packet_common_resource_pack_push: Schema = [
	"container",
	[
		{ name: "uuid", type: "UUID" },
		{ name: "url", type: "string" },
		{ name: "hash", type: "string" },
		{ name: "forced", type: "bool" },
		{ name: "promptMessage", type: ["option", "anonymousNbt"] },
	],
];

const ServerLinkType: Schema = [
	"mapper",
	{
		type: "varint",
		mappings: {
			"0": "bug_report",
			"1": "community_guidelines",
			"2": "support",
			"3": "status",
			"4": "feedback",
			"5": "community",
			"6": "website",
			"7": "forums",
			"8": "news",
			"9": "announcements",
		},
	},
];

const packet_common_server_links: Schema = [
	"container",
	[
		{
			name: "links",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "hasKnownType", type: "bool" },
							{
								name: "knownType",
								type: [
									"switch",
									{
										compareTo: "hasKnownType",
										fields: { true: "ServerLinkType" },
									},
								],
							},
							{
								name: "unknownType",
								type: [
									"switch",
									{
										compareTo: "hasKnownType",
										fields: { false: "anonymousNbt" },
									},
								],
							},
							{ name: "link", type: "string" },
						],
					],
				},
			],
		},
	],
];

// ── Critical packets not covered by auto-extraction ──

const packet_common_registry_data: Schema = [
	"container",
	[
		{ name: "id", type: "string" },
		{
			name: "entries",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "key", type: "string" },
							{ name: "value", type: ["option", "anonymousNbt"] },
						],
					],
				},
			],
		},
	],
];

const packet_common_update_enabled_features: Schema = [
	"container",
	[
		{
			name: "features",
			type: ["array", { countType: "varint", type: "string" }],
		},
	],
];

const packet_common_login_finished: Schema = [
	"container",
	[
		{ name: "uuid", type: "UUID" },
		{ name: "username", type: "string" },
		{
			name: "properties",
			type: [
				"array",
				{
					countType: "varint",
					type: [
						"container",
						[
							{ name: "name", type: "string" },
							{ name: "value", type: "string" },
							{ name: "signature", type: ["option", "string"] },
						],
					],
				},
			],
		},
	],
];

const packet_common_login_compression: Schema = [
	"container",
	[{ name: "compressionThreshold", type: "varint" }],
];

// ── Chat types holder (varint chat type registry ID) ──

const ChatTypesHolder: Schema = "varint";

// ── Exact component matcher (for merchant offers) ──
// Count-prefixed array of component type + data, same structure as slot components

const ExactComponentMatcher: Schema = [
	"array",
	{ countType: "varint", type: "SlotComponent" },
];

// ── Export all shared types as a flat record ──

export const SHARED_TYPES: Readonly<Record<string, Schema>> = {
	// Aliases
	string,
	ByteArray,
	optvarint,
	ContainerID,

	// Vectors & positions
	vec2f,
	vec3f,
	vec3i,
	vec4f,
	vec3f64,
	position,
	packedChunkPos,

	// Registry
	IDSet,

	// Sound
	soundSource,

	// Item system
	ItemSoundEvent,
	ItemSoundHolder,
	ItemFireworkExplosion,
	ItemEffectDetail,
	ItemPotionEffect,
	ItemBlockProperty,
	ItemBlockPredicate,
	ItemBookPage,
	ItemWrittenBookPage,
	ItemConsumeEffect,
	ArmorTrimMaterial,
	ArmorTrimPattern,
	InstrumentData,
	JukeboxSongData,
	BannerPattern,
	BannerPatternLayer,
	SlotComponentType,
	SlotComponent,
	Slot,
	HashedSlot,
	UntrustedSlot,

	// Particles
	Particle,
	ExplosionParticleEntry,

	// Entity metadata
	EntityMetadataPaintingVariant,
	entityMetadataEntry,
	entityMetadata,

	// Recipes
	ingredient,

	// Chat / social
	ChatTypesHolder,
	ExactComponentMatcher,
	previousMessages,
	chat_session,
	game_profile,

	// Tags
	tags,

	// Chunks
	chunkBlockEntity,

	// Commands
	command_node,

	// Global position
	GlobalPos,

	// Game profiles
	GameProfileProperty,
	GameProfile,
	game_profile_name_prop,
	PartialResolvableProfile,
	PlayerSkinPatch,
	ResolvableProfile,

	// Spawn / respawn
	RespawnData,
	SpawnInfo,

	// Position / movement
	PositionUpdateRelatives,
	MovementFlags,

	// Recipe system
	RecipeBookSetting,
	SlotDisplay,
	RecipeDisplay,

	// Player info
	packet_common_player_info_update,

	// Common packets (Mojang names — shared between configuration and play)
	packet_common_client_information,
	packet_common_cookie_request,
	packet_common_store_cookie,
	packet_common_transfer,
	packet_common_cookie_response,
	packet_common_select_known_packs,
	packet_common_custom_report_details,
	packet_common_resource_pack_pop,
	packet_common_resource_pack_push,
	ServerLinkType,
	packet_common_server_links,

	// Critical packets not covered by auto-extraction
	packet_common_registry_data,
	packet_common_update_enabled_features,
	packet_common_login_finished,
	packet_common_login_compression,
};
