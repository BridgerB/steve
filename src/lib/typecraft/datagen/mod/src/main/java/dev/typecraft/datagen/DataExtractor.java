package dev.typecraft.datagen;

import com.google.gson.*;
import net.fabricmc.api.DedicatedServerModInitializer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.tags.BlockTags;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.shapes.VoxelShape;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.*;

/**
 * Extracts all game data from Minecraft registries and writes to JSON files.
 * Runs on dedicated server startup, writes data, then exits.
 */
public class DataExtractor implements DedicatedServerModInitializer {

	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final File OUTPUT_DIR = new File("typecraft-data");

	@Override
	public void onInitializeServer() {
		System.out.println("[typecraft-datagen] Starting data extraction...");
		OUTPUT_DIR.mkdirs();

		try {
			extractBlocks();
			extractBlockCollisionShapes();
			extractItems();
			extractEntities();
			extractEffects();
			extractAttributes();
			extractProtocol();
			System.out.println("[typecraft-datagen] Data extraction complete!");
		} catch (Exception e) {
			System.err.println("[typecraft-datagen] ERROR: " + e.getMessage());
			e.printStackTrace();
		}

		System.exit(0);
	}

	// ── Blocks ──

	private void extractBlocks() throws IOException {
		JsonArray blocks = new JsonArray();

		for (Block block : BuiltInRegistries.BLOCK) {
			Identifier id = BuiltInRegistries.BLOCK.getKey(block);
			BlockState defaultState = block.defaultBlockState();

			JsonObject obj = new JsonObject();
			obj.addProperty("id", BuiltInRegistries.BLOCK.getId(block));
			obj.addProperty("name", id.getPath());
			obj.addProperty("displayName", block.getName().getString());

			float hardness = defaultState.getDestroySpeed(EmptyBlockGetter.INSTANCE, BlockPos.ZERO);
			obj.addProperty("hardness", hardness);
			obj.addProperty("resistance", block.getExplosionResistance());
			obj.addProperty("stackSize", new ItemStack(block.asItem()).getMaxStackSize());
			obj.addProperty("diggable", hardness >= 0);

			VoxelShape shape = defaultState.getCollisionShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO);
			obj.addProperty("boundingBox", shape.isEmpty() ? "empty" : "block");
			obj.addProperty("transparent", !defaultState.isSolidRender());
			obj.addProperty("emitLight", defaultState.getLightEmission());
			obj.addProperty("filterLight", defaultState.getLightBlock());

			// State IDs
			int minStateId = Integer.MAX_VALUE;
			int maxStateId = Integer.MIN_VALUE;
			for (BlockState state : block.getStateDefinition().getPossibleStates()) {
				int stateId = Block.getId(state);
				minStateId = Math.min(minStateId, stateId);
				maxStateId = Math.max(maxStateId, stateId);
			}
			obj.addProperty("defaultState", Block.getId(defaultState));
			obj.addProperty("minStateId", minStateId);
			obj.addProperty("maxStateId", maxStateId);

			// Properties
			JsonArray states = new JsonArray();
			for (Property<?> prop : block.getStateDefinition().getProperties()) {
				JsonObject propObj = new JsonObject();
				propObj.addProperty("name", prop.getName());
				propObj.addProperty("type", getPropertyType(prop));
				List<?> values = prop.getPossibleValues();
				propObj.addProperty("num_values", values.size());
				JsonArray vals = new JsonArray();
				for (Object v : values) vals.add(v.toString());
				states.add(propObj);
				propObj.add("values", vals);
			}
			obj.add("states", states);
			obj.add("drops", new JsonArray());

			// Material tag
			String material = getMaterial(defaultState);
			if (material != null) obj.addProperty("material", material);

			blocks.add(obj);
		}

		writeJson("blocks.json", blocks);
		System.out.println("[typecraft-datagen] Extracted " + blocks.size() + " blocks");
	}

	private String getPropertyType(Property<?> prop) {
		String className = prop.getClass().getSimpleName().toLowerCase();
		if (className.contains("bool")) return "bool";
		if (className.contains("int")) return "int";
		if (className.contains("enum")) return "enum";
		if (className.contains("direction")) return "direction";
		return "enum";
	}

	private String getMaterial(BlockState state) {
		if (state.is(BlockTags.MINEABLE_WITH_PICKAXE)) return "mineable/pickaxe";
		if (state.is(BlockTags.MINEABLE_WITH_AXE)) return "mineable/axe";
		if (state.is(BlockTags.MINEABLE_WITH_SHOVEL)) return "mineable/shovel";
		if (state.is(BlockTags.MINEABLE_WITH_HOE)) return "mineable/hoe";
		return null;
	}

	// ── Collision Shapes ──

	private void extractBlockCollisionShapes() throws IOException {
		Map<String, Integer> shapeIndex = new LinkedHashMap<>();
		JsonObject blockShapeMap = new JsonObject();
		JsonObject shapeArrays = new JsonObject();
		int nextShapeId = 0;

		for (Block block : BuiltInRegistries.BLOCK) {
			Identifier id = BuiltInRegistries.BLOCK.getKey(block);
			List<BlockState> blockStates = block.getStateDefinition().getPossibleStates();

			if (blockStates.size() == 1) {
				String shapeKey = shapeToString(blockStates.get(0));
				if (!shapeIndex.containsKey(shapeKey)) {
					shapeIndex.put(shapeKey, nextShapeId);
					shapeArrays.add(String.valueOf(nextShapeId), parseShapeString(shapeKey));
					nextShapeId++;
				}
				blockShapeMap.addProperty(id.getPath(), shapeIndex.get(shapeKey));
			} else {
				JsonArray stateShapes = new JsonArray();
				for (BlockState state : blockStates) {
					String shapeKey = shapeToString(state);
					if (!shapeIndex.containsKey(shapeKey)) {
						shapeIndex.put(shapeKey, nextShapeId);
						shapeArrays.add(String.valueOf(nextShapeId), parseShapeString(shapeKey));
						nextShapeId++;
					}
					stateShapes.add(shapeIndex.get(shapeKey));
				}
				blockShapeMap.add(id.getPath(), stateShapes);
			}
		}

		JsonObject result = new JsonObject();
		result.add("blocks", blockShapeMap);
		result.add("shapes", shapeArrays);
		writeJson("blockCollisionShapes.json", result);
		System.out.println("[typecraft-datagen] Extracted " + shapeIndex.size() + " unique shapes");
	}

	private String shapeToString(BlockState state) {
		VoxelShape shape = state.getCollisionShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO);
		if (shape.isEmpty()) return "[]";
		StringBuilder sb = new StringBuilder("[");
		for (var aabb : shape.toAabbs()) {
			if (sb.length() > 1) sb.append(",");
			sb.append(String.format("[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f]",
				aabb.minX, aabb.minY, aabb.minZ, aabb.maxX, aabb.maxY, aabb.maxZ));
		}
		sb.append("]");
		return sb.toString();
	}

	private JsonArray parseShapeString(String shapeStr) {
		JsonArray arr = new JsonArray();
		if (shapeStr.equals("[]")) return arr;
		String inner = shapeStr.substring(1, shapeStr.length() - 1);
		for (String box : inner.split("\\],\\[")) {
			box = box.replace("[", "").replace("]", "");
			String[] parts = box.split(",");
			JsonArray boxArr = new JsonArray();
			for (String p : parts) boxArr.add(Double.parseDouble(p.trim()));
			arr.add(boxArr);
		}
		return arr;
	}

	// ── Items ──

	private void extractItems() throws IOException {
		JsonArray items = new JsonArray();
		for (Item item : BuiltInRegistries.ITEM) {
			Identifier id = BuiltInRegistries.ITEM.getKey(item);
			ItemStack stack = new ItemStack(item);
			JsonObject obj = new JsonObject();
			obj.addProperty("id", BuiltInRegistries.ITEM.getId(item));
			obj.addProperty("name", id.getPath());
			obj.addProperty("displayName", item.getName(stack).getString());
			obj.addProperty("stackSize", stack.getMaxStackSize());
			obj.addProperty("maxDurability", stack.getMaxDamage());
			items.add(obj);
		}
		writeJson("items.json", items);
		System.out.println("[typecraft-datagen] Extracted " + items.size() + " items");
	}

	// ── Entities ──

	private void extractEntities() throws IOException {
		JsonArray entities = new JsonArray();
		for (EntityType<?> type : BuiltInRegistries.ENTITY_TYPE) {
			Identifier id = BuiltInRegistries.ENTITY_TYPE.getKey(type);
			JsonObject obj = new JsonObject();
			obj.addProperty("id", BuiltInRegistries.ENTITY_TYPE.getId(type));
			obj.addProperty("name", id.getPath());
			obj.addProperty("displayName", type.getDescription().getString());
			obj.addProperty("width", type.getWidth());
			obj.addProperty("height", type.getHeight());
			obj.addProperty("type", type.getCategory().getName());
			entities.add(obj);
		}
		writeJson("entities.json", entities);
		System.out.println("[typecraft-datagen] Extracted " + entities.size() + " entities");
	}

	// ── Effects ──

	private void extractEffects() throws IOException {
		JsonArray effects = new JsonArray();
		for (MobEffect effect : BuiltInRegistries.MOB_EFFECT) {
			Identifier id = BuiltInRegistries.MOB_EFFECT.getKey(effect);
			JsonObject obj = new JsonObject();
			obj.addProperty("id", BuiltInRegistries.MOB_EFFECT.getId(effect));
			obj.addProperty("name", id.getPath());
			obj.addProperty("displayName", effect.getDescriptionId());
			obj.addProperty("type", effect.isBeneficial() ? "good" : "bad");
			effects.add(obj);
		}
		writeJson("effects.json", effects);
		System.out.println("[typecraft-datagen] Extracted " + effects.size() + " effects");
	}

	// ── Attributes ──

	private void extractAttributes() throws IOException {
		JsonArray attributes = new JsonArray();
		for (Attribute attr : BuiltInRegistries.ATTRIBUTE) {
			Identifier id = BuiltInRegistries.ATTRIBUTE.getKey(attr);
			JsonObject obj = new JsonObject();
			obj.addProperty("resource", id.toString());
			obj.addProperty("name", id.getPath());
			obj.addProperty("default", attr.getDefaultValue());
			obj.addProperty("description", attr.getDescriptionId());
			attributes.add(obj);
		}
		writeJson("attributes.json", attributes);
		System.out.println("[typecraft-datagen] Extracted " + attributes.size() + " attributes");
	}

	// ── Protocol ──

	private void extractProtocol() throws IOException {
		JsonObject protocol = new JsonObject();

		// Shared types — map known Java types to ProtoDef names
		JsonObject sharedTypes = new JsonObject();
		// These are the primitives our codec.ts understands
		protocol.add("types", sharedTypes);

		// Extract packets per connection state
		extractPacketsFromClass(protocol, "play", "toClient",
			net.minecraft.network.protocol.game.GamePacketTypes.class, "CLIENTBOUND_");
		extractPacketsFromClass(protocol, "play", "toServer",
			net.minecraft.network.protocol.game.GamePacketTypes.class, "SERVERBOUND_");
		extractPacketsFromClass(protocol, "login", "toClient",
			net.minecraft.network.protocol.login.LoginPacketTypes.class, "CLIENTBOUND_");
		extractPacketsFromClass(protocol, "login", "toServer",
			net.minecraft.network.protocol.login.LoginPacketTypes.class, "SERVERBOUND_");
		extractPacketsFromClass(protocol, "status", "toClient",
			net.minecraft.network.protocol.status.StatusPacketTypes.class, "CLIENTBOUND_");
		extractPacketsFromClass(protocol, "status", "toServer",
			net.minecraft.network.protocol.status.StatusPacketTypes.class, "SERVERBOUND_");
		extractPacketsFromClass(protocol, "configuration", "toClient",
			net.minecraft.network.protocol.configuration.ConfigurationPacketTypes.class, "CLIENTBOUND_");
		extractPacketsFromClass(protocol, "configuration", "toServer",
			net.minecraft.network.protocol.configuration.ConfigurationPacketTypes.class, "SERVERBOUND_");

		writeJson("protocol.json", protocol);
		System.out.println("[typecraft-datagen] Extracted protocol definitions");
	}

	@SuppressWarnings("unchecked")
	private void extractPacketsFromClass(JsonObject protocol, String state, String direction,
			Class<?> packetTypesClass, String prefix) {
		// Ensure state + direction objects exist
		if (!protocol.has(state)) protocol.add(state, new JsonObject());
		JsonObject stateObj = protocol.getAsJsonObject(state);
		if (!stateObj.has(direction)) stateObj.add(direction, new JsonObject());
		JsonObject dirObj = stateObj.getAsJsonObject(direction);
		if (!dirObj.has("types")) dirObj.add("types", new JsonObject());
		JsonObject types = dirObj.getAsJsonObject("types");

		int count = 0;
		try {
			for (var field : packetTypesClass.getDeclaredFields()) {
				if (!java.lang.reflect.Modifier.isStatic(field.getModifiers())) continue;
				if (!field.getName().startsWith(prefix)) continue;
				if (!net.minecraft.network.protocol.PacketType.class.isAssignableFrom(field.getType())) continue;

				field.setAccessible(true);
				var packetType = (net.minecraft.network.protocol.PacketType<?>) field.get(null);
				String packetName = packetType.id().getPath();

				// Get the packet class from the generic type
				var genericType = field.getGenericType();
				Class<?> packetClass = null;
				if (genericType instanceof java.lang.reflect.ParameterizedType pt) {
					var typeArg = pt.getActualTypeArguments()[0];
					if (typeArg instanceof Class<?> c) {
						packetClass = c;
					}
				}

				if (packetClass == null) continue;

				// Extract fields from packet class
				JsonArray fields = new JsonArray();
				for (var pField : packetClass.getDeclaredFields()) {
					if (java.lang.reflect.Modifier.isStatic(pField.getModifiers())) continue;
					if (java.lang.reflect.Modifier.isTransient(pField.getModifiers())) continue;

					JsonObject fieldObj = new JsonObject();
					fieldObj.addProperty("name", pField.getName());
					fieldObj.addProperty("type", mapJavaTypeToProtocol(pField.getType(), pField.getGenericType()));
					fields.add(fieldObj);
				}

				// Build ProtoDef-style container
				JsonArray container = new JsonArray();
				container.add("container");
				container.add(fields);

				types.add("packet_" + packetName, container);
				count++;
			}
		} catch (Exception e) {
			System.err.println("[typecraft-datagen] Error extracting packets from " + packetTypesClass.getSimpleName() + ": " + e.getMessage());
		}
		System.out.println("[typecraft-datagen] Extracted " + count + " " + state + " " + direction + " packets");
	}

	private String mapJavaTypeToProtocol(Class<?> type, java.lang.reflect.Type genericType) {
		// Primitives
		if (type == int.class || type == Integer.class) return "varint";
		if (type == long.class || type == Long.class) return "varlong";
		if (type == short.class || type == Short.class) return "i16";
		if (type == byte.class || type == Byte.class) return "i8";
		if (type == boolean.class || type == Boolean.class) return "bool";
		if (type == float.class || type == Float.class) return "f32";
		if (type == double.class || type == Double.class) return "f64";
		if (type == String.class) return "string";
		if (type == java.util.UUID.class) return "UUID";
		if (type == byte[].class) return "restBuffer";

		// Minecraft types
		String name = type.getSimpleName();
		if (name.equals("ItemStack")) return "Slot";
		if (name.equals("BlockPos")) return "position";
		if (name.equals("Component") || name.equals("MutableComponent")) return "anonymousNbt";
		if (name.equals("CompoundTag") || name.equals("Tag")) return "anonymousNbt";
		if (name.equals("FriendlyByteBuf") || name.equals("RegistryFriendlyByteBuf")) return "restBuffer";
		if (name.equals("ResourceLocation") || name.equals("Identifier")) return "string";
		if (name.equals("ResourceKey")) return "string";
		if (name.equals("GlobalPos")) return "GlobalPos";
		if (name.equals("SectionPos")) return "position";
		if (name.equals("ChunkPos")) return "position";
		if (name.equals("Vec3")) return "vec3f";

		// Collections → arrays
		if (java.util.List.class.isAssignableFrom(type) || java.util.Collection.class.isAssignableFrom(type)) {
			return "array";
		}
		if (java.util.Set.class.isAssignableFrom(type)) return "array";
		if (java.util.Map.class.isAssignableFrom(type)) return "array";
		if (type.isArray()) return "array";

		// Optional
		if (java.util.Optional.class.isAssignableFrom(type)) return "option";
		if (java.util.OptionalInt.class == type) return "optvarint";

		// Enums → varint (ordinal)
		if (type.isEnum()) return "varint";

		// Fallback — use the class name as a custom type
		return "container";
	}

	// ── Utilities ──

	private void writeJson(String filename, JsonElement data) throws IOException {
		File file = new File(OUTPUT_DIR, filename);
		try (FileWriter writer = new FileWriter(file)) {
			GSON.toJson(data, writer);
		}
	}
}
