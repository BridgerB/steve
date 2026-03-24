/**
 * Minimal RCON client for Minecraft servers.
 * Source RCON protocol: TCP, little-endian int32 framing, auth + command packets.
 *
 * Usage:
 *   const rcon = await connect({ port: 25575, password: "test" });
 *   const response = await rcon.command("list");
 *   rcon.close();
 */

import { createConnection, type Socket } from "net";

interface RconOptions {
  host?: string;
  port?: number;
  password?: string;
}

interface RconClient {
  command: (cmd: string) => Promise<string>;
  close: () => void;
}

const PACKET_TYPE = { AUTH: 3, AUTH_RESPONSE: 2, COMMAND: 2, RESPONSE: 0 };

const encodePacket = (id: number, type: number, body: string): Buffer => {
  const bodyBuf = Buffer.from(body, "utf8");
  const length = 4 + 4 + bodyBuf.length + 2; // id + type + body + 2 null bytes
  const buf = Buffer.alloc(4 + length);
  buf.writeInt32LE(length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeInt8(0, 12 + bodyBuf.length);
  buf.writeInt8(0, 13 + bodyBuf.length);
  return buf;
};

const decodePacket = (buf: Buffer): { id: number; type: number; body: string } => {
  const id = buf.readInt32LE(4);
  const type = buf.readInt32LE(8);
  const body = buf.toString("utf8", 12, buf.length - 2);
  return { id, type, body };
};

export const connect = (options: RconOptions = {}): Promise<RconClient> => {
  const host = options.host ?? "localhost";
  const port = options.port ?? 25575;
  const password = options.password ?? "minecraft-test-rcon";

  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host, port }, () => {
      // Authenticate
      socket.write(encodePacket(1, PACKET_TYPE.AUTH, password));
    });

    let requestId = 10;
    let pendingResolve: ((body: string) => void) | null = null;
    let dataBuf = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      dataBuf = Buffer.concat([dataBuf, chunk]);

      while (dataBuf.length >= 4) {
        const packetLen = dataBuf.readInt32LE(0);
        if (dataBuf.length < 4 + packetLen) break;

        const packet = decodePacket(dataBuf.subarray(0, 4 + packetLen));
        dataBuf = dataBuf.subarray(4 + packetLen);

        if (packet.id === 1) {
          // Auth response
          if (packet.type === PACKET_TYPE.AUTH_RESPONSE) {
            resolve(client);
          } else {
            reject(new Error("RCON auth failed"));
          }
        } else if (pendingResolve) {
          pendingResolve(packet.body);
          pendingResolve = null;
        }
      }
    });

    socket.on("error", (err) => {
      if (pendingResolve) pendingResolve("");
      reject(err);
    });

    // Queue to prevent concurrent commands from overwriting pendingResolve
    let commandQueue: Promise<string> = Promise.resolve("");

    const client: RconClient = {
      command: (cmd: string): Promise<string> => {
        const prev = commandQueue;
        const next = prev.then(() => new Promise<string>((res) => {
          const id = ++requestId;
          pendingResolve = res;
          socket.write(encodePacket(id, PACKET_TYPE.COMMAND, cmd));
          setTimeout(() => {
            if (pendingResolve === res) {
              pendingResolve = null;
              res("");
            }
          }, 5000);
        }));
        commandQueue = next.catch(() => "");
        return next;
      },
      close: () => {
        socket.destroy();
      },
    };
  });
};
