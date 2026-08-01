# nibble

Read and write 4-bit values (nibbles) packed two per byte. Replaces `uint4` with three pure functions.

Minecraft uses nibble arrays for block light and sky light data in chunks, where each block stores a value 0-15.

## Usage

```ts
import { createNibbleArray, readNibble, writeNibble } from "typecraft";

// Create array for 4096 nibbles (2048 bytes)
const light = createNibbleArray(4096);

// Write value 12 at index 100
writeNibble(light, 100, 12);

// Read it back
readNibble(light, 100); // 12
```

## API

| Function | Description |
|---|---|
| `createNibbleArray(length)` | Allocate a `Uint8Array` for `length` nibbles (half as many bytes) |
| `readNibble(bytes, index)` | Read 4-bit value (0-15) at nibble index |
| `writeNibble(bytes, index, value)` | Write 4-bit value at nibble index |

## Packing

Two nibbles per byte. Even indices use the low 4 bits, odd indices use the high 4 bits:

```
byte[0]: [ nibble[1] (high) | nibble[0] (low) ]
byte[1]: [ nibble[3] (high) | nibble[2] (low) ]
```

## Files

| File | Purpose |
|---|---|
| `nibble.ts` | All three functions |
| `index.ts` | Barrel export |
