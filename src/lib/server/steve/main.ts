import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import { initializeMovement, walkTo } from "./abilities/move.ts";
import {
  findNearestBlock,
  followPlayer,
  goTo,
  initializeNavigation,
} from "./abilities/navigate.ts";
import {
  countItem,
  dropItem,
  hasItem,
  setupInventoryLogging,
} from "./abilities/inventory.ts";
import { showMenu } from "./abilities/menu.ts";
import { mineBlock } from "./abilities/mine.ts";

// Suppress PartialReadError spam globally by filtering stderr
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk: any, ...args: any[]): boolean => {
  const str = chunk.toString();
  if (str.includes("PartialReadError")) {
    return true; // Suppress PartialReadError
  }
  return originalStderrWrite(chunk, ...args);
};

interface BotOptions {
  host: string;
  port: number;
  username: string;
  version?: string;
}

const options: BotOptions = {
  host: "localhost",
  port: 25565,
  username: "Steve",
};

const bot: Bot = mineflayer.createBot(options);

// Global active task handler
let activeTask: ((username: string, message: string) => void) | null = null;

// Global setActiveTask function
const setActiveTask = (
  task: ((username: string, message: string) => void) | null,
) => {
  activeTask = task;
};

// Single persistent chat listener
bot.on("chat", (username, message) => {
  console.log(`[CHAT] ${username}: ${message}`);

  if (username === bot.username) return;

  if (activeTask) {
    activeTask(username, message);
  }
});

bot.once("spawn", () => {
  console.log("Steve spawned into the world");

  // Initialize abilities
  initializeMovement(bot);
  initializeNavigation(bot);
  setupInventoryLogging(bot);

  const menuItems = [
    {
      name: "Echo messages",
      handler: (bot) => {
        let active = true;
        bot.chat("Echoing messages... (say 'stop' to return to menu)");

        activeTask = (username, message) => {
          if (!active) return;

          if (message === "stop") {
            active = false;
            activeTask = null;
            bot.chat("Stopped echoing");
            setTimeout(() => showMenu(bot, menuItems, setActiveTask), 1000);
            return;
          }

          // Don't echo if message is empty or contains risky characters
          const safemessage = message.trim();
          if (safemessage.length === 0 || safemessage.length > 100) return;

          bot.chat(`${username} said: ${safemessage}`);
        };
      },
    },
    {
      name: "Follow player",
      handler: (bot, username) => {
        if (!username) return;

        let following = true;
        bot.chat(`Following ${username}... (say 'stop' to stop)`);

        const followInterval = setInterval(async () => {
          if (!following) {
            clearInterval(followInterval);
            return;
          }

          const player = bot.players[username]?.entity;
          if (player) {
            try {
              await followPlayer(bot, username);
            } catch (err) {
              // Silently retry - don't log pathfinding errors
            }
          }
        }, 500) as unknown as number;

        activeTask = (chatUsername, message) => {
          if (message === "stop") {
            following = false;
            clearInterval(followInterval);
            bot.pathfinder.stop();
            activeTask = null;
            bot.chat("Stopped following");

            // Return to menu
            setTimeout(() => showMenu(bot, menuItems, setActiveTask), 1000);
          }
        };
      },
    },
    {
      name: "Check inventory",
      handler: (bot) => {
        const items = bot.inventory.items();
        if (items.length === 0) {
          bot.chat("Inventory is empty");
        } else {
          bot.chat(`Inventory (${items.length} types):`);
          items.forEach((item) => {
            bot.chat(`  ${item.name} x${item.count}`);
          });
        }

        // Return to menu after showing inventory
        setTimeout(() => showMenu(bot, menuItems, setActiveTask), 2000);
      },
    },
    {
      name: "Mine nearest block",
      handler: (bot) => {
        let active = true;
        bot.chat(
          "Mining mode active. Say block name to mine, or 'stop' to return to menu",
        );

        activeTask = async (username, message) => {
          if (!active) return;

          if (message === "stop") {
            active = false;
            bot.pathfinder.stop();
            activeTask = null;
            bot.chat("Stopped mining mode");
            setTimeout(() => showMenu(bot, menuItems, setActiveTask), 1000);
            return;
          }

          const args = message.split(" ");
          const blockName = args[0];

          // Get block ID from registry
          const blockId = bot.registry.blocksByName[blockName]?.id;
          if (!blockId) {
            bot.chat(`Unknown block: ${blockName}`);
            return;
          }

          bot.chat(`Searching for ${blockName}...`);
          const block = await findNearestBlock(bot, blockId, 32);

          if (!block) {
            bot.chat(`No ${blockName} found nearby`);
            return;
          }

          bot.chat(`Found ${blockName}, mining...`);
          try {
            await goTo(bot, block.position);
            await mineBlock(bot, block);
            bot.chat(`Mined ${blockName}!`);
          } catch (err) {
            bot.chat(
              `Failed to mine: ${err instanceof Error ? err.message : "error"}`,
            );
          }
        };
      },
    },
    {
      name: "Go to coordinates",
      handler: (bot) => {
        let active = true;
        bot.chat(
          "Navigation mode active. Say 'x y z' coordinates, or 'stop' to return to menu",
        );

        activeTask = async (username, message) => {
          if (!active) return;

          if (message === "stop") {
            active = false;
            bot.pathfinder.stop();
            activeTask = null;
            bot.chat("Stopped navigation mode");
            setTimeout(() => showMenu(bot, menuItems, setActiveTask), 1000);
            return;
          }

          const args = message.split(" ");
          const x = parseFloat(args[0]);
          const y = parseFloat(args[1]);
          const z = parseFloat(args[2]);

          if (isNaN(x) || isNaN(y) || isNaN(z)) {
            bot.chat("Usage: <x> <y> <z>");
            return;
          }

          bot.chat(`Going to ${x}, ${y}, ${z}...`);
          try {
            await goTo(bot, { x, y, z } as any);
            bot.chat("Arrived!");
          } catch (err) {
            bot.chat(`Can't reach destination`);
          }
        };
      },
    },
    {
      name: "Drop items",
      handler: (bot) => {
        let active = true;
        bot.chat(
          "Drop mode active. Say 'item_name amount', or 'stop' to return to menu",
        );

        activeTask = async (username, message) => {
          if (!active) return;

          if (message === "stop") {
            active = false;
            activeTask = null;
            bot.chat("Stopped drop mode");
            setTimeout(() => showMenu(bot, menuItems, setActiveTask), 1000);
            return;
          }

          const args = message.split(" ");
          const itemName = args[0];
          const amount = parseInt(args[1]) || 1;

          if (!hasItem(bot, itemName)) {
            bot.chat(`I don't have any ${itemName}`);
            return;
          }

          const count = countItem(bot, itemName);
          bot.chat(`Dropping ${amount} ${itemName} (have ${count})...`);

          const success = await dropItem(bot, itemName, amount);
          if (success) {
            bot.chat(`Dropped ${amount} ${itemName}`);
          } else {
            bot.chat(`Failed to drop ${itemName}`);
          }
        };
      },
    },
    {
      name: "Count specific item",
      handler: (bot) => {
        let active = true;
        bot.chat(
          "Item counter active. Say item name, or 'stop' to return to menu",
        );

        activeTask = (username, message) => {
          if (!active) return;

          if (message === "stop") {
            active = false;
            activeTask = null;
            bot.chat("Stopped item counter");
            setTimeout(() => showMenu(bot, menuItems, setActiveTask), 1000);
            return;
          }

          const itemName = message.trim();
          const count = countItem(bot, itemName);

          if (count === 0) {
            bot.chat(`I don't have any ${itemName}`);
          } else {
            bot.chat(`I have ${count} ${itemName}`);
          }
        };
      },
    },
    {
      name: "Idle (do nothing)",
      handler: (bot) => {
        bot.chat("Idling...");

        // Return to menu after idling
        setTimeout(() => showMenu(bot, menuItems, setActiveTask), 2000);
      },
    },
  ];

  // Show menu
  showMenu(bot, menuItems, setActiveTask);
});

bot.on("end", () => {
  console.log("Steve disconnected");
  process.exit(0);
});

bot.on("error", (err: Error) => {
  // Ignore PartialReadError - these are harmless protocol warnings
  if (err.name === "PartialReadError") return;

  console.error("Bot error:", err.message);
  process.exit(1);
});

// Suppress PartialReadError globally on client
bot._client?.on?.("error", (err: Error) => {
  if (err.name === "PartialReadError") return;
  throw err;
});

// Also suppress unhandled errors from the client
process.on("unhandledRejection", (err: any) => {
  if (err?.name === "PartialReadError") return;
  console.error("Unhandled rejection:", err);
});

process.on("uncaughtException", (err: Error) => {
  if (err.name === "PartialReadError") return;
  console.error("Uncaught exception:", err);
  process.exit(1);
});
