import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { goTo, initializeNavigation } from "../abilities/navigation";
import { mineBlock } from "../abilities/mining";

// Bot roles and their behaviors
interface Role {
  name: string;
  searchBlocks?: string[];
  chatMessages: string[];
  patrolRadius?: number;
}

interface VillageBotConfig {
  bot: Bot;
  role: Role;
  villageCenter: Vec3;
  homePosition: Vec3;
  state: { working: boolean };
  moveInterval?: NodeJS.Timeout;
  chatInterval?: NodeJS.Timeout;
}

const ROLES: Record<string, Role> = {
  FARMER: {
    name: "Farmer",
    searchBlocks: ["wheat", "carrot", "potato"],
    chatMessages: [
      "🌾 Time to check the crops!",
      "🚜 Another day in the fields",
      "🌱 These plants are growing nicely",
    ],
  },
  MINER: {
    name: "Miner",
    searchBlocks: ["stone", "iron_ore", "coal_ore"],
    chatMessages: [
      "⛏️ Deep down we go!",
      "💎 I smell valuable ores nearby",
      "🪨 Just one more block...",
    ],
  },
  LOGGER: {
    name: "Logger",
    searchBlocks: ["oak_log", "birch_log", "spruce_log"],
    chatMessages: [
      "🌳 These trees wont chop themselves",
      "🪓 Time to restock our wood supply",
      "🌲 The forest calls to me",
    ],
  },
  GUARD: {
    name: "Guard",
    patrolRadius: 20,
    chatMessages: [
      "⚔️ Keeping the village safe!",
      "🛡️ All clear on my watch",
      "👀 Always vigilant",
    ],
  },
};

// Pure utility functions
function getHomePosition(
  villageCenter: Vec3,
  offset: { x: number; z: number },
): Vec3 {
  return new Vec3(
    villageCenter.x + offset.x,
    villageCenter.y,
    villageCenter.z + offset.z,
  );
}

function getRandomPatrolPoint(homePos: Vec3, radius: number): Vec3 {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * radius;
  return new Vec3(
    homePos.x + Math.cos(angle) * distance,
    homePos.y,
    homePos.z + Math.sin(angle) * distance,
  );
}

function getRandomExplorePoint(homePos: Vec3): Vec3 {
  const angle = Math.random() * Math.PI * 2;
  const distance = 10 + Math.random() * 20;
  return new Vec3(
    homePos.x + Math.cos(angle) * distance,
    homePos.y,
    homePos.z + Math.sin(angle) * distance,
  );
}

function getRandomChatMessage(role: Role): string {
  return role.chatMessages[
    Math.floor(Math.random() * role.chatMessages.length)
  ];
}

// Bot behavior functions
async function lookAround(bot: Bot): Promise<void> {
  const positions = [
    { yaw: 0, pitch: 0 },
    { yaw: Math.PI / 2, pitch: 0 },
    { yaw: Math.PI, pitch: 0 },
    { yaw: -Math.PI / 2, pitch: 0 },
  ];

  for (const pos of positions) {
    await bot.look(pos.yaw, pos.pitch);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function performGuardPatrol(
  bot: Bot,
  homePos: Vec3,
  patrolRadius: number,
): Promise<void> {
  const patrolPoint = getRandomPatrolPoint(homePos, patrolRadius);

  try {
    await goTo(bot, patrolPoint);
    await lookAround(bot);
  } catch (error) {
    // Patrol failed, continue
  }
}

async function performResourceGathering(
  bot: Bot,
  role: Role,
  homePos: Vec3,
): Promise<void> {
  if (!role.searchBlocks) return;

  // Search for resources (note: searchBlocks should be block IDs, not names)
  const block = bot.findBlock({
    matching: (block: any) => {
      return role.searchBlocks?.some((name) => block.name === name) || false;
    },
    maxDistance: 32,
  });

  if (block) {
    try {
      await goTo(bot, block.position);
      await mineBlock(bot, block);
    } catch (error) {
      // Mining failed, continue
    }
  } else {
    // Explore for new resources
    const explorePoint = getRandomExplorePoint(homePos);
    try {
      await goTo(bot, explorePoint);
    } catch (error) {
      // Exploration failed, continue
    }
  }
}

// Behavior loops
function startBehaviorLoop(config: VillageBotConfig): void {
  const performAction = async () => {
    if (!config.state.working) return;

    try {
      if (config.role.name === "Guard") {
        await performGuardPatrol(
          config.bot,
          config.homePosition,
          config.role.patrolRadius || 20,
        );
      } else {
        await performResourceGathering(
          config.bot,
          config.role,
          config.homePosition,
        );
      }
    } catch (error) {
      console.error(
        `${config.bot.username} behavior error:`,
        error instanceof Error ? error.message : "Unknown error",
      );
    }

    // Schedule next action
    if (config.state.working) {
      setTimeout(performAction, 1000);
    }
  };

  // Start the behavior loop
  performAction();
}

function startSocializing(config: VillageBotConfig): void {
  config.chatInterval = setInterval(() => {
    if (Math.random() < 0.1) {
      // 10% chance every interval
      const message = getRandomChatMessage(config.role);
      config.bot.chat(message);
    }
  }, 15000);
}

// Bot factory function
async function createVillageBot(options: {
  host: string;
  port: number;
  role: Role;
  villageCenter: Vec3;
  homeOffset: { x: number; z: number };
  index: number;
}): Promise<VillageBotConfig> {
  const bot = mineflayer.createBot({
    host: options.host,
    port: options.port,
    username: `${options.role.name}${options.index}`,
  });

  const config: VillageBotConfig = {
    bot,
    role: options.role,
    villageCenter: options.villageCenter,
    homePosition: getHomePosition(options.villageCenter, options.homeOffset),
    state: { working: false },
  };

  // Set up event handlers
  bot.once("spawn", () => {
    console.log(`${bot.username} spawned`);
    config.state.working = true;

    // Initialize navigation ability
    initializeNavigation(bot);

    // Start behaviors
    startBehaviorLoop(config);
    startSocializing(config);
  });

  bot.on("error", (err) => {
    console.error(`${bot.username} error:`, err.message);
  });

  // Return config for management
  return config;
}

// Main simulation
async function runVillageSimulation(): Promise<void> {
  console.log("🏘️ Starting Village Life Simulation");
  const villageCenter = new Vec3(0, 64, 0);
  const botConfigs: VillageBotConfig[] = [];

  // Village layout configuration
  const layout = [
    { role: ROLES.GUARD, offset: { x: 0, z: 0 } },
    { role: ROLES.FARMER, offset: { x: 5, z: 5 } },
    { role: ROLES.FARMER, offset: { x: -5, z: 5 } },
    { role: ROLES.MINER, offset: { x: 5, z: -5 } },
    { role: ROLES.MINER, offset: { x: -5, z: -5 } },
    { role: ROLES.LOGGER, offset: { x: 10, z: 0 } },
    { role: ROLES.LOGGER, offset: { x: -10, z: 0 } },
  ];

  // Spawn villagers
  for (let i = 0; i < layout.length; i++) {
    const config = layout[i];
    try {
      const botConfig = await createVillageBot({
        host: "localhost",
        port: 25565,
        role: config.role,
        villageCenter: villageCenter,
        homeOffset: config.offset,
        index: i,
      });

      botConfigs.push(botConfig);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(
        `Failed to spawn bot ${i}:`,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  console.log(`Village populated with ${botConfigs.length} villagers!`);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🏁 Village simulation ending...");
    for (const config of botConfigs) {
      config.state.working = false;
      if (config.chatInterval) clearInterval(config.chatInterval);
      await new Promise((resolve) => setTimeout(resolve, 100));
      config.bot.quit();
    }
    process.exit(0);
  });
}

// Start the simulation
runVillageSimulation().catch((error) => {
  console.error("Village simulation failed:", error);
  process.exit(1);
});
