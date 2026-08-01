# vec3

Purely functional 3D vector library. 33 pure functions operating on a readonly `{ x, y, z }` type. Replaces `node-vec3` (class with ~40 mutating/non-mutating method pairs) with immutable data and clear naming.

## Usage

```ts
import { vec3, add, scale, normalize, distance, formatVec3 } from "typecraft";

const a = vec3(1, 2, 3);
const b = vec3(4, 5, 6);

add(a, b);         // { x: 5, y: 7, z: 9 }
scale(a, 2);       // { x: 2, y: 4, z: 6 }
normalize(a);      // unit vector
distance(a, b);    // euclidean distance
formatVec3(a);     // "(1, 2, 3)"
```

Every operation returns a new `Vec3`. Nothing mutates.

## Type

```ts
type Vec3 = { readonly x: number; readonly y: number; readonly z: number };
```

Structurally compatible with any `{ x, y, z }` object. Useful for Minecraft coordinates (block positions, entity positions, chunk offsets).

## API

### Construction

| Function | Description |
|---|---|
| `vec3(x, y, z)` | Create from numbers |
| `vec3FromArray([x, y, z])` | Create from tuple |
| `vec3FromString("(1, 2, 3)")` | Parse string format |
| `ZERO` | Constant `{ x: 0, y: 0, z: 0 }` |

### Arithmetic

| Function | Returns |
|---|---|
| `add(a, b)` | Component-wise addition |
| `subtract(a, b)` | Component-wise subtraction |
| `multiply(a, b)` | Component-wise multiplication |
| `divide(a, b)` | Component-wise division |
| `scale(v, scalar)` | Multiply all components by scalar |
| `offset(v, dx, dy, dz)` | Add separate deltas to each component |

### Rounding

| Function | Returns |
|---|---|
| `floor(v)` | Floor each component |
| `round(v)` | Round each component |
| `abs(v)` | Absolute value of each component |

### Vector operations

| Function | Returns |
|---|---|
| `dot(a, b)` | Dot product (scalar) |
| `cross(a, b)` | Cross product (Vec3) |
| `length(v)` | Euclidean length (scalar) |
| `normalize(v)` | Unit vector (returns zero vector if length is 0) |

### Distances

| Function | Returns |
|---|---|
| `distance(a, b)` | Euclidean distance |
| `distanceSquared(a, b)` | Squared distance (avoids sqrt) |
| `distanceXY(a, b)` | Distance in XY plane only |
| `distanceXZ(a, b)` | Distance in XZ plane only |
| `distanceYZ(a, b)` | Distance in YZ plane only |
| `manhattanDistance(a, b)` | Sum of absolute component differences |

### Comparison

| Function | Returns |
|---|---|
| `min(a, b)` | Component-wise minimum |
| `max(a, b)` | Component-wise maximum |
| `equals(a, b, tolerance?)` | True if all components within tolerance (default 0) |
| `isZero(v)` | True if all components are exactly 0 |

### Queries

| Function | Returns |
|---|---|
| `volume(v)` | `x * y * z` |
| `component(v, index)` | Component by index (0=x, 1=y, 2=z) |

### Modulus

| Function | Returns |
|---|---|
| `euclideanMod(a, b)` | Component-wise euclidean modulus (always non-negative) |
| `scalarEuclideanMod(n, d)` | Scalar euclidean modulus helper |

### Conversions

| Function | Returns |
|---|---|
| `formatVec3(v)` | `"(x, y, z)"` string |
| `toArray(v)` | `[x, y, z]` tuple |
| `toXZ(v)` | `[x, z]` |
| `toXY(v)` | `[x, y]` |
| `toYZ(v)` | `[y, z]` |
| `swapYZ(v)` | New Vec3 with y and z swapped |

## Files

| File | Purpose |
|---|---|
| `vec3.ts` | Type definition and all 33 functions |
| `index.ts` | Barrel export |
