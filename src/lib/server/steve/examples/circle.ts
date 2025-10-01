import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";

const NUM_BOTS = 50;
const TEST_DURATION = 30000;
const SPAWN_DELAY = 100;
const CIRCLE_RADIUS = 10;
const CENTER_Y = 64; // Typical ground level

function createBot(index: number): Bot {
  return mineflayer.createBot({
    host: "localhost",
    port: 25565,
    username: `Bot${index}`,
  });
}

// Calculate position on circle for each bot
function getCirclePosition(
  centerPos: Vec3,
  index: number,
  totalBots: number,
  radius: number,
  time: number,
): Vec3 {
  const angle = (index / totalBots) * Math.PI * 2 + time / 1000;
  const x = centerPos.x + Math.cos(angle) * radius;
  const z = centerPos.z + Math.sin(angle) * radius;
  return new Vec3(x, centerPos.y, z);
}

// Make bot look at a point while moving
function lookAtPoint(bot: Bot, point: Vec3): void {
  const dx = point.x - bot.entity.position.x;
  const dz = point.z - bot.entity.position.z;
  const yaw = Math.atan2(-dx, -dz);
  bot.look(yaw, 0, false);
}

// Coordinated movement handler
function choreographyHandler(
  bot: Bot,
  index: number,
  totalBots: number,
  centerPos: Vec3,
  time: number,
): void {
  const targetPos = getCirclePosition(
    centerPos,
    index,
    totalBots,
    CIRCLE_RADIUS,
    time,
  );
  const currentPos = bot.entity.position;

  // Calculate direction to target
  const dx = targetPos.x - currentPos.x;
  const dz = targetPos.z - currentPos.z;

  // Reset movement states
  (["forward", "back", "left", "right"] as const).forEach((d) =>
    bot.setControlState(d, false)
  );

  // Determine movement direction
  if (Math.abs(dx) > 0.2 || Math.abs(dz) > 0.2) {
    lookAtPoint(bot, targetPos);
    bot.setControlState("forward", true);
  }

  // Synchronized jumping based on time
  const shouldJump = Math.sin(time / 500) > 0.9;
  bot.setControlState("jump", shouldJump);

  // Every 5 seconds, make bots do a wave pattern
  if (Math.floor(time / 5000) !== Math.floor((time - 100) / 5000)) {
    setTimeout(() => {
      bot.setControlState("jump", true);
      setTimeout(() => bot.setControlState("jump", false), 200);
    }, index * 100); // Stagger jumps for wave effect
  }

  // Every 10 seconds, make bots chat in sequence
  if (Math.floor(time / 10000) !== Math.floor((time - 100) / 10000)) {
    setTimeout(() => {
      bot.chat(`🎵 Part of the show! ${index + 1}/${totalBots}`);
    }, index * 100);
  }
}

async function runChoreography(): Promise<void> {
  console.log("Starting bot choreography...");
  const bots: Array<{ bot: Bot; moveInterval: NodeJS.Timeout }> = [];
  const startTime = Date.now();
  let centerPos: Vec3;

  // Spawn bots
  for (let i = 0; i < NUM_BOTS; i++) {
    try {
      const bot = createBot(i);

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

          // Use first bot's position as center
          if (i === 0) {
            centerPos = bot.entity.position;
            centerPos.y = CENTER_Y;
          }

          resolve();
        });
      });

      // Start choreography
      const moveInterval = setInterval(() => {
        try {
          const time = Date.now() - startTime;
          choreographyHandler(bot, i, NUM_BOTS, centerPos, time);
        } catch (error) {
          console.error(
            `Bot ${i} movement error:`,
            error instanceof Error ? error.message : "Unknown error",
          );
        }
      }, 50); // Update more frequently for smoother movement

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
    `${bots.length} bots in formation. Running for ${
      TEST_DURATION / 1000
    } seconds...`,
  );

  // Cleanup after duration
  await new Promise((resolve) => setTimeout(resolve, TEST_DURATION));
  console.log("Performance complete. Taking a bow...");

  // Final synchronized bow
  for (let i = 0; i < bots.length; i++) {
    setTimeout(() => {
      const { bot } = bots[i];
      bot.look(bot.entity.yaw, 0.8, false); // Look down for bow
      setTimeout(() => {
        bot.chat("Thank you, thank you! 👋");
      }, 500);
    }, i * 50);
  }

  // Wait for final bow to complete
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Cleanup
  console.log("Disconnecting bots...");
  bots.forEach(({ bot, moveInterval }) => {
    clearInterval(moveInterval);
    (["forward", "back", "left", "right", "jump"] as const).forEach((d) => {
      try {
        bot.setControlState(d, false);
      } catch (error) {
        // Ignore cleanup errors
      }
    });
    bot.quit();
  });

  console.log("Performance finished.");
  process.exit(0);
}

// Handle interruptions
process.on("SIGINT", () => {
  console.log("Performance interrupted. Shutting down...");
  process.exit(0);
});

// Start the show
runChoreography().catch((error) => {
  console.error("Choreography failed:", error);
  process.exit(1);
});
