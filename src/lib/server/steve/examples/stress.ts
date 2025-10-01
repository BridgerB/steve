import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";

const NUM_BOTS = 50;
const TEST_DURATION = 30000; // 30 seconds
const SPAWN_DELAY = 100; // Delay between spawning each bot

function createBot(index: number): Bot {
  return mineflayer.createBot({
    host: "localhost",
    port: 25565,
    username: `TestBot${index}`,
  });
}

function moveRandomly(bot: Bot): void {
  const directions = ["forward", "back", "left", "right"] as const;

  // Clear any existing movement
  directions.forEach((d) => bot.setControlState(d, false));

  // Pick 1-2 random directions
  const numDirections = Math.floor(Math.random() * 2) + 1;
  for (let i = 0; i < numDirections; i++) {
    const direction = directions[Math.floor(Math.random() * directions.length)];
    bot.setControlState(direction, true);
  }

  // Randomly jump
  if (Math.random() < 0.3) {
    bot.setControlState("jump", true);
    setTimeout(() => bot.setControlState("jump", false), 500);
  }

  // Random looking
  const yaw = Math.random() * Math.PI - Math.PI / 2;
  const pitch = Math.random() * Math.PI - Math.PI / 2;
  bot.look(yaw, pitch, false);
}

async function runStressTest(): Promise<void> {
  console.log("Starting stress test...");
  const bots: Array<{ bot: Bot; moveInterval: NodeJS.Timeout }> = [];

  // Spawn bots
  for (let i = 0; i < NUM_BOTS; i++) {
    try {
      const bot = createBot(i);

      // Set up error handling
      bot.on("error", (err) => {
        console.error(`Bot ${i} error:`, err.message);
      });

      // Wait for spawn
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Bot ${i} spawn timeout`));
        }, 5000);

        bot.once("spawn", () => {
          clearTimeout(timeout);
          console.log(`Bot ${i} spawned`);
          resolve();
        });
      });

      // Start random movement
      const moveInterval = setInterval(() => {
        try {
          moveRandomly(bot);
        } catch (error) {
          console.error(
            `Bot ${i} movement error:`,
            error instanceof Error ? error.message : "Unknown error",
          );
        }
      }, 2000);

      bots.push({ bot, moveInterval });
      await new Promise((resolve) => setTimeout(resolve, SPAWN_DELAY));
    } catch (error) {
      console.error(
        `Failed to spawn bot ${i}:`,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  console.log(
    `${bots.length} bots spawned. Running for ${
      TEST_DURATION / 1000
    } seconds...`,
  );

  // Run for specified duration
  await new Promise((resolve) => setTimeout(resolve, TEST_DURATION));

  // Cleanup
  console.log("Test complete. Disconnecting bots...");
  bots.forEach(({ bot, moveInterval }) => {
    clearInterval(moveInterval);
    // Clear all movement states
    (["forward", "back", "left", "right", "jump"] as const).forEach((d) => {
      try {
        bot.setControlState(d, false);
      } catch (error) {
        // Ignore cleanup errors
      }
    });
    bot.quit();
  });

  console.log("Stress test finished.");
  process.exit(0);
}

// Handle interruptions
process.on("SIGINT", () => {
  console.log("Stress test interrupted. Shutting down...");
  process.exit(0);
});

// Run the test
runStressTest().catch((error) => {
  console.error("Stress test failed:", error);
  process.exit(1);
});
