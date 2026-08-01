# protocol

Minecraft protocol client — packet serialization, framing, encryption, compression, and connection management. Replaces `minecraft-protocol` + `protodef`.

## Usage

```ts
import { createClient, ping } from "typecraft";

// Connect to a server (offline mode)
const client = createClient({
  host: "localhost",
  port: 25565,
  username: "Steve",
  version: "1.20.4",
  auth: "offline",
});

client.on("login", () => {
  console.log("Connected!");
});

client.on("chat", (packet) => {
  console.log("Chat:", packet.message);
});

client.on("error", (err) => {
  console.error(err);
});

// Ping a server
const status = await ping({ host: "mc.example.com", version: "1.20.4" });
console.log(status.version.name, status.players.online, status.latency);
```

## Architecture

```
Outbound: write() → serialize → compress → frame → encrypt → socket
Inbound:  socket → decrypt → split → decompress → deserialize → emit
```

State machine: `HANDSHAKING → LOGIN → CONFIGURATION (1.20.2+) → PLAY`

## Files

| File | Description |
|------|-------------|
| `states.ts` | Protocol state and direction enums |
| `varint.ts` | VarInt (1–5 bytes) and VarLong (1–10 bytes) LEB128 encoding |
| `codec.ts` | Schema-driven packet serialization — reads minecraft-data protocol.json |
| `framing.ts` | VarInt length-prefix framing and packet splitter |
| `encryption.ts` | AES-128-CFB8 via Node native `crypto` |
| `compression.ts` | zlib DEFLATE via Node native `zlib` |
| `client.ts` | Core client: socket, codec pipeline, state machine |
| `handshake.ts` | Login flow: handshake → encryption → compression → configuration → play |
| `keepalive.ts` | Keep-alive echo responder |
| `ping.ts` | Server list ping (MOTD, players, version, latency) |
| `createClient.ts` | High-level factory with offline UUID generation |

## Functions

### Connection

| Function | Signature | Description |
|----------|-----------|-------------|
| `createClient` | `(options: ClientOptions) => Client` | Create and connect a client |
| `createProtocolClient` | `(options: ClientOptions) => Client` | Create client without connecting |
| `connectClient` | `(client, host?, port?) => void` | TCP connect a client |
| `ping` | `(options?: PingOptions) => Promise<PingResponse>` | Query server status |

### Pipeline

| Function | Signature | Description |
|----------|-----------|-------------|
| `framePacket` | `(data: Buffer) => Buffer` | Add varint length prefix |
| `createSplitter` | `() => { write, reset }` | Extract packets from byte stream |
| `compressPacket` | `(data, threshold) => Buffer` | Compress if above threshold |
| `decompressPacket` | `(data) => Buffer` | Decompress packet |
| `createEncryptor` | `(secret: Buffer) => { update }` | AES-128-CFB8 encryptor |
| `createDecryptor` | `(secret: Buffer) => { update }` | AES-128-CFB8 decryptor |

### Codec

| Function | Signature | Description |
|----------|-----------|-------------|
| `createPacketCodec` | `(protocolData) => PacketCodec` | Build read/write for a state+direction |
| `createTypeRegistry` | `(types) => TypeRegistry` | Build type resolver from protocol.json types |

### VarInt

| Function | Signature | Description |
|----------|-----------|-------------|
| `readVarInt` | `(buffer, offset) => { value, size }` | Read 32-bit VarInt |
| `writeVarInt` | `(value, buffer, offset) => offset` | Write 32-bit VarInt |
| `sizeOfVarInt` | `(value) => number` | Byte size of VarInt encoding |
| `readVarLong` | `(buffer, offset) => { value, size }` | Read 64-bit VarLong |
| `writeVarLong` | `(value, buffer, offset) => offset` | Write 64-bit VarLong |
| `sizeOfVarLong` | `(value) => number` | Byte size of VarLong encoding |

### Handlers

| Function | Signature | Description |
|----------|-----------|-------------|
| `registerHandshake` | `(client, options) => void` | Wire up login flow |
| `registerKeepalive` | `(client) => void` | Wire up keep-alive responses |

## Types

### Client

```ts
type Client = EventEmitter & {
  write: (name: string, params: Record<string, unknown>) => void;
  writeRaw: (buffer: Buffer) => void;
  end: (reason?: string) => void;
  setSocket: (socket: Socket) => void;
  setEncryption: (secret: Buffer) => void;
  setCompressionThreshold: (threshold: number) => void;
  state: string;
  username: string;
  uuid: string;
  version: string;
  protocolVersion: number;
  socket: Socket | null;
};
```

### ClientOptions

```ts
type ClientOptions = {
  host?: string;       // default "localhost"
  port?: number;       // default 25565
  username: string;
  version: string;     // e.g. "1.20.4"
  auth?: "microsoft" | "offline";  // default "offline"
  keepAlive?: boolean; // default true
  hideErrors?: boolean;
};
```

### PacketCodec

```ts
type PacketCodec = {
  read: (buffer: Buffer) => { name: string; params: Record<string, unknown> };
  write: (name: string, params: Record<string, unknown>) => Buffer;
  packetNames: ReadonlyMap<number, string>;
  packetIds: ReadonlyMap<string, number>;
};
```

### PingResponse

```ts
type PingResponse = {
  version: { name: string; protocol: number };
  players: { online: number; max: number; sample?: { name: string; id: string }[] };
  description: unknown;
  favicon?: string;
  latency: number;
};
```

## Client events

| Event | Payload | When |
|-------|---------|------|
| `connect` | — | TCP socket connected |
| `login` | — | Entered PLAY state |
| `state` | `(newState, oldState)` | Protocol state changed |
| `packet` | `(params, meta)` | Any packet received |
| `{packetName}` | `(params, meta)` | Specific packet received |
| `error` | `(error)` | Any error |
| `end` | `(reason)` | Connection closed |

## Codec type system

The codec reads protocol.json schemas from minecraft-data and builds read/write/sizeOf function triples for every type. Supported types:

**Primitives:** `bool`, `i8`, `u8`, `i16`, `u16`, `i32`, `u32`, `i64`, `u64`, `f32`, `f64`, `varint`, `varlong`, `void`

**Compound:** `pstring`, `buffer`, `container`, `array`, `mapper`, `switch`, `option`, `bitfield`, `bitflags`, `entityMetadataLoop`, `topBitSetTerminatedArray`

**Minecraft:** `UUID`, `restBuffer`, `anonymousNbt`, `anonOptionalNbt`
