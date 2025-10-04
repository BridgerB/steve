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

// Find closest wood log in surrounding area
function findClosestWoodLog(bot: Bot): any | null {
  const woodIds = WOOD_TYPES
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id) => id !== undefined);

  // First check directly below (spawning on tree edge case)
  const belowBlock = checkBlocksBelow(bot);
  if (belowBlock) return belowBlock;

  // Find multiple blocks and sort by distance
  const blocks = bot.findBlocks({
    matching: woodIds,
    maxDistance: 128,
    count: 100,
  });

  if (blocks.length === 0) {
    // Manual scan as last resort fallback
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
    return null;
  }

  // Sort by distance and return closest
  const sorted = blocks
    .map((pos) => ({
      pos,
      dist: bot.entity.position.distanceTo(pos),
    }))
    .sort((a, b) => a.dist - b.dist);

  return bot.blockAt(sorted[0].pos);
}

// Find item by partial name match (includes offhand for 1.9+)
function itemByName(bot: Bot, name: string): any | undefined {
  const items = bot.inventory.items();
  if (bot.registry.isNewerOrEqualTo("1.9") && bot.inventory.slots[45]) {
    items.push(bot.inventory.slots[45]);
  }
  return items.filter((item) => item.name.includes(name))[0];
}

// Gather one log and deliver to player
async function gatherAndDeliverWood(bot: Bot, player: any): Promise<void> {
  // Find closest log
  const woodBlock = findClosestWoodLog(bot);
  if (!woodBlock) {
    console.log("No logs found - waiting");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return;
  }

  // Go to log
  try {
    await bot.pathfinder.goto(
      new pathfinder.goals.GoalBlock(
        woodBlock.position.x,
        woodBlock.position.y,
        woodBlock.position.z,
      ),
    );
  } catch (err) {
    console.log("Could not reach log");
    return;
  }

  // Mine it
  try {
    await bot.dig(woodBlock);
  } catch (err) {
    // Ignore dig errors - check inventory instead
  }

  // Wait and check for wood
  await new Promise((resolve) => setTimeout(resolve, 500));
  const woodItem = itemByName(bot, "_log");
  if (!woodItem) {
    console.log("No wood collected");
    return;
  }

  // Verify player
  if (!player.entity) {
    console.log("Player not found");
    return;
  }

  // Go to player
  try {
    await bot.pathfinder.goto(
      new pathfinder.goals.GoalNear(
        player.entity.position.x,
        player.entity.position.y,
        player.entity.position.z,
        0.5,
      ),
    );
  } catch (err) {
    console.log("Could not reach player");
    return;
  }

  // Toss wood
  try {
    await bot.lookAt(player.entity.position);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await bot.toss(woodItem.type, null, woodItem.count);
  } catch (err) {
    console.log("Toss failed");
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
    defaultMove.allowSprinting = true; // Enable sprinting for speed
    defaultMove.allowFreeMotion = true; // Allow straight-line movement
    defaultMove.canDig = true; // Allow digging to reach blocks
    bot.pathfinder.setMovements(defaultMove);

    console.log(`Bot spawned at ${bot.entity.position}`);

    // Reduced chunk loading wait
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Find player once at start
    const players = bot.players;
    const nearestPlayer = Object.values(players).filter(
      (p) => p.username !== bot.username,
    )[0];

    if (!nearestPlayer?.entity) {
      console.log("No player found - bot exiting");
      return;
    }

    console.log(
      `Starting infinite wood gathering for ${nearestPlayer.username}`,
    );

    // Infinite gathering loop
    while (true) {
      try {
        await gatherAndDeliverWood(bot, nearestPlayer);
      } catch (err) {
        console.log("Loop error:", err);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
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
