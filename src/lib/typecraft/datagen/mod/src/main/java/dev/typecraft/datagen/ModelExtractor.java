package dev.typecraft.datagen;

import com.google.gson.*;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.SharedConstants;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.LayerDefinitions;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.server.Bootstrap;

import java.io.File;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Standalone extractor for block-entity / entity model geometry.
 *
 * Runs as a plain JVM main (not a Fabric mod) so it can load client-only
 * classes — Fabric's loader blocks {@code net.minecraft.client.*} in a
 * dedicated-server environment, but a raw JVM has no such guard.
 *
 * For each model layer we bake the mesh ({@code LayerDefinition.bakeRoot()})
 * and render it through a fake {@link VertexConsumer}. Minecraft itself does
 * all the part-hierarchy transforms and UV unwrapping; we just collect the
 * final vertices. Output: per layer, a list of quads, each quad four
 * [x, y, z, u, v] vertices (u,v normalized to the model's texture sheet).
 *
 * Usage: ModelExtractor <output.json>
 */
public final class ModelExtractor {

	private static final Gson GSON = new GsonBuilder().create();

	/** Collects every vertex Minecraft's render code emits. */
	private static final class Collector implements VertexConsumer {
		final List<float[]> verts = new ArrayList<>();
		private float[] cur;

		@Override
		public VertexConsumer addVertex(float x, float y, float z) {
			cur = new float[] { x, y, z, 0, 0 };
			verts.add(cur);
			return this;
		}

		@Override
		public VertexConsumer setUv(float u, float v) {
			if (cur != null) {
				cur[3] = u;
				cur[4] = v;
			}
			return this;
		}

		@Override public VertexConsumer setColor(int r, int g, int b, int a) { return this; }
		@Override public VertexConsumer setColor(int rgba) { return this; }
		@Override public VertexConsumer setUv1(int u, int v) { return this; }
		@Override public VertexConsumer setUv2(int u, int v) { return this; }
		@Override public VertexConsumer setNormal(float x, float y, float z) { return this; }
		@Override public VertexConsumer setLineWidth(float w) { return this; }
	}

	public static void main(String[] args) throws Exception {
		String outPath = args.length > 0 ? args[0] : "blockEntityModels.json";

		SharedConstants.tryDetectVersion();
		Bootstrap.bootStrap();

		Map<ModelLayerLocation, LayerDefinition> roots = LayerDefinitions.createRoots();

		JsonObject out = new JsonObject();
		int ok = 0;
		for (var entry : roots.entrySet()) {
			try {
				ModelPart root = entry.getValue().bakeRoot();
				Collector c = new Collector();
				root.render(new PoseStack(), c, 0, 0);
				if (c.verts.isEmpty()) continue;

				// Vertices arrive 4 per quad. Drop quads with non-finite values
				// (degenerate geometry) — NaN/Infinity is not valid JSON.
				JsonArray quads = new JsonArray();
				for (int i = 0; i + 3 < c.verts.size(); i += 4) {
					JsonArray quad = new JsonArray();
					boolean bad = false;
					for (int j = 0; j < 4 && !bad; j++) {
						float[] vtx = c.verts.get(i + j);
						JsonArray v = new JsonArray();
						for (float f : vtx) {
							if (!Float.isFinite(f)) { bad = true; break; }
							v.add(f);
						}
						quad.add(v);
					}
					if (!bad) quads.add(quad);
				}
				if (quads.size() > 0) {
					out.add(entry.getKey().toString(), quads);
					ok++;
				}
			} catch (Throwable t) {
				System.err.println("[model-extractor] skip " + entry.getKey() + ": " + t);
			}
		}

		try (FileWriter w = new FileWriter(new File(outPath))) {
			GSON.toJson(out, w);
		}
		System.out.println("[model-extractor] wrote " + ok + " model layers to " + outPath);
	}

	private ModelExtractor() {}
}
