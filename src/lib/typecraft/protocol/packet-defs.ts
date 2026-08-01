/**
 * Packet field definitions — the exact wire format for every packet.
 * Written from the Java Edition protocol specification (1.21.11, protocol 774).
 *
 * Keys use Mojang packet names (matching datagen extraction).
 */

export const PACKET_DEFS: Readonly<Record<string, unknown>> = {
	// ── New 1.21.11 packets (not in older protocol specs) ──

	// Bundle delimiter — empty packet, signals start/end of a packet bundle
	"play.toClient.packet_bundle_delimiter": ["container", []],

	// Dialog system (1.21.11+)
	"configuration.toClient.packet_clear_dialog": [
		"container",
		[{ name: "id", type: "string" }],
	],
	"play.toClient.packet_clear_dialog": [
		"container",
		[{ name: "id", type: "string" }],
	],

	// Custom click action (1.21.11+)
	"configuration.toServer.packet_custom_click_action": [
		"container",
		[
			{ name: "id", type: "string" },
			{ name: "data", type: "anonymousNbt" },
		],
	],
	"play.toServer.packet_custom_click_action": [
		"container",
		[
			{ name: "id", type: "string" },
			{ name: "data", type: "anonymousNbt" },
		],
	],

	// status.toClient
	"status.toClient.packet_status_response": [
		"container",
		[{ name: "response", type: "string" }],
	],
	"status.toClient.packet_pong_response": [
		"container",
		[{ name: "time", type: "i64" }],
	],

	// status.toServer
	"status.toServer.packet_status_request": ["container", []],
	"status.toServer.packet_ping_request": [
		"container",
		[{ name: "time", type: "i64" }],
	],

	// configuration.toClient
	"configuration.toClient.packet_custom_payload": [
		"container",
		[
			{ name: "channel", type: "string" },
			{ name: "data", type: "restBuffer" },
		],
	],
	"configuration.toClient.packet_disconnect": [
		"container",
		[{ name: "reason", type: "anonymousNbt" }],
	],
	"configuration.toClient.packet_finish_configuration": ["container", []],
	"configuration.toClient.packet_keep_alive": [
		"container",
		[{ name: "keepAliveId", type: "i64" }],
	],
	"configuration.toClient.packet_ping": [
		"container",
		[{ name: "id", type: "i32" }],
	],
	"configuration.toClient.packet_reset_chat": ["container", []],
	"configuration.toClient.packet_registry_data": [
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
	],
	"configuration.toClient.packet_update_enabled_features": [
		"container",
		[
			{
				name: "features",
				type: ["array", { countType: "varint", type: "string" }],
			},
		],
	],
	"configuration.toClient.packet_update_tags": [
		"container",
		[
			{
				name: "tags",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "tagType", type: "string" },
								{ name: "tags", type: "tags" },
							],
						],
					},
				],
			},
		],
	],
	"configuration.toClient.packet_show_dialog": [
		"container",
		[{ name: "dialog", type: "anonymousNbt" }],
	],
	"configuration.toClient.packet_code_of_conduct": [
		"container",
		[{ name: "contents", type: "string" }],
	],

	// configuration.toServer
	"configuration.toServer.packet_custom_payload": [
		"container",
		[
			{ name: "channel", type: "string" },
			{ name: "data", type: "restBuffer" },
		],
	],
	"configuration.toServer.packet_finish_configuration": ["container", []],
	"configuration.toServer.packet_keep_alive": [
		"container",
		[{ name: "keepAliveId", type: "i64" }],
	],
	"configuration.toServer.packet_pong": [
		"container",
		[{ name: "id", type: "i32" }],
	],
	"configuration.toServer.packet_resource_pack": [
		"container",
		[
			{ name: "uuid", type: "UUID" },
			{ name: "result", type: "varint" },
		],
	],
	"configuration.toServer.packet_accept_code_of_conduct": ["container", []],

	// play.toClient
	"play.toClient.packet_add_entity": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "objectUUID", type: "UUID" },
			{ name: "type", type: "varint" },
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "velocity", type: "lpVec3" },
			{ name: "pitch", type: "i8" },
			{ name: "yaw", type: "i8" },
			{ name: "headYaw", type: "i8" },
			{ name: "objectData", type: "varint" },
		],
	],
	"play.toClient.packet_animate": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "animation", type: "u8" },
		],
	],
	"play.toClient.packet_award_stats": [
		"container",
		[
			{
				name: "entries",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "categoryId", type: "varint" },
								{ name: "statisticId", type: "varint" },
								{ name: "value", type: "varint" },
							],
						],
					},
				],
			},
		],
	],
	"play.toClient.packet_block_changed_ack": [
		"container",
		[{ name: "sequenceId", type: "varint" }],
	],
	"play.toClient.packet_block_destruction": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "location", type: "position" },
			{ name: "destroyStage", type: "i8" },
		],
	],
	"play.toClient.packet_block_entity_data": [
		"container",
		[
			{ name: "location", type: "position" },
			{ name: "action", type: "varint" },
			{ name: "nbtData", type: "anonOptionalNbt" },
		],
	],
	"play.toClient.packet_block_event": [
		"container",
		[
			{ name: "location", type: "position" },
			{ name: "byte1", type: "u8" },
			{ name: "byte2", type: "u8" },
			{ name: "blockId", type: "varint" },
		],
	],
	"play.toClient.packet_block_update": [
		"container",
		[
			{ name: "location", type: "position" },
			{ name: "type", type: "varint" },
		],
	],
	"play.toClient.packet_boss_event": [
		"container",
		[
			{ name: "entityUUID", type: "UUID" },
			{ name: "action", type: "varint" },
			{
				name: "title",
				type: [
					"switch",
					{
						compareTo: "action",
						fields: { "0": "anonymousNbt", "3": "anonymousNbt" },
						default: "void",
					},
				],
			},
			{
				name: "health",
				type: [
					"switch",
					{
						compareTo: "action",
						fields: { "0": "f32", "2": "f32" },
						default: "void",
					},
				],
			},
			{
				name: "color",
				type: [
					"switch",
					{
						compareTo: "action",
						fields: { "0": "varint", "4": "varint" },
						default: "void",
					},
				],
			},
			{
				name: "dividers",
				type: [
					"switch",
					{
						compareTo: "action",
						fields: { "0": "varint", "4": "varint" },
						default: "void",
					},
				],
			},
			{
				name: "flags",
				type: [
					"switch",
					{
						compareTo: "action",
						fields: { "0": "u8", "5": "u8" },
						default: "void",
					},
				],
			},
		],
	],
	"play.toClient.packet_change_difficulty": [
		"container",
		[
			{
				name: "difficulty",
				type: [
					"mapper",
					{
						type: "varint",
						mappings: {
							"0": "peaceful",
							"1": "easy",
							"2": "normal",
							"3": "hard",
						},
					},
				],
			},
			{ name: "difficultyLocked", type: "bool" },
		],
	],
	"play.toClient.packet_chunk_batch_finished": [
		"container",
		[{ name: "batchSize", type: "varint" }],
	],
	"play.toClient.packet_chunk_batch_start": ["container", []],
	"play.toClient.packet_chunks_biomes": [
		"container",
		[
			{
				name: "biomes",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "position", type: "packedChunkPos" },
								{ name: "data", type: "ByteArray" },
							],
						],
					},
				],
			},
		],
	],
	"play.toClient.packet_clear_titles": [
		"container",
		[{ name: "reset", type: "bool" }],
	],
	"play.toClient.packet_command_suggestions": [
		"container",
		[
			{ name: "transactionId", type: "varint" },
			{ name: "start", type: "varint" },
			{ name: "length", type: "varint" },
			{
				name: "matches",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "match", type: "string" },
								{ name: "tooltip", type: ["option", "anonymousNbt"] },
							],
						],
					},
				],
			},
		],
	],
	"play.toClient.packet_commands": [
		"container",
		[
			{
				name: "nodes",
				type: ["array", { countType: "varint", type: "command_node" }],
			},
			{ name: "rootIndex", type: "varint" },
		],
	],
	"play.toClient.packet_container_close": [
		"container",
		[{ name: "windowId", type: "ContainerID" }],
	],
	"play.toClient.packet_container_set_content": [
		"container",
		[
			{ name: "windowId", type: "ContainerID" },
			{ name: "stateId", type: "varint" },
			{ name: "items", type: ["array", { countType: "varint", type: "Slot" }] },
			{ name: "carriedItem", type: "Slot" },
		],
	],
	"play.toClient.packet_container_set_data": [
		"container",
		[
			{ name: "windowId", type: "ContainerID" },
			{ name: "property", type: "i16" },
			{ name: "value", type: "i16" },
		],
	],
	"play.toClient.packet_container_set_slot": [
		"container",
		[
			{ name: "windowId", type: "ContainerID" },
			{ name: "stateId", type: "varint" },
			{ name: "slot", type: "i16" },
			{ name: "item", type: "Slot" },
		],
	],
	"play.toClient.packet_cooldown": [
		"container",
		[
			{ name: "cooldownGroup", type: "string" },
			{ name: "cooldownTicks", type: "varint" },
		],
	],
	"play.toClient.packet_custom_chat_completions": [
		"container",
		[
			{ name: "action", type: "varint" },
			{
				name: "entries",
				type: ["array", { countType: "varint", type: "string" }],
			},
		],
	],
	"play.toClient.packet_custom_payload": [
		"container",
		[
			{ name: "channel", type: "string" },
			{ name: "data", type: "restBuffer" },
		],
	],
	"play.toClient.packet_damage_event": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "sourceTypeId", type: "varint" },
			{ name: "sourceCauseId", type: "varint" },
			{ name: "sourceDirectId", type: "varint" },
			{ name: "sourcePosition", type: ["option", "vec3f64"] },
		],
	],
	"play.toClient.packet_debug/block_value": [
		"container",
		[
			{ name: "blockPos", type: "position" },
			{ name: "update", type: "DebugSubscriptionUpdate" },
		],
	],
	"play.toClient.packet_debug/chunk_value": [
		"container",
		[
			{ name: "chunkPos", type: "packedChunkPos" },
			{ name: "update", type: "DebugSubscriptionUpdate" },
		],
	],
	"play.toClient.packet_debug/entity_value": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "update", type: "DebugSubscriptionUpdate" },
		],
	],
	"play.toClient.packet_debug/event": [
		"container",
		[{ name: "event", type: "DebugSubscriptionEvent" }],
	],
	"play.toClient.packet_debug_sample": [
		"container",
		[
			{ name: "sample", type: ["array", { countType: "varint", type: "i64" }] },
			{ name: "type", type: "varint" },
		],
	],
	"play.toClient.packet_delete_chat": [
		"container",
		[
			{ name: "id", type: "varint" },
			{
				name: "signature",
				type: [
					"switch",
					{
						compareTo: "id",
						fields: { "0": ["buffer", { count: 256 }] },
						default: "void",
					},
				],
			},
		],
	],
	"play.toClient.packet_disconnect": [
		"container",
		[{ name: "reason", type: "anonymousNbt" }],
	],
	"play.toClient.packet_disguised_chat": [
		"container",
		[
			{ name: "message", type: "anonymousNbt" },
			{ name: "type", type: "ChatTypesHolder" },
			{ name: "name", type: "anonymousNbt" },
			{ name: "target", type: ["option", "anonymousNbt"] },
		],
	],
	"play.toClient.packet_entity_event": [
		"container",
		[
			{ name: "entityId", type: "i32" },
			{ name: "entityStatus", type: "i8" },
		],
	],
	"play.toClient.packet_entity_position_sync": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "dx", type: "f64" },
			{ name: "dy", type: "f64" },
			{ name: "dz", type: "f64" },
			{ name: "yaw", type: "f32" },
			{ name: "pitch", type: "f32" },
			{ name: "onGround", type: "bool" },
		],
	],
	"play.toClient.packet_explode": [
		"container",
		[
			{ name: "center", type: "vec3f64" },
			{ name: "radius", type: "f32" },
			{ name: "blockCount", type: "i32" },
			{ name: "playerKnockback", type: ["option", "vec3f64"] },
			{ name: "explosionParticle", type: "Particle" },
			{ name: "sound", type: "ItemSoundHolder" },
			{
				name: "blockParticles",
				type: [
					"array",
					{ countType: "varint", type: "ExplosionParticleEntry" },
				],
			},
		],
	],
	"play.toClient.packet_forget_level_chunk": [
		"container",
		[
			{ name: "chunkZ", type: "i32" },
			{ name: "chunkX", type: "i32" },
		],
	],
	"play.toClient.packet_game_event": [
		"container",
		[
			{
				name: "reason",
				type: [
					"mapper",
					{
						type: "u8",
						mappings: {
							"0": "no_respawn_block_available",
							"1": "start_raining",
							"2": "stop_raining",
							"3": "change_game_mode",
							"4": "win_game",
							"5": "demo_event",
							"6": "play_arrow_hit_sound",
							"7": "rain_level_change",
							"8": "thunder_level_change",
							"9": "puffer_fish_sting",
							"10": "guardian_elder_effect",
							"11": "immediate_respawn",
							"12": "limited_crafting",
							"13": "level_chunks_load_start",
						},
					},
				],
			},
			{ name: "gameMode", type: "f32" },
		],
	],
	"play.toClient.packet_game_test_highlight_pos": [
		"container",
		[
			{ name: "absolutePos", type: "position" },
			{ name: "relativePos", type: "position" },
		],
	],
	"play.toClient.packet_mount_screen_open": [
		"container",
		[
			{ name: "windowId", type: "ContainerID" },
			{ name: "nbSlots", type: "varint" },
			{ name: "entityId", type: "i32" },
		],
	],
	"play.toClient.packet_hurt_animation": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "yaw", type: "f32" },
		],
	],
	"play.toClient.packet_initialize_border": [
		"container",
		[
			{ name: "x", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "oldDiameter", type: "f64" },
			{ name: "newDiameter", type: "f64" },
			{ name: "speed", type: "varint" },
			{ name: "portalTeleportBoundary", type: "varint" },
			{ name: "warningBlocks", type: "varint" },
			{ name: "warningTime", type: "varint" },
		],
	],
	"play.toClient.packet_keep_alive": [
		"container",
		[{ name: "keepAliveId", type: "i64" }],
	],
	"play.toClient.packet_level_chunk_with_light": [
		"container",
		[
			{ name: "x", type: "i32" },
			{ name: "z", type: "i32" },
			{
				name: "heightmaps",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{
									name: "type",
									type: [
										"mapper",
										{
											type: "varint",
											mappings: {
												"0": "world_surface_wg",
												"1": "world_surface",
												"2": "ocean_floor_wg",
												"3": "ocean_floor",
												"4": "motion_blocking",
												"5": "motion_blocking_no_leaves",
											},
										},
									],
								},
								{
									name: "data",
									type: ["array", { countType: "varint", type: "i64" }],
								},
							],
						],
					},
				],
			},
			{ name: "chunkData", type: "ByteArray" },
			{
				name: "blockEntities",
				type: ["array", { countType: "varint", type: "chunkBlockEntity" }],
			},
			{
				name: "skyLightMask",
				type: ["array", { countType: "varint", type: "i64" }],
			},
			{
				name: "blockLightMask",
				type: ["array", { countType: "varint", type: "i64" }],
			},
			{
				name: "emptySkyLightMask",
				type: ["array", { countType: "varint", type: "i64" }],
			},
			{
				name: "emptyBlockLightMask",
				type: ["array", { countType: "varint", type: "i64" }],
			},
			{
				name: "skyLight",
				type: [
					"array",
					{
						countType: "varint",
						type: ["array", { countType: "varint", type: "u8" }],
					},
				],
			},
			{
				name: "blockLight",
				type: [
					"array",
					{
						countType: "varint",
						type: ["array", { countType: "varint", type: "u8" }],
					},
				],
			},
		],
	],
	"play.toClient.packet_level_event": [
		"container",
		[
			{ name: "effectId", type: "i32" },
			{ name: "location", type: "position" },
			{ name: "data", type: "i32" },
			{ name: "global", type: "bool" },
		],
	],
	"play.toClient.packet_level_particles": [
		"container",
		[
			{ name: "longDistance", type: "bool" },
			{ name: "alwaysShow", type: "bool" },
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "offsetX", type: "f32" },
			{ name: "offsetY", type: "f32" },
			{ name: "offsetZ", type: "f32" },
			{ name: "velocityOffset", type: "f32" },
			{ name: "amount", type: "i32" },
			{ name: "particle", type: "Particle" },
		],
	],
	"play.toClient.packet_light_update": [
		"container",
		[
			{ name: "chunkX", type: "varint" },
			{ name: "chunkZ", type: "varint" },
			{
				name: "skyLightMask",
				type: ["array", { countType: "varint", type: "i64" }],
			},
			{
				name: "blockLightMask",
				type: ["array", { countType: "varint", type: "i64" }],
			},
			{
				name: "emptySkyLightMask",
				type: ["array", { countType: "varint", type: "i64" }],
			},
			{
				name: "emptyBlockLightMask",
				type: ["array", { countType: "varint", type: "i64" }],
			},
			{
				name: "skyLight",
				type: [
					"array",
					{
						countType: "varint",
						type: ["array", { countType: "varint", type: "u8" }],
					},
				],
			},
			{
				name: "blockLight",
				type: [
					"array",
					{
						countType: "varint",
						type: ["array", { countType: "varint", type: "u8" }],
					},
				],
			},
		],
	],
	"play.toClient.packet_login": [
		"container",
		[
			{ name: "entityId", type: "i32" },
			{ name: "isHardcore", type: "bool" },
			{
				name: "worldNames",
				type: ["array", { countType: "varint", type: "string" }],
			},
			{ name: "maxPlayers", type: "varint" },
			{ name: "viewDistance", type: "varint" },
			{ name: "simulationDistance", type: "varint" },
			{ name: "reducedDebugInfo", type: "bool" },
			{ name: "enableRespawnScreen", type: "bool" },
			{ name: "doLimitedCrafting", type: "bool" },
			{ name: "worldState", type: "SpawnInfo" },
			{ name: "enforcesSecureChat", type: "bool" },
		],
	],
	"play.toClient.packet_map_item_data": [
		"container",
		[
			{ name: "itemDamage", type: "varint" },
			{ name: "scale", type: "i8" },
			{ name: "locked", type: "bool" },
			{
				name: "icons",
				type: [
					"option",
					[
						"array",
						{
							countType: "varint",
							type: [
								"container",
								[
									{ name: "type", type: "varint" },
									{ name: "x", type: "i8" },
									{ name: "z", type: "i8" },
									{ name: "direction", type: "u8" },
									{ name: "displayName", type: ["option", "anonymousNbt"] },
								],
							],
						},
					],
				],
			},
			{ name: "columns", type: "u8" },
			{
				name: "rows",
				type: [
					"switch",
					{ compareTo: "columns", fields: { "0": "void" }, default: "u8" },
				],
			},
			{
				name: "x",
				type: [
					"switch",
					{ compareTo: "columns", fields: { "0": "void" }, default: "u8" },
				],
			},
			{
				name: "y",
				type: [
					"switch",
					{ compareTo: "columns", fields: { "0": "void" }, default: "u8" },
				],
			},
			{
				name: "data",
				type: [
					"switch",
					{
						compareTo: "columns",
						fields: { "0": "void" },
						default: ["buffer", { countType: "varint" }],
					},
				],
			},
		],
	],
	"play.toClient.packet_merchant_offers": [
		"container",
		[
			{ name: "windowId", type: "ContainerID" },
			{
				name: "trades",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{
									name: "inputItem1",
									type: [
										"container",
										[
											{ name: "itemId", type: "varint" },
											{ name: "itemCount", type: "varint" },
											{ name: "components", type: "ExactComponentMatcher" },
										],
									],
								},
								{ name: "outputItem", type: "Slot" },
								{
									name: "inputItem2",
									type: [
										"option",
										[
											"container",
											[
												{ name: "itemId", type: "varint" },
												{ name: "itemCount", type: "varint" },
												{ name: "components", type: "ExactComponentMatcher" },
											],
										],
									],
								},
								{ name: "tradeDisabled", type: "bool" },
								{ name: "nbTradeUses", type: "i32" },
								{ name: "maximumNbTradeUses", type: "i32" },
								{ name: "xp", type: "i32" },
								{ name: "specialPrice", type: "i32" },
								{ name: "priceMultiplier", type: "f32" },
								{ name: "demand", type: "i32" },
							],
						],
					},
				],
			},
			{ name: "villagerLevel", type: "varint" },
			{ name: "experience", type: "varint" },
			{ name: "isRegularVillager", type: "bool" },
			{ name: "canRestock", type: "bool" },
		],
	],
	"play.toClient.packet_move_entity_pos": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "dX", type: "i16" },
			{ name: "dY", type: "i16" },
			{ name: "dZ", type: "i16" },
			{ name: "onGround", type: "bool" },
		],
	],
	"play.toClient.packet_move_entity_pos_rot": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "dX", type: "i16" },
			{ name: "dY", type: "i16" },
			{ name: "dZ", type: "i16" },
			{ name: "yaw", type: "i8" },
			{ name: "pitch", type: "i8" },
			{ name: "onGround", type: "bool" },
		],
	],
	"play.toClient.packet_move_minecart_along_track": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{
				name: "steps",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "position", type: "vec3f" },
								{ name: "velocity", type: "vec3f" },
								{ name: "yaw", type: "f32" },
								{ name: "pitch", type: "f32" },
								{ name: "weight", type: "f32" },
							],
						],
					},
				],
			},
		],
	],
	"play.toClient.packet_move_entity_rot": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "yaw", type: "i8" },
			{ name: "pitch", type: "i8" },
			{ name: "onGround", type: "bool" },
		],
	],
	"play.toClient.packet_move_vehicle": [
		"container",
		[
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "yaw", type: "f32" },
			{ name: "pitch", type: "f32" },
		],
	],
	"play.toClient.packet_open_book": [
		"container",
		[{ name: "hand", type: "varint" }],
	],
	"play.toClient.packet_open_screen": [
		"container",
		[
			{ name: "windowId", type: "varint" },
			{ name: "inventoryType", type: "varint" },
			{ name: "windowTitle", type: "anonymousNbt" },
		],
	],
	"play.toClient.packet_open_sign_editor": [
		"container",
		[
			{ name: "location", type: "position" },
			{ name: "isFrontText", type: "bool" },
		],
	],
	"play.toClient.packet_ping": ["container", [{ name: "id", type: "i32" }]],
	"play.toClient.packet_pong_response": [
		"container",
		[{ name: "id", type: "i64" }],
	],
	"play.toClient.packet_place_ghost_recipe": [
		"container",
		[
			{ name: "windowId", type: "ContainerID" },
			{ name: "recipeDisplay", type: "RecipeDisplay" },
		],
	],
	"play.toClient.packet_player_abilities": [
		"container",
		[
			{ name: "flags", type: "i8" },
			{ name: "flyingSpeed", type: "f32" },
			{ name: "walkingSpeed", type: "f32" },
		],
	],
	"play.toClient.packet_player_chat": [
		"container",
		[
			{ name: "globalIndex", type: "varint" },
			{ name: "senderUuid", type: "UUID" },
			{ name: "index", type: "varint" },
			{ name: "signature", type: ["option", ["buffer", { count: 256 }]] },
			{ name: "plainMessage", type: "string" },
			{ name: "timestamp", type: "i64" },
			{ name: "salt", type: "i64" },
			{ name: "previousMessages", type: "previousMessages" },
			{ name: "unsignedChatContent", type: ["option", "anonymousNbt"] },
			{ name: "filterType", type: "varint" },
			{
				name: "filterTypeMask",
				type: [
					"switch",
					{
						compareTo: "filterType",
						fields: { "2": ["array", { countType: "varint", type: "i64" }] },
						default: "void",
					},
				],
			},
			{ name: "type", type: "ChatTypesHolder" },
			{ name: "networkName", type: "anonymousNbt" },
			{ name: "networkTargetName", type: ["option", "anonymousNbt"] },
		],
	],
	"play.toClient.packet_player_combat_end": [
		"container",
		[{ name: "duration", type: "varint" }],
	],
	"play.toClient.packet_player_combat_enter": ["container", []],
	"play.toClient.packet_player_combat_kill": [
		"container",
		[
			{ name: "playerId", type: "varint" },
			{ name: "message", type: "anonymousNbt" },
		],
	],
	"play.toClient.packet_player_info_remove": [
		"container",
		[
			{
				name: "players",
				type: ["array", { countType: "varint", type: "UUID" }],
			},
		],
	],
	"play.toClient.packet_player_info_update": [
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
								{
									name: "showHat",
									type: [
										"switch",
										{
											compareTo: "../action/update_hat",
											fields: { true: "bool" },
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
	],
	"play.toClient.packet_player_look_at": [
		"container",
		[
			{ name: "feet_eyes", type: "varint" },
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "isEntity", type: "bool" },
			{
				name: "entityId",
				type: [
					"switch",
					{
						compareTo: "isEntity",
						fields: { true: "varint" },
						default: "void",
					},
				],
			},
			{
				name: "entity_feet_eyes",
				type: [
					"switch",
					{
						compareTo: "isEntity",
						fields: { true: "varint" },
						default: "void",
					},
				],
			},
		],
	],
	"play.toClient.packet_player_position": [
		"container",
		[
			{ name: "teleportId", type: "varint" },
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "dx", type: "f64" },
			{ name: "dy", type: "f64" },
			{ name: "dz", type: "f64" },
			{ name: "yaw", type: "f32" },
			{ name: "pitch", type: "f32" },
			{ name: "flags", type: "PositionUpdateRelatives" },
		],
	],
	"play.toClient.packet_player_rotation": [
		"container",
		[
			{ name: "yaw", type: "f32" },
			{ name: "relativeYaw", type: "bool" },
			{ name: "pitch", type: "f32" },
			{ name: "relativePitch", type: "bool" },
		],
	],
	"play.toClient.packet_recipe_book_add": [
		"container",
		// 26.1.2: recipe-book UI payload (RecipeDisplay/RecipePropertySet type system),
		// unused by the bot — read opaque so it decodes cleanly and stays stream-aligned.
		[{ name: "data", type: "restBuffer" }],
	],
	"play.toClient.packet_recipe_book_remove": [
		"container",
		[
			{
				name: "recipeIds",
				type: ["array", { countType: "varint", type: "varint" }],
			},
		],
	],
	"play.toClient.packet_recipe_book_settings": [
		"container",
		[
			{ name: "crafting", type: "RecipeBookSetting" },
			{ name: "furnace", type: "RecipeBookSetting" },
			{ name: "blast", type: "RecipeBookSetting" },
			{ name: "smoker", type: "RecipeBookSetting" },
		],
	],
	"play.toClient.packet_remove_entities": [
		"container",
		[
			{
				name: "entityIds",
				type: ["array", { countType: "varint", type: "varint" }],
			},
		],
	],
	"play.toClient.packet_remove_mob_effect": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "effectId", type: "varint" },
		],
	],
	"play.toClient.packet_reset_score": [
		"container",
		[
			{ name: "entity_name", type: "string" },
			{ name: "objective_name", type: ["option", "string"] },
		],
	],
	"play.toClient.packet_respawn": [
		"container",
		[
			{ name: "worldState", type: "SpawnInfo" },
			{ name: "copyMetadata", type: "u8" },
		],
	],
	"play.toClient.packet_rotate_head": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "headYaw", type: "i8" },
		],
	],
	"play.toClient.packet_section_blocks_update": [
		"container",
		[
			{
				name: "chunkCoordinates",
				type: [
					"bitfield",
					[
						{ name: "x", size: 22, signed: true },
						{ name: "z", size: 22, signed: true },
						{ name: "y", size: 20, signed: true },
					],
				],
			},
			{
				name: "records",
				type: ["array", { countType: "varint", type: "varlong" }],
			},
		],
	],
	"play.toClient.packet_select_advancements_tab": [
		"container",
		[{ name: "id", type: ["option", "string"] }],
	],
	"play.toClient.packet_server_data": [
		"container",
		[
			{ name: "motd", type: "anonymousNbt" },
			{ name: "iconBytes", type: ["option", "ByteArray"] },
		],
	],
	"play.toClient.packet_set_action_bar_text": [
		"container",
		[{ name: "text", type: "anonymousNbt" }],
	],
	"play.toClient.packet_set_border_center": [
		"container",
		[
			{ name: "x", type: "f64" },
			{ name: "z", type: "f64" },
		],
	],
	"play.toClient.packet_set_border_lerp_size": [
		"container",
		[
			{ name: "oldDiameter", type: "f64" },
			{ name: "newDiameter", type: "f64" },
			{ name: "speed", type: "varint" },
		],
	],
	"play.toClient.packet_set_border_size": [
		"container",
		[{ name: "diameter", type: "f64" }],
	],
	"play.toClient.packet_set_border_warning_delay": [
		"container",
		[{ name: "warningTime", type: "varint" }],
	],
	"play.toClient.packet_set_border_warning_distance": [
		"container",
		[{ name: "warningBlocks", type: "varint" }],
	],
	"play.toClient.packet_set_camera": [
		"container",
		[{ name: "cameraId", type: "varint" }],
	],
	"play.toClient.packet_set_chunk_cache_center": [
		"container",
		[
			{ name: "chunkX", type: "varint" },
			{ name: "chunkZ", type: "varint" },
		],
	],
	"play.toClient.packet_set_chunk_cache_radius": [
		"container",
		[{ name: "viewDistance", type: "varint" }],
	],
	"play.toClient.packet_set_cursor_item": [
		"container",
		[{ name: "contents", type: "Slot" }],
	],
	"play.toClient.packet_set_default_spawn_position": "RespawnData",
	"play.toClient.packet_set_display_objective": [
		"container",
		[
			{ name: "position", type: "varint" },
			{ name: "name", type: "string" },
		],
	],
	"play.toClient.packet_set_entity_data": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "metadata", type: "entityMetadata" },
		],
	],
	"play.toClient.packet_set_entity_link": [
		"container",
		[
			{ name: "entityId", type: "i32" },
			{ name: "vehicleId", type: "i32" },
		],
	],
	"play.toClient.packet_set_entity_motion": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "velocity", type: "lpVec3" },
		],
	],
	"play.toClient.packet_set_equipment": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{
				name: "equipments",
				type: [
					"topBitSetTerminatedArray",
					{
						type: [
							"container",
							[
								{ name: "slot", type: "i8" },
								{ name: "item", type: "Slot" },
							],
						],
					},
				],
			},
		],
	],
	"play.toClient.packet_set_experience": [
		"container",
		[
			{ name: "experienceBar", type: "f32" },
			{ name: "level", type: "varint" },
			{ name: "totalExperience", type: "varint" },
		],
	],
	"play.toClient.packet_set_health": [
		"container",
		[
			{ name: "health", type: "f32" },
			{ name: "food", type: "varint" },
			{ name: "foodSaturation", type: "f32" },
		],
	],
	"play.toClient.packet_set_held_slot": [
		"container",
		[{ name: "slot", type: "varint" }],
	],
	"play.toClient.packet_set_objective": [
		"container",
		[
			{ name: "name", type: "string" },
			{ name: "action", type: "i8" },
			{
				name: "displayText",
				type: [
					"switch",
					{
						compareTo: "action",
						fields: { "0": "anonymousNbt", "2": "anonymousNbt" },
						default: "void",
					},
				],
			},
			{
				name: "type",
				type: [
					"switch",
					{
						compareTo: "action",
						fields: { "0": "varint", "2": "varint" },
						default: "void",
					},
				],
			},
			{
				name: "number_format",
				type: [
					"switch",
					{
						compareTo: "action",
						fields: { "0": ["option", "varint"], "2": ["option", "varint"] },
						default: "void",
					},
				],
			},
			{
				name: "styling",
				type: [
					"switch",
					{
						compareTo: "action",
						fields: {
							"0": [
								"switch",
								{
									compareTo: "number_format",
									fields: { "1": "anonymousNbt", "2": "anonymousNbt" },
									default: "void",
								},
							],
							"2": [
								"switch",
								{
									compareTo: "number_format",
									fields: { "1": "anonymousNbt", "2": "anonymousNbt" },
									default: "void",
								},
							],
						},
						default: "void",
					},
				],
			},
		],
	],
	"play.toClient.packet_set_passengers": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{
				name: "passengers",
				type: ["array", { countType: "varint", type: "varint" }],
			},
		],
	],
	"play.toClient.packet_set_player_inventory": [
		"container",
		[
			{ name: "slotId", type: "varint" },
			{ name: "contents", type: "Slot" },
		],
	],
	"play.toClient.packet_set_player_team": [
		"container",
		[
			{ name: "team", type: "string" },
			{
				name: "mode",
				type: [
					"mapper",
					{
						type: "i8",
						mappings: {
							"0": "add",
							"1": "remove",
							"2": "change",
							"3": "join",
							"4": "leave",
						},
					},
				],
			},
			{
				anon: true,
				type: [
					"switch",
					{
						compareTo: "mode",
						fields: {
							add: [
								"container",
								[
									{ name: "name", type: "anonymousNbt" },
									{
										name: "flags",
										type: [
											"bitflags",
											{
												type: "u8",
												flags: ["friendly_fire", "see_friendly_invisible"],
											},
										],
									},
									{
										name: "nameTagVisibility",
										type: [
											"mapper",
											{
												type: "varint",
												mappings: {
													"0": "always",
													"1": "never",
													"2": "hide_for_other_teams",
													"3": "hide_for_own_team",
												},
											},
										],
									},
									{
										name: "collisionRule",
										type: [
											"mapper",
											{
												type: "varint",
												mappings: {
													"0": "always",
													"1": "never",
													"2": "push_other_teams",
													"3": "push_own_team",
												},
											},
										],
									},
									{ name: "formatting", type: "varint" },
									{ name: "prefix", type: "anonymousNbt" },
									{ name: "suffix", type: "anonymousNbt" },
								],
							],
							change: [
								"container",
								[
									{ name: "name", type: "anonymousNbt" },
									{
										name: "flags",
										type: [
											"bitflags",
											{
												type: "u8",
												flags: ["friendly_fire", "see_friendly_invisible"],
											},
										],
									},
									{
										name: "nameTagVisibility",
										type: [
											"mapper",
											{
												type: "varint",
												mappings: {
													"0": "always",
													"1": "never",
													"2": "hide_for_other_teams",
													"3": "hide_for_own_team",
												},
											},
										],
									},
									{
										name: "collisionRule",
										type: [
											"mapper",
											{
												type: "varint",
												mappings: {
													"0": "always",
													"1": "never",
													"2": "push_other_teams",
													"3": "push_own_team",
												},
											},
										],
									},
									{ name: "formatting", type: "varint" },
									{ name: "prefix", type: "anonymousNbt" },
									{ name: "suffix", type: "anonymousNbt" },
								],
							],
						},
						default: "void",
					},
				],
			},
			{
				name: "players",
				type: [
					"switch",
					{
						compareTo: "mode",
						fields: {
							add: ["array", { countType: "varint", type: "string" }],
							join: ["array", { countType: "varint", type: "string" }],
							leave: ["array", { countType: "varint", type: "string" }],
						},
						default: "void",
					},
				],
			},
		],
	],
	"play.toClient.packet_set_score": [
		"container",
		[
			{ name: "itemName", type: "string" },
			{ name: "scoreName", type: "string" },
			{ name: "value", type: "varint" },
			{ name: "display_name", type: ["option", "anonymousNbt"] },
			{ name: "number_format", type: ["option", "varint"] },
			{
				name: "styling",
				type: [
					"switch",
					{
						compareTo: "number_format",
						fields: { "1": "anonymousNbt", "2": "anonymousNbt" },
						default: "void",
					},
				],
			},
		],
	],
	"play.toClient.packet_set_simulation_distance": [
		"container",
		[{ name: "distance", type: "varint" }],
	],
	"play.toClient.packet_set_subtitle_text": [
		"container",
		[{ name: "text", type: "anonymousNbt" }],
	],
	// 26.1.2: composite(LONG gameTime, map(WorldClock=holderRegistry varint,
	// ClockNetworkState=composite(VAR_LONG, FLOAT, FLOAT)))
	"play.toClient.packet_set_time": [
		"container",
		[
			{ name: "gameTime", type: "i64" },
			{
				name: "clocks",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "clock", type: "varint" },
								{ name: "time", type: "varlong" },
								{ name: "rate", type: "f32" },
								{ name: "phase", type: "f32" },
							],
						],
					},
				],
			},
		],
	],
	"play.toClient.packet_set_title_text": [
		"container",
		[{ name: "text", type: "anonymousNbt" }],
	],
	"play.toClient.packet_set_titles_animation": [
		"container",
		[
			{ name: "fadeIn", type: "i32" },
			{ name: "stay", type: "i32" },
			{ name: "fadeOut", type: "i32" },
		],
	],
	"play.toClient.packet_sound_entity": [
		"container",
		[
			{ name: "sound", type: "ItemSoundHolder" },
			{ name: "soundCategory", type: "soundSource" },
			{ name: "entityId", type: "varint" },
			{ name: "volume", type: "f32" },
			{ name: "pitch", type: "f32" },
			{ name: "seed", type: "i64" },
		],
	],
	"play.toClient.packet_sound": [
		"container",
		[
			{ name: "sound", type: "ItemSoundHolder" },
			{ name: "soundCategory", type: "soundSource" },
			{ name: "x", type: "i32" },
			{ name: "y", type: "i32" },
			{ name: "z", type: "i32" },
			{ name: "volume", type: "f32" },
			{ name: "pitch", type: "f32" },
			{ name: "seed", type: "i64" },
		],
	],
	"play.toClient.packet_start_configuration": ["container", []],
	"play.toClient.packet_stop_sound": [
		"container",
		[
			{ name: "flags", type: "i8" },
			{
				name: "source",
				type: [
					"switch",
					{
						compareTo: "flags",
						fields: { "1": "varint", "3": "varint" },
						default: "void",
					},
				],
			},
			{
				name: "sound",
				type: [
					"switch",
					{
						compareTo: "flags",
						fields: { "2": "string", "3": "string" },
						default: "void",
					},
				],
			},
		],
	],
	"play.toClient.packet_system_chat": [
		"container",
		[
			{ name: "content", type: "anonymousNbt" },
			{ name: "isActionBar", type: "bool" },
		],
	],
	"play.toClient.packet_tab_list": [
		"container",
		[
			{ name: "header", type: "anonymousNbt" },
			{ name: "footer", type: "anonymousNbt" },
		],
	],
	"play.toClient.packet_tag_query": [
		"container",
		[
			{ name: "transactionId", type: "varint" },
			{ name: "nbt", type: "anonOptionalNbt" },
		],
	],
	"play.toClient.packet_take_item_entity": [
		"container",
		[
			{ name: "collectedEntityId", type: "varint" },
			{ name: "collectorEntityId", type: "varint" },
			{ name: "pickupItemCount", type: "varint" },
		],
	],
	"play.toClient.packet_teleport_entity": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "yaw", type: "i8" },
			{ name: "pitch", type: "i8" },
			{ name: "onGround", type: "bool" },
		],
	],
	"play.toClient.packet_test_instance_block_status": [
		"container",
		[
			{ name: "status", type: "anonymousNbt" },
			{ name: "size", type: ["option", "vec3i"] },
		],
	],
	"play.toClient.packet_ticking_state": [
		"container",
		[
			{ name: "tick_rate", type: "f32" },
			{ name: "is_frozen", type: "bool" },
		],
	],
	"play.toClient.packet_ticking_step": [
		"container",
		[{ name: "tick_steps", type: "varint" }],
	],
	"play.toClient.packet_update_advancements": [
		"container",
		[
			{ name: "reset", type: "bool" },
			{
				name: "advancementMapping",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "key", type: "string" },
								{
									name: "value",
									type: [
										"container",
										[
											{ name: "parentId", type: ["option", "string"] },
											{
												name: "displayData",
												type: [
													"option",
													[
														"container",
														[
															{ name: "title", type: "anonymousNbt" },
															{ name: "description", type: "anonymousNbt" },
															{ name: "icon", type: "Slot" },
															{ name: "frameType", type: "varint" },
															{
																name: "flags",
																type: [
																	"bitfield",
																	[
																		{ name: "unused", size: 29, signed: false },
																		{ name: "hidden", size: 1, signed: false },
																		{
																			name: "show_toast",
																			size: 1,
																			signed: false,
																		},
																		{
																			name: "has_background_texture",
																			size: 1,
																			signed: false,
																		},
																	],
																],
															},
															{
																name: "backgroundTexture",
																type: [
																	"switch",
																	{
																		compareTo: "flags/has_background_texture",
																		fields: { "1": "string" },
																		default: "void",
																	},
																],
															},
															{ name: "xCord", type: "f32" },
															{ name: "yCord", type: "f32" },
														],
													],
												],
											},
											{
												name: "requirements",
												type: [
													"array",
													{
														countType: "varint",
														type: [
															"array",
															{ countType: "varint", type: "string" },
														],
													},
												],
											},
											{ name: "sendsTelemetryData", type: "bool" },
										],
									],
								},
							],
						],
					},
				],
			},
			{
				name: "identifiers",
				type: ["array", { countType: "varint", type: "string" }],
			},
			{
				name: "progressMapping",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "key", type: "string" },
								{
									name: "value",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "criterionIdentifier", type: "string" },
													{
														name: "criterionProgress",
														type: ["option", "i64"],
													},
												],
											],
										},
									],
								},
							],
						],
					},
				],
			},
			{ name: "showAdvancements", type: "bool" },
		],
	],
	"play.toClient.packet_update_attributes": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{
				name: "properties",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{
									name: "key",
									type: [
										"mapper",
										{
											type: "varint",
											mappings: {
												"0": "generic.armor",
												"1": "generic.armor_toughness",
												"2": "generic.attack_damage",
												"3": "generic.attack_knockback",
												"4": "generic.attack_speed",
												"5": "player.block_break_speed",
												"6": "player.block_interaction_range",
												"7": "burning_time",
												"8": "camera_distance",
												"9": "explosion_knockback_resistance",
												"10": "player.entity_interaction_range",
												"11": "generic.fall_damage_multiplier",
												"12": "generic.flying_speed",
												"13": "generic.follow_range",
												"14": "generic.gravity",
												"15": "generic.jump_strength",
												"16": "generic.knockback_resistance",
												"17": "generic.luck",
												"18": "generic.max_absorption",
												"19": "generic.max_health",
												"20": "generic.movement_speed",
												"21": "generic.safe_fall_distance",
												"22": "generic.scale",
												"23": "zombie.spawn_reinforcements",
												"24": "generic.step_height",
												"25": "submerged_mining_speed",
												"26": "sweeping_damage_ratio",
												"27": "tempt_range",
												"28": "water_movement_efficiency",
												"29": "waypoint_transmit_range",
												"30": "waypoint_receive_range",
											},
										},
									],
								},
								{ name: "value", type: "f64" },
								{
									name: "modifiers",
									type: [
										"array",
										{
											countType: "varint",
											type: [
												"container",
												[
													{ name: "uuid", type: "string" },
													{ name: "amount", type: "f64" },
													{ name: "operation", type: "i8" },
												],
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
	],
	"play.toClient.packet_update_mob_effect": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "effectId", type: "varint" },
			{ name: "amplifier", type: "varint" },
			{ name: "duration", type: "varint" },
			{ name: "flags", type: "u8" },
		],
	],
	"play.toClient.packet_update_recipes": [
		"container",
		// 26.1.2: recipe-book UI payload (RecipeDisplay/RecipePropertySet type system),
		// unused by the bot — read opaque so it decodes cleanly and stays stream-aligned.
		[{ name: "data", type: "restBuffer" }],
	],
	"play.toClient.packet_update_tags": [
		"container",
		[
			{
				name: "tags",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "tagType", type: "string" },
								{ name: "tags", type: "tags" },
							],
						],
					},
				],
			},
		],
	],
	"play.toClient.packet_projectile_power": [
		"container",
		[
			{ name: "id", type: "varint" },
			{ name: "accelerationPower", type: "f64" },
		],
	],
	"play.toClient.packet_waypoint": [
		"container",
		[
			{ name: "operation", type: "varint" },
			{ name: "hasUUID", type: "bool" },
			{
				name: "uuid",
				type: [
					"switch",
					{ compareTo: "hasUUID", fields: { true: "UUID" }, default: "void" },
				],
			},
			{ name: "style", type: "string" },
			{ name: "hasColor", type: "bool" },
			{
				name: "color",
				type: [
					"switch",
					{ compareTo: "hasColor", fields: { true: "i32" }, default: "void" },
				],
			},
			{ name: "type", type: "varint" },
			{ name: "x", type: "varint" },
			{ name: "y", type: "varint" },
			{ name: "z", type: "varint" },
		],
	],
	"play.toClient.packet_show_dialog": [
		"container",
		[
			{
				name: "dialog",
				type: [
					"registryEntryHolder",
					{
						baseName: "dialog",
						otherwise: { name: "data", type: "anonymousNbt" },
					},
				],
			},
		],
	],

	// play.toServer
	"play.toServer.packet_accept_teleportation": [
		"container",
		[{ name: "teleportId", type: "varint" }],
	],
	"play.toServer.packet_block_entity_tag_query": [
		"container",
		[
			{ name: "transactionId", type: "varint" },
			{ name: "location", type: "position" },
		],
	],
	"play.toServer.packet_bundle_item_selected": [
		"container",
		[
			{ name: "slotId", type: "varint" },
			{ name: "selectedItemIndex", type: "varint" },
		],
	],
	"play.toServer.packet_change_difficulty": [
		"container",
		[
			{
				name: "newDifficulty",
				type: [
					"mapper",
					{
						type: "varint",
						mappings: {
							"0": "peaceful",
							"1": "easy",
							"2": "normal",
							"3": "hard",
						},
					},
				],
			},
		],
	],
	"play.toServer.packet_change_game_mode": [
		"container",
		[
			{
				name: "mode",
				type: [
					"mapper",
					{
						type: "varint",
						mappings: {
							"0": "survival",
							"1": "creative",
							"2": "adventure",
							"3": "spectator",
						},
					},
				],
			},
		],
	],
	"play.toServer.packet_chat_ack": [
		"container",
		[{ name: "count", type: "varint" }],
	],
	"play.toServer.packet_chat_command": [
		"container",
		[{ name: "command", type: "string" }],
	],
	"play.toServer.packet_chat_command_signed": [
		"container",
		[
			{ name: "command", type: "string" },
			{ name: "timestamp", type: "i64" },
			{ name: "salt", type: "i64" },
			{
				name: "argumentSignatures",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "argumentName", type: "string" },
								{ name: "signature", type: ["buffer", { count: 256 }] },
							],
						],
					},
				],
			},
			{ name: "messageCount", type: "varint" },
			{ name: "acknowledged", type: ["buffer", { count: 3 }] },
			{ name: "checksum", type: "i8" },
		],
	],
	"play.toServer.packet_chat": [
		"container",
		[
			{ name: "message", type: "string" },
			{ name: "timestamp", type: "i64" },
			{ name: "salt", type: "i64" },
			{ name: "signature", type: ["option", ["buffer", { count: 256 }]] },
			{ name: "offset", type: "varint" },
			{ name: "acknowledged", type: ["buffer", { count: 3 }] },
			{ name: "checksum", type: "u8" },
		],
	],
	"play.toServer.packet_chat_session_update": [
		"container",
		[
			{ name: "sessionUUID", type: "UUID" },
			{ name: "expireTime", type: "i64" },
			{ name: "publicKey", type: "ByteArray" },
			{ name: "signature", type: "ByteArray" },
		],
	],
	"play.toServer.packet_chunk_batch_received": [
		"container",
		[{ name: "chunksPerTick", type: "f32" }],
	],
	"play.toServer.packet_client_command": [
		"container",
		[{ name: "actionId", type: "varint" }],
	],
	"play.toServer.packet_client_tick_end": ["container", []],
	"play.toServer.packet_command_suggestion": [
		"container",
		[
			{ name: "transactionId", type: "varint" },
			{ name: "text", type: "string" },
		],
	],
	"play.toServer.packet_configuration_acknowledged": ["container", []],
	"play.toServer.packet_container_button_click": [
		"container",
		[
			{ name: "windowId", type: "ContainerID" },
			{ name: "enchantment", type: "i8" },
		],
	],
	"play.toServer.packet_container_click": [
		"container",
		[
			{ name: "windowId", type: "ContainerID" },
			{ name: "stateId", type: "varint" },
			{ name: "slot", type: "i16" },
			{ name: "mouseButton", type: "i8" },
			{ name: "mode", type: "varint" },
			{
				name: "changedSlots",
				type: [
					"array",
					{
						countType: "varint",
						type: [
							"container",
							[
								{ name: "location", type: "i16" },
								{ name: "item", type: ["option", "HashedSlot"] },
							],
						],
					},
				],
			},
			{ name: "cursorItem", type: ["option", "HashedSlot"] },
		],
	],
	"play.toServer.packet_container_close": [
		"container",
		[{ name: "windowId", type: "ContainerID" }],
	],
	"play.toServer.packet_container_slot_state_changed": [
		"container",
		[
			{ name: "slot_id", type: "varint" },
			{ name: "window_id", type: "ContainerID" },
			{ name: "state", type: "bool" },
		],
	],
	"play.toServer.packet_custom_payload": [
		"container",
		[
			{ name: "channel", type: "string" },
			{ name: "data", type: "restBuffer" },
		],
	],
	"play.toServer.packet_debug_subscription_request": [
		"container",
		[
			{
				name: "subscriptions",
				type: [
					"array",
					{ countType: "varint", type: "DebugSubscriptionDataType" },
				],
			},
		],
	],
	"play.toServer.packet_edit_book": [
		"container",
		[
			{ name: "hand", type: "varint" },
			{
				name: "pages",
				type: ["array", { countType: "varint", type: "string" }],
			},
			{ name: "title", type: ["option", "string"] },
		],
	],
	"play.toServer.packet_entity_tag_query": [
		"container",
		[
			{ name: "transactionId", type: "varint" },
			{ name: "entityId", type: "varint" },
		],
	],
	"play.toServer.packet_interact": [
		"container",
		[
			{ name: "target", type: "varint" },
			{ name: "mouse", type: "varint" },
			{
				name: "x",
				type: [
					"switch",
					{ compareTo: "mouse", fields: { "2": "f32" }, default: "void" },
				],
			},
			{
				name: "y",
				type: [
					"switch",
					{ compareTo: "mouse", fields: { "2": "f32" }, default: "void" },
				],
			},
			{
				name: "z",
				type: [
					"switch",
					{ compareTo: "mouse", fields: { "2": "f32" }, default: "void" },
				],
			},
			{
				name: "hand",
				type: [
					"switch",
					{
						compareTo: "mouse",
						fields: { "0": "varint", "2": "varint" },
						default: "void",
					},
				],
			},
			{ name: "sneaking", type: "bool" },
		],
	],
	"play.toServer.packet_jigsaw_generate": [
		"container",
		[
			{ name: "location", type: "position" },
			{ name: "levels", type: "varint" },
			{ name: "keepJigsaws", type: "bool" },
		],
	],
	"play.toServer.packet_keep_alive": [
		"container",
		[{ name: "keepAliveId", type: "i64" }],
	],
	"play.toServer.packet_lock_difficulty": [
		"container",
		[{ name: "locked", type: "bool" }],
	],
	"play.toServer.packet_move_player_pos": [
		"container",
		[
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "flags", type: "MovementFlags" },
		],
	],
	"play.toServer.packet_move_player_pos_rot": [
		"container",
		[
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "yaw", type: "f32" },
			{ name: "pitch", type: "f32" },
			{ name: "flags", type: "MovementFlags" },
		],
	],
	"play.toServer.packet_move_player_rot": [
		"container",
		[
			{ name: "yaw", type: "f32" },
			{ name: "pitch", type: "f32" },
			{ name: "flags", type: "MovementFlags" },
		],
	],
	"play.toServer.packet_move_player_status_only": [
		"container",
		[{ name: "flags", type: "MovementFlags" }],
	],
	"play.toServer.packet_move_vehicle": [
		"container",
		[
			{ name: "x", type: "f64" },
			{ name: "y", type: "f64" },
			{ name: "z", type: "f64" },
			{ name: "yaw", type: "f32" },
			{ name: "pitch", type: "f32" },
			{ name: "onGround", type: "bool" },
		],
	],
	"play.toServer.packet_paddle_boat": [
		"container",
		[
			{ name: "leftPaddle", type: "bool" },
			{ name: "rightPaddle", type: "bool" },
		],
	],
	"play.toServer.packet_pick_item_from_block": [
		"container",
		[
			{ name: "position", type: "position" },
			{ name: "includeData", type: "bool" },
		],
	],
	"play.toServer.packet_pick_item_from_entity": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "includeData", type: "bool" },
		],
	],
	"play.toServer.packet_ping_request": [
		"container",
		[{ name: "id", type: "i64" }],
	],
	"play.toServer.packet_place_recipe": [
		"container",
		[
			{ name: "windowId", type: "ContainerID" },
			{ name: "recipeId", type: "varint" },
			{ name: "makeAll", type: "bool" },
		],
	],
	"play.toServer.packet_player_abilities": [
		"container",
		[{ name: "flags", type: "i8" }],
	],
	"play.toServer.packet_player_action": [
		"container",
		[
			{ name: "status", type: "varint" },
			{ name: "location", type: "position" },
			{ name: "face", type: "i8" },
			{ name: "sequence", type: "varint" },
		],
	],
	"play.toServer.packet_player_command": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{
				name: "actionId",
				type: [
					"mapper",
					{
						type: "varint",
						mappings: {
							"0": "leave_bed",
							"1": "start_sprinting",
							"2": "stop_sprinting",
							"3": "start_horse_jump",
							"4": "stop_horse_jump",
							"5": "open_vehicle_inventory",
							"6": "start_elytra_flying",
						},
					},
				],
			},
			{ name: "jumpBoost", type: "varint" },
		],
	],
	"play.toServer.packet_player_input": [
		"container",
		[
			{
				name: "inputs",
				type: [
					"bitflags",
					{
						type: "u8",
						flags: [
							"forward",
							"backward",
							"left",
							"right",
							"jump",
							"shift",
							"sprint",
						],
					},
				],
			},
		],
	],
	"play.toServer.packet_player_loaded": ["container", []],
	"play.toServer.packet_pong": ["container", [{ name: "id", type: "i32" }]],
	"play.toServer.packet_recipe_book_change_settings": [
		"container",
		[
			{ name: "bookId", type: "varint" },
			{ name: "bookOpen", type: "bool" },
			{ name: "filterActive", type: "bool" },
		],
	],
	"play.toServer.packet_recipe_book_seen_recipe": [
		"container",
		[{ name: "recipeId", type: "varint" }],
	],
	"play.toServer.packet_rename_item": [
		"container",
		[{ name: "name", type: "string" }],
	],
	"play.toServer.packet_resource_pack": [
		"container",
		[
			{ name: "uuid", type: "UUID" },
			{ name: "result", type: "varint" },
		],
	],
	"play.toServer.packet_seen_advancements": [
		"container",
		[
			{ name: "action", type: "varint" },
			{
				name: "tabId",
				type: [
					"switch",
					{ compareTo: "action", fields: { "0": "string", "1": "void" } },
				],
			},
		],
	],
	"play.toServer.packet_select_trade": [
		"container",
		[{ name: "slot", type: "varint" }],
	],
	"play.toServer.packet_set_beacon": [
		"container",
		[
			{ name: "primary_effect", type: ["option", "varint"] },
			{ name: "secondary_effect", type: ["option", "varint"] },
		],
	],
	"play.toServer.packet_set_carried_item": [
		"container",
		[{ name: "slotId", type: "i16" }],
	],
	"play.toServer.packet_set_command_block": [
		"container",
		[
			{ name: "location", type: "position" },
			{ name: "command", type: "string" },
			{ name: "mode", type: "varint" },
			{ name: "flags", type: "u8" },
		],
	],
	"play.toServer.packet_set_command_minecart": [
		"container",
		[
			{ name: "entityId", type: "varint" },
			{ name: "command", type: "string" },
			{ name: "track_output", type: "bool" },
		],
	],
	"play.toServer.packet_set_creative_mode_slot": [
		"container",
		[
			{ name: "slot", type: "i16" },
			{ name: "item", type: "UntrustedSlot" },
		],
	],
	"play.toServer.packet_set_jigsaw_block": [
		"container",
		[
			{ name: "location", type: "position" },
			{ name: "name", type: "string" },
			{ name: "target", type: "string" },
			{ name: "pool", type: "string" },
			{ name: "finalState", type: "string" },
			{ name: "jointType", type: "string" },
			{ name: "selection_priority", type: "varint" },
			{ name: "placement_priority", type: "varint" },
		],
	],
	"play.toServer.packet_set_structure_block": [
		"container",
		[
			{ name: "location", type: "position" },
			{ name: "action", type: "varint" },
			{ name: "mode", type: "varint" },
			{ name: "name", type: "string" },
			{ name: "offset_x", type: "i8" },
			{ name: "offset_y", type: "i8" },
			{ name: "offset_z", type: "i8" },
			{ name: "size_x", type: "i8" },
			{ name: "size_y", type: "i8" },
			{ name: "size_z", type: "i8" },
			{ name: "mirror", type: "varint" },
			{ name: "rotation", type: "varint" },
			{ name: "metadata", type: "string" },
			{ name: "integrity", type: "f32" },
			{ name: "seed", type: "varint" },
			{
				name: "flags",
				type: [
					"mapper",
					{
						type: "u8",
						mappings: {
							"0": "ignore_entities",
							"1": "show_air",
							"2": "show_bounding_box",
							"3": "strict",
						},
					},
				],
			},
		],
	],
	"play.toServer.packet_set_test_block": [
		"container",
		[
			{ name: "position", type: "position" },
			{ name: "mode", type: "varint" },
			{ name: "message", type: "string" },
		],
	],
	"play.toServer.packet_sign_update": [
		"container",
		[
			{ name: "location", type: "position" },
			{ name: "isFrontText", type: "bool" },
			{ name: "text1", type: "string" },
			{ name: "text2", type: "string" },
			{ name: "text3", type: "string" },
			{ name: "text4", type: "string" },
		],
	],
	"play.toServer.packet_swing": [
		"container",
		[{ name: "hand", type: "varint" }],
	],
	"play.toServer.packet_teleport_to_entity": [
		"container",
		[{ name: "target", type: "UUID" }],
	],
	"play.toServer.packet_test_instance_block_action": [
		"container",
		[
			{ name: "pos", type: "position" },
			{ name: "action", type: "varint" },
			{
				name: "data",
				type: [
					"container",
					[
						{ name: "test", type: ["option", "string"] },
						{ name: "size", type: "vec3i" },
						{ name: "rotation", type: "varint" },
						{ name: "ignoreEntities", type: "bool" },
						{ name: "status", type: "varint" },
						{ name: "errorMessage", type: ["option", "anonymousNbt"] },
					],
				],
			},
		],
	],
	"play.toServer.packet_use_item_on": [
		"container",
		[
			{ name: "hand", type: "varint" },
			{ name: "location", type: "position" },
			{ name: "direction", type: "varint" },
			{ name: "cursorX", type: "f32" },
			{ name: "cursorY", type: "f32" },
			{ name: "cursorZ", type: "f32" },
			{ name: "insideBlock", type: "bool" },
			{ name: "worldBorderHit", type: "bool" },
			{ name: "sequence", type: "varint" },
		],
	],
	"play.toServer.packet_use_item": [
		"container",
		[
			{ name: "hand", type: "varint" },
			{ name: "sequence", type: "varint" },
			{ name: "rotation", type: "vec2f" },
		],
	],
};
