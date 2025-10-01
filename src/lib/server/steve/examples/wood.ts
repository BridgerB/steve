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

// Find any wood log type
function findWoodLog(bot: Bot): any | null {
  const woodTypes = [
    "oak_log",
    "birch_log",
    "spruce_log",
    "jungle_log",
    "acacia_log",
    "dark_oak_log",
  ];
  return bot.findBlock({
    matching: woodTypes
      .map((name) => bot.registry.blocksByName[name]?.id)
      .filter((id) => id !== undefined),
    maxDistance: 3233,
  });
}

// Find item by partial name match (includes offhand for 1.9+)
function itemByName(bot: Bot, name: string): any | undefined {
  const items = bot.inventory.items();
  if (bot.registry.isNewerOrEqualTo("1.9") && bot.inventory.slots[45]) {
    items.push(bot.inventory.slots[45]);
  }
  return items.filter((item) => item.name.includes(name))[0];
}

// Transfer wood to player inventory
async function giveWoodToPlayer(bot: Bot, username: string): Promise<void> {
  const woodItem = itemByName(bot, "_log");
  if (!woodItem) {
    bot.chat("I don't have any wood in my inventory!");
    return;
  }

  try {
    // Transfer items to player inventory
    // Note: bot.transfer() may not work as expected in newer versions
    // This is preserved from original code but may need adjustment
    await (bot as any).transfer({
      itemType: woodItem.type,
      count: woodItem.count,
      sourceStart: woodItem.slot,
      sourceEnd: woodItem.slot + 1,
      destStart: 0,
      destEnd: 36, // Player main inventory size
    });
  } catch (err) {
    console.log(err);
  }
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

    // Start gathering wood immediately
    try {
      // Find nearest wood log
      const woodBlock = findWoodLog(bot);
      if (!woodBlock) {
        console.log("No logs found nearby");
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
      try {
        await bot.pathfinder.goto(
          new pathfinder.goals.GoalNear(
            nearestPlayer.entity.position.x,
            nearestPlayer.entity.position.y,
            nearestPlayer.entity.position.z,
            1,
          ),
        );

        // Get the wood item and drop it at player's feet
        const woodItem = itemByName(bot, "_log");
        if (woodItem) {
          try {
            // Trigger a right-click action to throw the item
            bot.attack(nearestPlayer.entity);
            setTimeout(() => {
              const pos = nearestPlayer.entity?.position;
              if (pos) {
                bot.chat(
                  `/execute as ${bot.username} run tp ${pos.x} ${
                    pos.y + 1
                  } ${pos.z}`,
                );
              }
              giveWoodToPlayer(bot, nearestPlayer.username);
            }, 500);
          } catch (err) {
            console.log("Failed to drop wood:", err);
          }
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
