# physics

Functional replacement for [prismarine-physics](https://github.com/PrismarineJS/prismarine-physics). Per-tick Minecraft player movement simulation: gravity, AABB collision, liquid movement, elytra flight, ladder climbing, and block effects (soul sand, honey, cobweb, bubble columns).

## Usage

```ts
import { createRegistry } from "../registry/index.js";
import { createEntity } from "../entity/index.js";
import { createPhysics, createPlayerState, applyPlayerState } from "./index.js";
import { createPhysicsWorld } from "./adapter.js";

const registry = createRegistry("1.20.4");
const physics = createPhysics(registry);

// Bridge your World to the physics engine
const physicsWorld = createPhysicsWorld(world);

// Create player state from entity
const entity = createEntity(1);
entity.position = { x: 0, y: 80, z: 0 };
entity.onGround = false;

const controls = {
  forward: true, back: false, left: false, right: false,
  jump: false, sprint: true, sneak: false,
};

let state = createPlayerState(registry, entity, controls);

// Simulate one tick
state = physics.simulatePlayer(state, physicsWorld);

// Apply results back to entity
applyPlayerState(state, entity);
```

## Architecture

```
createPhysics(registry) → PhysicsEngine (factory closure)
  ├── config: PhysicsConfig (tuning constants)
  ├── simulatePlayer(state, world) → PlayerState
  └── adjustPositionHeight(pos, world) → void

createPlayerState(registry, entity, controls) → PlayerState
  └── snapshots entity pos/vel/effects/enchants into mutable state

applyPlayerState(state, entity) → void
  └── writes simulation results back to entity

createPhysicsWorld(world) → PhysicsWorld
  └── adapts World to PhysicsWorld interface
```

## Key types

```ts
type PlayerState = {
  pos: MutableVec3;          // mutable position
  vel: MutableVec3;          // mutable velocity
  onGround: boolean;
  isInWater: boolean;
  isInLava: boolean;
  isInWeb: boolean;
  isCollidedHorizontally: boolean;
  isCollidedVertically: boolean;
  elytraFlying: boolean;
  control: PlayerControls;   // forward/back/left/right/jump/sprint/sneak
  // ... effect levels, enchant levels, attributes
};

type PhysicsWorld = {
  getBlock(pos: Vec3): PhysicsBlock | null;
};

type PhysicsBlock = {
  id: number;
  name: string;
  stateId: number;
  shapes: readonly (readonly number[])[];  // collision AABBs
  boundingBox: "block" | "empty";
  properties: Record<string, string>;
};

type AABB = {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
};
```

## Functions

### Physics engine

| Function | Description |
|----------|-------------|
| `createPhysics(registry)` | Create physics engine with pre-computed block data |
| `simulatePlayer(state, world)` | Simulate one tick of player movement |
| `adjustPositionHeight(pos, world)` | Snap a position down to ground level |
| `createPlayerState(registry, entity, controls, opts?)` | Snapshot entity into mutable simulation state |
| `applyPlayerState(state, entity)` | Write simulation results back to entity |
| `createPhysicsWorld(world)` | Bridge a World to PhysicsWorld interface |

### AABB

| Function | Description |
|----------|-------------|
| `createAABB(x0, y0, z0, x1, y1, z1)` | Create a bounding box |
| `cloneAABB(bb)` | Deep copy |
| `offsetAABB(bb, x, y, z)` | Translate in place |
| `extendAABB(bb, dx, dy, dz)` | Expand in direction of offset |
| `contractAABB(bb, x, y, z)` | Shrink inward symmetrically |
| `computeOffsetX/Y/Z(bb, other, offset)` | Clamp offset by collision |
| `intersectsAABB(a, b)` | Test overlap |

### Attributes

| Function | Description |
|----------|-------------|
| `createAttributeValue(base)` | Create attribute with no modifiers |
| `getAttributeValue(attr)` | Compute final value (op 0/1/2) |
| `addAttributeModifier(attr, mod)` | Add a modifier |
| `deleteAttributeModifier(attr, uuid)` | Remove modifiers by UUID |
| `hasAttributeModifier(attr, uuid)` | Check if modifier exists |

## Movement modes

The simulation handles three movement modes per tick:

1. **Liquid** (water/lava) — buoyancy, depth strider enchant, dolphin's grace, water current flow
2. **Elytra** — glide physics with pitch-based lift/drag, firework rocket boost
3. **Normal** — ground friction (block slipperiness), air drag, step-up, ladder climbing

## Block effects

| Block | Effect |
|-------|--------|
| Soul sand | Reduced speed |
| Honey block | Reduced speed + jump height |
| Cobweb | Extreme slowdown |
| Bubble column | Vertical drag (up or down based on `drag` property) |
| Ladder/vine | Clamped vertical speed, climb on jump |
| Slime block | Bounces on landing |

## Registry extensions

This module requires effects, attributes, and block collision shapes from the registry:

```ts
registry.effectsByName.get("JumpBoost")     // → EffectDefinition
registry.attributesByName.get("movementSpeed") // → AttributeDefinition
registry.blockCollisionShapes.blocks.stone   // → 1 (shape ID)
registry.blockCollisionShapes.shapes["1"]    // → [[0,0,0,1,1,1]]
```
