# entity

Functional replacement for [prismarine-entity](https://github.com/PrismarineJS/prismarine-entity). Mutable `Entity` type with pure functions for equipment, effects, and vehicle/passenger management.

## Usage

```ts
import { createRegistry } from "../registry/index.js";
import {
  createEntity,
  initEntity,
  setEquipment,
  getHeldItem,
  addEffect,
  setVehicle,
} from "./index.js";
import { createItemByName } from "../item/index.js";

const reg = createRegistry("1.20.4");

// Create and initialize from registry
const entity = createEntity(42);
initEntity(entity, reg, reg.entitiesByName.get("zombie")!.id);

entity.name;        // "zombie"
entity.displayName; // "Zombie"
entity.type;        // "hostile"

// Equipment
const sword = createItemByName(reg, "iron_sword", 1);
setEquipment(entity, 0, sword);
getHeldItem(entity); // → sword

// Effects
addEffect(entity, { id: 1, amplifier: 1, duration: 600 });
entity.effects.get(1); // → { id: 1, amplifier: 1, duration: 600 }
```

## Entity type

```ts
type Entity = {
  id: number;                    // unique entity ID
  type: EntityType;              // "player" | "mob" | "hostile" | "object" | ...
  uuid: string | null;
  username: string | null;       // set for players
  name: string | null;           // short name ("zombie")
  displayName: string | null;    // long name ("Zombie")
  entityType: number | null;     // numeric entity type ID
  kind: string | null;           // category ("Hostile mobs", "Passive mobs", etc.)
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  onGround: boolean;
  height: number;
  width: number;
  equipment: (Item | null)[];    // 6 slots (see below)
  metadata: unknown[];
  effects: Map<number, Effect>;
  vehicle: Entity | null;        // entity this one is riding
  passengers: Entity[];          // entities riding this one
  health: number;                // default 20
  food: number;                  // default 20
  foodSaturation: number;        // default 5
  elytraFlying: boolean;
  isValid: boolean;              // false after despawn
  count: number | null;          // XP orb amount
};
```

## Equipment slots

| Slot | Item |
|:----:|------|
| 0 | Main hand (held item) |
| 1 | Off-hand (1.9+) |
| 2 | Boots |
| 3 | Leggings |
| 4 | Chestplate |
| 5 | Helmet |

## Functions

### Construction

| Function | Description |
|----------|-------------|
| `createEntity(id)` | Create entity with default values |
| `initEntity(entity, registry, entityTypeId)` | Populate name, dimensions, type from registry |

### Equipment

| Function | Description |
|----------|-------------|
| `setEquipment(entity, slot, item)` | Set an equipment slot |
| `getHeldItem(entity)` | Main hand item (slot 0) |
| `getOffhandItem(entity)` | Off-hand item (slot 1) |
| `getArmor(entity)` | Armor slots as array (boots, leggings, chestplate, helmet) |

### Effects

| Function | Description |
|----------|-------------|
| `addEffect(entity, effect)` | Add or update a potion effect |
| `removeEffect(entity, effectId)` | Remove a potion effect |
| `clearEffects(entity)` | Remove all effects |

### Vehicle / passengers

| Function | Description |
|----------|-------------|
| `setVehicle(entity, vehicle)` | Set what this entity is riding |
| `addPassenger(entity, passenger)` | Add an entity riding this one |
| `removePassenger(entity, passengerId)` | Remove a passenger by ID |

### Validity

| Function | Description |
|----------|-------------|
| `entityValid(entity)` | Check if entity is still valid |
| `invalidateEntity(entity)` | Mark as despawned/removed |

## Registry data

Entity definitions come from `minecraft-data`:

```ts
reg.entitiesByName.get("zombie")  // → EntityDefinition
reg.entitiesById.get(54)          // → EntityDefinition
```

Each `EntityDefinition` has: `id`, `name`, `displayName`, `width`, `height`, `type`, `category`.
