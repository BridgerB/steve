/**
 * Single bot instance manager
 * Manages one mineflayer bot connection at a time
 */

import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import { goals, Movements, pathfinder } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

let bot: Bot | null = null;

export const getBot = (): Bot | null => bot;

export const requireBot = (): Bot => {
  if (!bot) {
    throw new Error("Bot not connected. Call spawn_bot first.");
  }
  return bot;
};

export const isConnected = (): boolean => bot !== null;

export interface SpawnOptions {
  host?: string;
  port?: number;
  username?: string;
}

export const spawnBot = async (
  options: SpawnOptions = {},
): Promise<{ position: { x: number; y: number; z: number } }> => {
  if (bot) {
    throw new Error("Bot already connected. Call disconnect_bot first.");
  }

  const host = options.host ?? "localhost";
  const port = options.port ?? 25565;
  const username = options.username ?? "MCPBot";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Connection timeout after 30s"));
    }, 30000);

    bot = mineflayer.createBot({
      host,
      port,
      username,
    });

    bot.once("spawn", () => {
      clearTimeout(timeout);

      // Load pathfinder
      if (bot && !(bot as any).pathfinder) {
        bot.loadPlugin(pathfinder);
        const movements = new Movements(bot as any);
        movements.canDig = true;
        movements.allowParkour = false;
        (bot as any).pathfinder.setMovements(movements);
      }

      resolve({
        position: {
          x: Math.floor(bot!.entity.position.x),
          y: Math.floor(bot!.entity.position.y),
          z: Math.floor(bot!.entity.position.z),
        },
      });
    });

    bot.once("error", (err: Error) => {
      clearTimeout(timeout);
      bot = null;
      reject(err);
    });

    bot.once("end", () => {
      bot = null;
    });
  });
};

export const disconnectBot = async (): Promise<void> => {
  if (!bot) {
    return;
  }

  return new Promise((resolve) => {
    bot!.once("end", () => {
      bot = null;
      resolve();
    });
    bot!.quit();
  });
};

// Movement helpers
export const walkDirection = async (
  direction: "forward" | "back" | "left" | "right",
  durationMs: number,
): Promise<{ position: { x: number; y: number; z: number } }> => {
  const b = requireBot();

  const controlMap: Record<string, string> = {
    forward: "forward",
    back: "back",
    left: "left",
    right: "right",
  };

  const control = controlMap[direction];
  if (!control) {
    throw new Error(`Invalid direction: ${direction}`);
  }

  b.setControlState(control as any, true);
  await new Promise((r) => setTimeout(r, durationMs));
  b.setControlState(control as any, false);

  return {
    position: {
      x: Math.floor(b.entity.position.x),
      y: Math.floor(b.entity.position.y),
      z: Math.floor(b.entity.position.z),
    },
  };
};

export const jump = async (): Promise<void> => {
  const b = requireBot();
  b.setControlState("jump", true);
  await new Promise((r) => setTimeout(r, 300));
  b.setControlState("jump", false);
};

export const lookAt = async (
  x: number,
  y: number,
  z: number,
): Promise<void> => {
  const b = requireBot();
  await b.lookAt(new Vec3(x, y, z));
};

export const turn = async (
  yawDegrees: number,
  pitchDegrees?: number,
): Promise<void> => {
  const b = requireBot();
  const yawRad = (yawDegrees * Math.PI) / 180;
  const pitchRad = pitchDegrees !== undefined
    ? (pitchDegrees * Math.PI) / 180
    : b.entity.pitch;

  await b.look(b.entity.yaw + yawRad, pitchRad);
};

// Pathfinder helper
export const goTo = async (
  x: number,
  y: number,
  z: number,
): Promise<boolean> => {
  const b = requireBot();
  const botAny = b as any;

  const goal = new goals.GoalNear(x, y, z, 1);
  try {
    await botAny.pathfinder.goto(goal);
    return true;
  } catch (_err) {
    return b.entity.position.distanceTo(new Vec3(x, y, z)) <= 2;
  }
};

// Mining helper - blocks until complete
export const mineBlock = async (
  x: number,
  y: number,
  z: number,
): Promise<{ success: boolean; blockMined: string | null }> => {
  const b = requireBot();

  const pos = new Vec3(x, y, z);
  const block = b.blockAt(pos);

  if (!block || block.name === "air") {
    return { success: true, blockMined: null };
  }

  const blockName = block.name;

  // Look at the block
  await b.lookAt(pos.offset(0.5, 0.5, 0.5));
  await new Promise((r) => setTimeout(r, 100));

  // Dig the block (blocking)
  try {
    await b.dig(block, true);
  } catch (e) {
    return { success: false, blockMined: null };
  }

  // Verify it's gone
  await new Promise((r) => setTimeout(r, 100));
  const after = b.blockAt(pos);

  if (after && after.name !== "air") {
    return { success: false, blockMined: null };
  }

  return { success: true, blockMined: blockName };
};

// View helpers
export const getPosition = (): {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
} => {
  const b = requireBot();
  return {
    x: b.entity.position.x,
    y: b.entity.position.y,
    z: b.entity.position.z,
    yaw: (b.entity.yaw * 180) / Math.PI,
    pitch: (b.entity.pitch * 180) / Math.PI,
  };
};

export const getBlockAtCursor = (): {
  name: string;
  position: { x: number; y: number; z: number };
} | null => {
  const b = requireBot();
  const block = b.blockAtCursor(5);

  if (!block) return null;

  return {
    name: block.name,
    position: {
      x: block.position.x,
      y: block.position.y,
      z: block.position.z,
    },
  };
};

export const getBlockAt = (
  x: number,
  y: number,
  z: number,
): { name: string } | null => {
  const b = requireBot();
  const block = b.blockAt(new Vec3(x, y, z));

  if (!block) return null;

  return { name: block.name };
};

export interface ViewResult {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  health: number;
  food: number;
  blockAtCursor:
    | { name: string; position: { x: number; y: number; z: number } }
    | null;
  nearbyBlocks: Array<
    {
      name: string;
      position: { x: number; y: number; z: number };
      distance: number;
    }
  >;
  nearbyEntities: Array<
    {
      name: string;
      type: string;
      position: { x: number; y: number; z: number };
      distance: number;
    }
  >;
}

export const getView = (radius: number = 8): ViewResult => {
  const b = requireBot();
  const pos = b.entity.position;

  // Get nearby blocks (scan in front of bot)
  const nearbyBlocks: ViewResult["nearbyBlocks"] = [];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -2; dy <= 3; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const blockPos = pos.offset(dx, dy, dz);
        const block = b.blockAt(blockPos);
        if (block && block.name !== "air") {
          nearbyBlocks.push({
            name: block.name,
            position: {
              x: Math.floor(blockPos.x),
              y: Math.floor(blockPos.y),
              z: Math.floor(blockPos.z),
            },
            distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
          });
        }
      }
    }
  }

  // Sort by distance and limit
  nearbyBlocks.sort((a, b) => a.distance - b.distance);
  const limitedBlocks = nearbyBlocks.slice(0, 50);

  // Get nearby entities
  const nearbyEntities: ViewResult["nearbyEntities"] = [];
  for (const entity of Object.values(b.entities) as any[]) {
    if (entity === b.entity) continue;
    const dist = entity.position.distanceTo(pos);
    if (dist <= radius * 2) {
      nearbyEntities.push({
        name: entity.name ?? "unknown",
        type: entity.type ?? "unknown",
        position: {
          x: Math.floor(entity.position.x),
          y: Math.floor(entity.position.y),
          z: Math.floor(entity.position.z),
        },
        distance: dist,
      });
    }
  }

  nearbyEntities.sort((a, b) => a.distance - b.distance);

  return {
    position: {
      x: Math.floor(pos.x),
      y: Math.floor(pos.y),
      z: Math.floor(pos.z),
    },
    yaw: (b.entity.yaw * 180) / Math.PI,
    pitch: (b.entity.pitch * 180) / Math.PI,
    health: b.health,
    food: b.food,
    blockAtCursor: getBlockAtCursor(),
    nearbyBlocks: limitedBlocks,
    nearbyEntities,
  };
};

// Inventory helpers
export interface InventoryItem {
  name: string;
  count: number;
  slot: number;
}

export const getInventory = (): InventoryItem[] => {
  const b = requireBot();
  return b.inventory.items().map((item: any) => ({
    name: item.name,
    count: item.count,
    slot: item.slot,
  }));
};

export const selectSlot = async (slot: number): Promise<void> => {
  const b = requireBot();
  if (slot < 0 || slot > 8) {
    throw new Error("Slot must be between 0 and 8");
  }
  await b.setQuickBarSlot(slot);
};

// Interaction helpers
export const attack = async (): Promise<void> => {
  const b = requireBot();
  const botPos = b.entity.position;

  // First try entity at cursor
  let entity = b.entityAtCursor(5);

  // If no entity at cursor, find the nearest player
  if (!entity) {
    const players = Object.values(b.entities).filter(
      (e: any) => e.type === "player" && e !== b.entity,
    );
    if (players.length > 0) {
      // Sort by distance and get closest
      players.sort((p1: any, p2: any) =>
        p1.position.distanceTo(botPos) - p2.position.distanceTo(botPos)
      );
      entity = players[0] as any;
    }
  }

  if (entity) {
    await b.lookAt(entity.position.offset(0, 1, 0));
    b.attack(entity);
  }
};

export const useItem = async (): Promise<void> => {
  const b = requireBot();
  await b.activateItem();
};

export const placeBlock = async (
  x: number,
  y: number,
  z: number,
): Promise<boolean> => {
  const b = requireBot();

  // Find an adjacent block to place against
  const targetPos = new Vec3(x, y, z);
  const adjacentOffsets = [
    new Vec3(0, -1, 0),
    new Vec3(0, 1, 0),
    new Vec3(-1, 0, 0),
    new Vec3(1, 0, 0),
    new Vec3(0, 0, -1),
    new Vec3(0, 0, 1),
  ];

  for (const offset of adjacentOffsets) {
    const refPos = targetPos.plus(offset);
    const refBlock = b.blockAt(refPos);
    if (refBlock && refBlock.name !== "air") {
      try {
        await b.placeBlock(refBlock, offset.scaled(-1));
        return true;
      } catch (_e) {
        continue;
      }
    }
  }

  return false;
};
