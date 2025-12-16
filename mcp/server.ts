/**
 * Minecraft Bot MCP Server
 *
 * Exposes low-level Minecraft bot controls as MCP tools.
 * Uses stdio transport for communication.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  attack,
  disconnectBot,
  getBlockAt,
  getInventory,
  getPosition,
  getView,
  goTo,
  isConnected,
  jump,
  lookAt,
  mineBlock,
  placeBlock,
  selectSlot,
  spawnBot,
  turn,
  useItem,
  walkDirection,
} from "./bot.ts";

// Create server instance
const server = new McpServer({
  name: "minecraft-bot",
  version: "1.0.0",
});

// ============================================
// CONNECTION TOOLS
// ============================================

server.tool(
  "spawn_bot",
  "Connect a bot to the Minecraft server",
  {
    host: z.string().optional().describe("Server host (default: localhost)"),
    port: z.number().optional().describe("Server port (default: 25565)"),
    username: z.string().optional().describe("Bot username (default: MCPBot)"),
  },
  async ({ host, port, username }) => {
    try {
      const result = await spawnBot({ host, port, username });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message:
                `Bot spawned at position ${result.position.x}, ${result.position.y}, ${result.position.z}`,
              position: result.position,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "disconnect_bot",
  "Disconnect the bot from the server",
  {},
  async () => {
    try {
      await disconnectBot();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Bot disconnected",
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "is_connected",
  "Check if the bot is currently connected",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ connected: isConnected() }),
        },
      ],
    };
  },
);

// ============================================
// VIEW/PERCEPTION TOOLS
// ============================================

server.tool(
  "get_position",
  "Get the bot's current position and orientation",
  {},
  async () => {
    try {
      const pos = getPosition();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(pos),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_view",
  "Get what the bot currently sees - position, health, nearby blocks and entities",
  {
    radius: z.number().optional().describe(
      "Scan radius in blocks (default: 8)",
    ),
  },
  async ({ radius }) => {
    try {
      const view = getView(radius ?? 8);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(view),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_block_at",
  "Get the block at a specific position",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    z: z.number().describe("Z coordinate"),
  },
  async ({ x, y, z }) => {
    try {
      const block = getBlockAt(x, y, z);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(block ?? { name: "air" }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================
// MOVEMENT TOOLS
// ============================================

server.tool(
  "walk",
  "Walk in a direction for a specified duration",
  {
    direction: z.enum(["forward", "back", "left", "right"]).describe(
      "Direction to walk",
    ),
    duration_ms: z.number().describe("Duration in milliseconds"),
  },
  async ({ direction, duration_ms }) => {
    try {
      const result = await walkDirection(direction, duration_ms);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              position: result.position,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "jump",
  "Make the bot jump",
  {},
  async () => {
    try {
      await jump();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "look_at",
  "Make the bot look at a specific position",
  {
    x: z.number().describe("X coordinate to look at"),
    y: z.number().describe("Y coordinate to look at"),
    z: z.number().describe("Z coordinate to look at"),
  },
  async ({ x, y, z }) => {
    try {
      await lookAt(x, y, z);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "turn",
  "Turn the bot by a number of degrees",
  {
    yaw_degrees: z.number().describe(
      "Degrees to turn horizontally (positive = right)",
    ),
    pitch_degrees: z.number().optional().describe(
      "Degrees to change vertical look angle",
    ),
  },
  async ({ yaw_degrees, pitch_degrees }) => {
    try {
      await turn(yaw_degrees, pitch_degrees);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "go_to",
  "Use pathfinding to navigate to a position",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    z: z.number().describe("Z coordinate"),
  },
  async ({ x, y, z }) => {
    try {
      const success = await goTo(x, y, z);
      const pos = getPosition();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success,
              position: pos,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================
// MINING TOOLS
// ============================================

server.tool(
  "mine_block",
  "Mine/dig a block at a specific position. Blocks until the block is broken.",
  {
    x: z.number().describe("X coordinate of block to mine"),
    y: z.number().describe("Y coordinate of block to mine"),
    z: z.number().describe("Z coordinate of block to mine"),
  },
  async ({ x, y, z }) => {
    try {
      const result = await mineBlock(x, y, z);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================
// INVENTORY TOOLS
// ============================================

server.tool(
  "get_inventory",
  "Get the bot's inventory contents",
  {},
  async () => {
    try {
      const items = getInventory();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ items }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "select_slot",
  "Select a hotbar slot (0-8)",
  {
    slot: z.number().min(0).max(8).describe("Hotbar slot number (0-8)"),
  },
  async ({ slot }) => {
    try {
      await selectSlot(slot);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, slot }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================
// INTERACTION TOOLS
// ============================================

server.tool(
  "attack",
  "Attack the entity the bot is looking at",
  {},
  async () => {
    try {
      await attack();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "use_item",
  "Use the currently held item",
  {},
  async () => {
    try {
      await useItem();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "place_block",
  "Place a block at a specific position (must be adjacent to an existing block)",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    z: z.number().describe("Z coordinate"),
  },
  async ({ x, y, z }) => {
    try {
      const success = await placeBlock(x, y, z);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================
// RUN SERVER
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Minecraft Bot MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  Deno.exit(1);
});
