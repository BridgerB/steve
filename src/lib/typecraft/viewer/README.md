# viewer

Three.js Minecraft world renderer, replacing the core rendering pipeline from [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer). Loads block models and textures from `minecraft-assets`, meshes chunk sections with face culling and ambient occlusion, and renders them in a Three.js scene via web workers.

## Architecture

```
assets.ts          Load models, build texture atlas, resolve block states
    ↓
mesher.ts          Convert 16³ section → vertex buffers (positions, normals, UVs, colors)
    ↓
workerEntry.ts     Web worker pool — runs mesher off main thread
    ↓
worldRenderer.ts   Manage Three.js meshes, dispatch to workers, track dirty sections
    ↓
viewer.ts          Top-level API — scene, camera, lights, render loop
```

## Usage

```ts
import {
  createViewer,
  setViewerVersion,
  setViewerAssets,
  loadAssets,
  addViewerColumn,
  setViewerCamera,
  renderViewer,
  disposeViewer,
} from "./index.js";

// Create viewer in a canvas
const viewer = createViewer({
  canvas: document.querySelector("canvas")!,
  width: 800,
  height: 600,
  numWorkers: 4,
});

// Load assets and configure
setViewerVersion(viewer, "1.20.4");
const assets = await loadAssets("1.20.4");
setViewerAssets(viewer, assets.blockStates, assets.atlas, assets.tints);

// Add chunk columns, set camera, render
addViewerColumn(viewer, chunkColumn, { x: 0, y: 0, z: 0 });
setViewerCamera(viewer, position, yaw, pitch);
renderViewer(viewer);
```

## Functions

### Asset pipeline (`assets.ts`)

| Function | Description |
|----------|-------------|
| `loadAssets(version)` | Load and prepare all assets for a version |
| `createTextureAtlas(textures, tileSize)` | Pack block textures into a power-of-2 atlas |
| `prepareBlockStates(registry, atlas, models, blockStates)` | Resolve model references, parent chains, and variant/multipart rules |
| `prepareBiomeTints(registry)` | Build biome color tint lookup tables |

### Mesher (`mesher.ts`)

| Function | Description |
|----------|-------------|
| `getSectionGeometry(sx, sy, sz, getBlock, blockStates, tints)` | Generate geometry for a 16³ section |
| `getModelVariants(stateId, blockStates)` | Get resolved model variants for a block state |

### World renderer (`worldRenderer.ts`)

| Function | Description |
|----------|-------------|
| `createWorldRenderer(scene, numWorkers)` | Create renderer with worker pool |
| `setWorldRendererVersion(wr, version)` | Set Minecraft version |
| `setWorldRendererBlockStates(wr, blockStates)` | Set resolved block state data |
| `setWorldRendererTexture(wr, atlas)` | Set texture atlas material |
| `setWorldRendererTints(wr, tints)` | Set biome tint data |
| `addRendererColumn(wr, column, pos)` | Send chunk column to workers |
| `removeRendererColumn(wr, x, z)` | Remove chunk and its meshes |
| `setRendererBlockStateId(wr, pos, stateId)` | Update a single block, marks neighbors dirty |
| `waitForRender(wr)` | Wait for all pending meshes |
| `resetWorldRenderer(wr)` | Remove all chunks and meshes |
| `disposeWorldRenderer(wr)` | Terminate workers, dispose materials |

### Viewer (`viewer.ts`)

| Function | Description |
|----------|-------------|
| `createViewer(options)` | Create scene, camera, lights, and world renderer |
| `setViewerVersion(viewer, version)` | Set Minecraft version |
| `setViewerAssets(viewer, blockStates, atlas, tints)` | Configure all assets at once |
| `addViewerColumn(viewer, column, pos)` | Add a chunk column |
| `removeViewerColumn(viewer, x, z)` | Remove a chunk column |
| `setViewerBlockStateId(viewer, pos, stateId)` | Update a single block |
| `setViewerCamera(viewer, pos, yaw, pitch)` | Update camera position/rotation |
| `resizeViewer(viewer, width, height)` | Resize the renderer |
| `renderViewer(viewer)` | Render one frame |
| `waitForViewerRender(viewer)` | Wait for all pending meshes |
| `disposeViewer(viewer)` | Clean up everything |

### Worker (`workerEntry.ts`)

| Function | Description |
|----------|-------------|
| `initMesherWorker(ctx)` | Initialize worker message handler |

## Key types

| Type | Description |
|------|-------------|
| `Viewer` | Top-level viewer state (scene, camera, renderer, world renderer) |
| `WorldRenderer` | Mesh management state (workers, section meshes, material) |
| `TextureAtlas` | Packed texture atlas (canvas, UV map, tile/atlas size) |
| `ResolvedBlockStates` | Block state → model variant lookup |
| `BiomeTints` | Biome color tint tables (grass, foliage, water) |
| `SectionGeometry` | Mesher output (Float32Arrays for positions, normals, colors, UVs) |
| `MesherBlock` | Minimal block interface the mesher needs |
| `BlockModel` / `BlockModelVariant` | Resolved block model with elements and faces |

## Mesher features

- Face culling against neighboring blocks (transparent vs opaque)
- Ambient occlusion (smooth lighting at block corners)
- Block model element rotation
- UV rotation (0/90/180/270)
- Liquid rendering (water level geometry)
- Biome tinting (grass, foliage, water per-biome colors)
- Multipart model resolution (fences, walls, redstone)

## Dependencies

- `three` — 3D rendering
- `minecraft-assets` — block models, textures, and block state definitions
