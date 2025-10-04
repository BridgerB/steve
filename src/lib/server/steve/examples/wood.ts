import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import pathfinder from "mineflayer-pathfinder";

// Parse CLI arguments
function parseCliArgs(): {
  host: string;
  port: number;
  username: string;
  password?: string;
} {
  if (process.argv.length < 4 || process.argv.length > 6) {
    console.log("Usage : node worker.js <host> <port> [<name>] [<password>]");
    process.exit(1);
  }

  return {
    host: process.argv[2],
    port: parseInt(process.argv[3]),
    username: process.argv[4] || "woodworker",
    password: process.argv[5],
  };
}

// Wood log types to search for
const WOOD_TYPES = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
];

// Check if a block is a wood log
function isWoodLog(bot: Bot, block: any): boolean {
  if (!block) return false;
  return WOOD_TYPES.includes(block.name);
}

// Check blocks directly below the bot (handles spawning on trees)
function checkBlocksBelow(bot: Bot): any | null {
  for (let dy = -1; dy >= -10; dy--) {
    const checkPos = bot.entity.position.offset(0, dy, 0);
    const block = bot.blockAt(checkPos);

    if (block && isWoodLog(bot, block)) {
      return block;
    }
  }

  return null;
}

// Find any wood log type in surrounding area
function findWoodLog(bot: Bot): any | null {
  const woodIds = WOOD_TYPES
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id) => id !== undefined);

  const block = bot.findBlock({
    matching: woodIds,
    maxDistance: 128,
  });

  if (!block) {
    // Manual scan as fallback
    const pos = bot.entity.position;
    for (let x = -10; x <= 10; x++) {
      for (let y = -5; y <= 10; y++) {
        for (let z = -10; z <= 10; z++) {
          const checkPos = pos.offset(x, y, z);
          const block = bot.blockAt(checkPos);
          if (block && isWoodLog(bot, block)) {
            return block;
          }
        }
      }
    }
  }

  return block;
}

// Find item by partial name match (includes offhand for 1.9+)
function itemByName(bot: Bot, name: string): any | undefined {
  const items = bot.inventory.items();
  if (bot.registry.isNewerOrEqualTo("1.9") && bot.inventory.slots[45]) {
    items.push(bot.inventory.slots[45]);
  }
  return items.filter((item) => item.name.includes(name))[0];
}

// Main wood gathering workflow
async function runWoodWorker(): Promise<void> {
  const config = parseCliArgs();

  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
  });

  bot.loadPlugin(pathfinder.pathfinder);

  let defaultMove: any;

  bot.once("spawn", async () => {
    defaultMove = new pathfinder.Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    console.log(`Bot spawned at ${bot.entity.position}`);
    console.log("Waiting 2 seconds for chunks to load...");

    // Wait for chunks to load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Start gathering wood immediately
    try {
      // First check if we're standing on/near a tree
      let woodBlock = checkBlocksBelow(bot);

      // If no wood below, search the surrounding area
      if (!woodBlock) {
        woodBlock = findWoodLog(bot);
      }

      if (!woodBlock) {
        console.log(
          "No logs found nearby or below - try moving to a forest biome",
        );
        bot.chat("No wood found! I need to be near trees.");
        return;
      }

      bot.chat(`Found ${woodBlock.name}! Going to chop it!`);

      // Go to the wood
      try {
        bot.pathfinder.setMovements(defaultMove);
        await bot.pathfinder.goto(
          new pathfinder.goals.GoalBlock(
            woodBlock.position.x,
            woodBlock.position.y,
            woodBlock.position.z,
          ),
        );
      } catch (err) {
        console.log(err);
        return;
      }

      // Mine the wood
      try {
        await bot.dig(woodBlock);
        bot.chat("Got the wood! Coming back to you.");
      } catch (err) {
        console.log("Failed to mine wood:", err);
        return;
      }

      // Find player and throw wood at them
      const players = bot.players;
      if (!players || Object.keys(players).length === 0) {
        console.log("No players found");
        return;
      }

      const nearestPlayer = Object.values(players)[0];
      if (!nearestPlayer.entity) {
        console.log("Player not in render distance");
        return;
      }

      try {
        await bot.pathfinder.goto(
          new pathfinder.goals.GoalNear(
            nearestPlayer.entity.position.x,
            nearestPlayer.entity.position.y,
            nearestPlayer.entity.position.z,
            0.5,
          ),
        );

        const woodItem = itemByName(bot, "_log");
        if (woodItem) {
          try {
            await bot.lookAt(nearestPlayer.entity.position);
            await new Promise((resolve) => setTimeout(resolve, 100));
            await bot.toss(woodItem.type, null, woodItem.count);
            bot.chat(`Threw ${woodItem.count} ${woodItem.name} at you!`);
          } catch (err) {
            console.log("Failed to toss wood:", err);
          }
        } else {
          console.log("No wood in inventory after mining!");
        }
      } catch (err) {
        console.log("Failed to reach player:", err);
      }
    } catch (err) {
      console.log("Main process failed:", err);
    }

    bot.chat("Ready for next round!");
  });
}

// Handle interruptions
process.on("SIGINT", () => {
  console.log("Wood worker interrupted. Shutting down...");
  process.exit(0);
});

// Start the worker
runWoodWorker().catch((error) => {
  console.error("Wood worker failed:", error);
  process.exit(1);
});
