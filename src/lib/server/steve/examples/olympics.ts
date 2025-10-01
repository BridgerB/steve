import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";

const NUM_BOTS = 40;
const SPAWN_DELAY = 100;
const TEAM_COLORS = ["Red", "Blue", "Green", "Yellow"];

interface BotInfo {
  bot: Bot;
  teamIndex: number;
  botIndex: number;
}

function createBot(index: number, teamColor: string): Bot {
  return mineflayer.createBot({
    host: "localhost",
    port: 25565,
    username: `${teamColor}Bot${index}`,
  });
}

// Utility functions for formations
function getCirclePosition(
  center: Vec3,
  index: number,
  total: number,
  radius: number,
  offset = 0,
): Vec3 {
  const angle = (index / total) * Math.PI * 2 + offset;
  return new Vec3(
    center.x + Math.cos(angle) * radius,
    center.y,
    center.z + Math.sin(angle) * radius,
  );
}

function getSpiralPosition(
  center: Vec3,
  index: number,
  total: number,
  time: number,
): Vec3 {
  const angle = (index / total) * Math.PI * 2 + time / 1000;
  const radius = 5 + (index / total) * 15;
  return new Vec3(
    center.x + Math.cos(angle) * radius,
    center.y + (index / total) * 10,
    center.z + Math.sin(angle) * radius,
  );
}

// Coordinated movement handler
function moveToPosition(bot: Bot, targetPos: Vec3): void {
  const currentPos = bot.entity.position;
  (["forward", "back", "left", "right"] as const).forEach((d) =>
    bot.setControlState(d, false)
  );

  const dx = targetPos.x - currentPos.x;
  const dz = targetPos.z - currentPos.z;
  const dy = targetPos.y - currentPos.y;

  if (Math.abs(dx) > 0.2 || Math.abs(dz) > 0.2) {
    const yaw = Math.atan2(-dx, -dz);
    bot.look(yaw, Math.atan2(-dy, Math.sqrt(dx * dx + dz * dz)), false);
    bot.setControlState("forward", true);
  }
}

// Olympic events
const events = {
  async openingCeremony(bots: BotInfo[], centerPos: Vec3): Promise<void> {
    console.log("🎭 Opening Ceremony Beginning!");

    // First formation: Teams enter in spirals
    for (let time = 0; time < 10000; time += 100) {
      bots.forEach(({ bot }, i) => {
        const pos = getSpiralPosition(centerPos, i, bots.length, time);
        moveToPosition(bot, pos);
        if (time % 1000 === 0) {
          bot.setControlState("jump", true);
          setTimeout(() => bot.setControlState("jump", false), 200);
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Form Olympic rings
    const ringRadius = 5;
    const ringOffsets = [
      { x: -10, z: 0 },
      { x: -5, z: -3 },
      { x: 0, z: 0 },
      { x: 5, z: -3 },
      { x: 10, z: 0 },
    ];

    for (let i = 0; i < bots.length; i++) {
      const ringIndex = Math.floor(i / (bots.length / 5));
      const posInRing = i % (bots.length / 5);
      const totalInRing = bots.length / 5;

      const ringCenter = new Vec3(
        centerPos.x + ringOffsets[ringIndex].x,
        centerPos.y,
        centerPos.z + ringOffsets[ringIndex].z,
      );

      const pos = getCirclePosition(
        ringCenter,
        posInRing,
        totalInRing,
        ringRadius,
      );
      moveToPosition(bots[i].bot, pos);
    }

    // All bots chat "Let the games begin!"
    await new Promise((resolve) => setTimeout(resolve, 2000));
    bots.forEach(({ bot }, i) => {
      setTimeout(() => {
        bot.chat("Let the games begin! 🎮");
      }, i * 50);
    });
  },

  async botWave(bots: BotInfo[], _centerPos: Vec3): Promise<void> {
    console.log("🌊 Performing The Wave!");
    const rows = 4;
    const botsPerRow = Math.floor(bots.length / rows);

    for (let wave = 0; wave < 3; wave++) {
      for (let i = 0; i < botsPerRow; i++) {
        for (let row = 0; row < rows; row++) {
          const index = row * botsPerRow + i;
          if (index < bots.length) {
            bots[index].bot.setControlState("jump", true);
            setTimeout(() => {
              bots[index].bot.setControlState("jump", false);
            }, 200);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  },

  async torchCeremony(bots: BotInfo[], centerPos: Vec3): Promise<void> {
    console.log("🔥 Torch Ceremony Beginning!");
    // Form a path for the torch
    const pathBots = bots.slice(1);
    const torchBearer = bots[0];

    // Position bots in two lines
    pathBots.forEach(({ bot }, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const progress = Math.floor(i / 2) / (pathBots.length / 2);
      const pos = new Vec3(
        centerPos.x + progress * 20 - 10,
        centerPos.y,
        centerPos.z + side * 2,
      );
      moveToPosition(bot, pos);
    });

    // Torch bearer runs through the path
    for (let progress = 0; progress <= 1; progress += 0.05) {
      const pos = new Vec3(
        centerPos.x + progress * 20 - 10,
        centerPos.y,
        centerPos.z,
      );
      moveToPosition(torchBearer.bot, pos);

      // Nearby bots jump as torch passes
      pathBots.forEach(({ bot }, i) => {
        const botProgress = Math.floor(i / 2) / (pathBots.length / 2);
        if (Math.abs(botProgress - progress) < 0.1) {
          bot.setControlState("jump", true);
          setTimeout(() => bot.setControlState("jump", false), 200);
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  },

  async finalPerformance(bots: BotInfo[], centerPos: Vec3): Promise<void> {
    console.log("🎉 Final Performance Beginning!");
    const duration = 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < duration) {
      const time = Date.now() - startTime;
      const phase = (time / duration) * Math.PI * 2;

      bots.forEach(({ bot }, i) => {
        // Complex spiral movement
        const angle = (i / bots.length) * Math.PI * 2 + phase;
        const radius = 10 + Math.sin(phase + i * 0.2) * 5;
        const height = Math.sin(phase + i * 0.3) * 2;

        const pos = new Vec3(
          centerPos.x + Math.cos(angle) * radius,
          centerPos.y + height,
          centerPos.z + Math.sin(angle) * radius,
        );

        moveToPosition(bot, pos);

        // Periodic jumping based on position in formation
        if (Math.sin(phase + i * 0.5) > 0.9) {
          bot.setControlState("jump", true);
          setTimeout(() => bot.setControlState("jump", false), 200);
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  },
};

async function runOlympics(): Promise<void> {
  console.log("🏆 Starting Minecraft Bot Olympics!");
  const bots: BotInfo[] = [];
  let centerPos!: Vec3;

  // Spawn bots and assign to teams
  for (let teamIndex = 0; teamIndex < TEAM_COLORS.length; teamIndex++) {
    const teamSize = Math.floor(NUM_BOTS / TEAM_COLORS.length);
    for (let i = 0; i < teamSize; i++) {
      try {
        const bot = createBot(i, TEAM_COLORS[teamIndex]);

        bot.on("error", (err) => {
          console.error(`${TEAM_COLORS[teamIndex]}Bot${i} error:`, err.message);
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Bot spawn timeout`));
          }, 5000);

          bot.once("spawn", () => {
            clearTimeout(timeout);
            console.log(`${TEAM_COLORS[teamIndex]}Bot${i} spawned`);
            if (!centerPos) centerPos = bot.entity.position;
            resolve();
          });
        });

        bots.push({ bot, teamIndex, botIndex: i });
        await new Promise((resolve) => setTimeout(resolve, SPAWN_DELAY));
      } catch (error) {
        console.error(
          `Failed to spawn bot:`,
          error instanceof Error ? error.message : "Unknown error",
        );
      }
    }
  }

  console.log(`${bots.length} bots ready. Let the games begin!`);

  // Run Olympic events
  try {
    await events.openingCeremony(bots, centerPos);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await events.torchCeremony(bots, centerPos);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await events.botWave(bots, centerPos);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await events.finalPerformance(bots, centerPos);

    // Closing ceremony
    console.log("🎊 Closing Ceremony");
    bots.forEach(({ bot }, i) => {
      setTimeout(() => {
        bot.chat("Thank you for watching the Bot Olympics! 🏆");
        bot.look(bot.entity.yaw, 0.8, false);
      }, i * 100);
    });
  } catch (error) {
    console.error("Event error:", error);
  }

  // Cleanup after delay
  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log("Olympics finished. Disconnecting bots...");
  bots.forEach(({ bot }) => {
    (["forward", "back", "left", "right", "jump"] as const).forEach((d) => {
      try {
        bot.setControlState(d, false);
      } catch (error) {
        // Ignore cleanup errors
      }
    });
    bot.quit();
  });

  console.log("Olympic games concluded!");
  process.exit(0);
}

// Handle interruptions
process.on("SIGINT", () => {
  console.log("Olympics interrupted. Shutting down...");
  process.exit(0);
});

// Start the Olympics
runOlympics().catch((error) => {
  console.error("Olympics failed:", error);
  process.exit(1);
});
