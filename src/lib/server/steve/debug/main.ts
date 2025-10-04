import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";

// Configuration
const CONFIG = {
  host: "localhost",
  port: 25565,
  username: "DebugBot",
  autoExitSeconds: 30,
};

function createBot(): Bot {
  return mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
  });
}

// Display comprehensive bot state
function displayBotState(bot: Bot): void {
  console.log("\n" + "=".repeat(60));
  console.log("🤖 BOT STATE");
  console.log("=".repeat(60));

  // Basic info
  console.log(`\n📋 Basic Info:`);
  console.log(`  Username: ${bot.username}`);
  console.log(`  Version: ${bot.version} (${bot.majorVersion})`);

  // Position & dimension
  console.log(`\n📍 Position:`);
  const pos = bot.entity.position;
  console.log(
    `  Coordinates: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${
      pos.z.toFixed(2)
    })`,
  );
  console.log(`  Dimension: ${bot.game.dimension}`);
  console.log(`  Gamemode: ${bot.game.gameMode}`);
  console.log(`  Difficulty: ${bot.game.difficulty ?? "N/A"}`);

  // Health & food
  console.log(`\n❤️  Health & Food:`);
  console.log(`  Health: ${bot.health ?? 0}/20`);
  console.log(`  Food: ${bot.food ?? 0}/20`);
  console.log(`  Saturation: ${(bot.foodSaturation ?? 0).toFixed(1)}`);
  const oxygen = bot.oxygenLevel ?? 20; // Default to full oxygen
  console.log(`  Oxygen: ${oxygen}/20`);

  // Experience
  console.log(`\n⭐ Experience:`);
  console.log(`  Level: ${bot.experience.level}`);
  console.log(`  Points: ${bot.experience.points}`);
  console.log(`  Progress: ${(bot.experience.progress * 100).toFixed(1)}%`);

  // World info
  console.log(`\n🌍 World:`);
  console.log(`  Time: ${bot.time.timeOfDay} (Day ${bot.time.day})`);
  console.log(`  Raining: ${bot.isRaining ? "Yes" : "No"}`);
  const spawn = bot.spawnPoint;
  console.log(`  Spawn Point: (${spawn.x}, ${spawn.y}, ${spawn.z})`);

  // Inventory
  console.log(`\n🎒 Inventory:`);
  console.log(`  Held Item: ${bot.heldItem ? bot.heldItem.name : "none"}`);
  console.log(`  Quick Bar Slot: ${bot.quickBarSlot}`);
  const itemCount = bot.inventory.items().length;
  console.log(`  Items: ${itemCount}/36`);

  // Control state
  console.log(`\n🎮 Control State:`);
  console.log(`  Forward: ${bot.controlState.forward}`);
  console.log(`  Sprinting: ${bot.controlState.sprint}`);
  console.log(`  Jumping: ${bot.controlState.jump}`);
  console.log(`  Sneaking: ${bot.controlState.sneak}`);

  // Nearby entities
  const nearbyPlayers = Object.values(bot.players).filter(
    (p) =>
      p.entity && p.username !== bot.username &&
      bot.entity.position.distanceTo(p.entity.position) < 32,
  );
  console.log(`\n👥 Nearby Players (< 32 blocks): ${nearbyPlayers.length}`);
  if (nearbyPlayers.length > 0) {
    nearbyPlayers.forEach((p) => {
      const dist = bot.entity.position.distanceTo(p.entity.position).toFixed(1);
      console.log(`  - ${p.username} (${dist} blocks away)`);
    });
  }

  const nearbyEntities = Object.values(bot.entities).filter(
    (e) =>
      e.type !== "player" && e.position &&
      bot.entity.position.distanceTo(e.position) < 16,
  );
  console.log(`\n🐾 Nearby Entities (< 16 blocks): ${nearbyEntities.length}`);
  if (nearbyEntities.length > 0) {
    const entityTypes = nearbyEntities.reduce((acc, e) => {
      const type = e.name || e.type || "unknown";
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    Object.entries(entityTypes).forEach(([type, count]) => {
      console.log(`  - ${type}: ${count}`);
    });
  }

  console.log("=".repeat(60) + "\n");
}

// Handle interactive commands
function setupCommands(bot: Bot): void {
  bot.on("chat", (username, message) => {
    // Only respond to other players (not self)
    if (username === bot.username) return;

    console.log(`<${username}> ${message}`);

    // Command: !status
    if (message === "!status") {
      displayBotState(bot);
      bot.chat("Status displayed in console!");
    }

    // Command: !jump
    if (message === "!jump") {
      bot.setControlState("jump", true);
      setTimeout(() => bot.setControlState("jump", false), 500);
      bot.chat("Jumping!");
    }

    // Command: !spin
    if (message === "!spin") {
      bot.chat("Spinning!");
      let angle = 0;
      const spinInterval = setInterval(() => {
        angle += Math.PI / 8;
        bot.look(angle, 0, false);
        if (angle >= Math.PI * 2) {
          clearInterval(spinInterval);
          bot.chat("Done spinning!");
        }
      }, 100);
    }

    // Command: !come
    if (message === "!come") {
      const player = bot.players[username];
      if (player && player.entity) {
        bot.chat(`Coming to you, ${username}!`);
        const goal = player.entity.position;
        bot.lookAt(goal);
        bot.setControlState("forward", true);
        bot.setControlState("sprint", true);

        const stopInterval = setInterval(() => {
          const dist = bot.entity.position.distanceTo(goal);
          if (dist < 2) {
            bot.clearControlStates();
            clearInterval(stopInterval);
            bot.chat("I'm here!");
          }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
          bot.clearControlStates();
          clearInterval(stopInterval);
        }, 10000);
      }
    }

    // Command: !inv
    if (message === "!inv") {
      const items = bot.inventory.items();
      if (items.length === 0) {
        bot.chat("Inventory is empty!");
      } else {
        bot.chat(`I have ${items.length} items:`);
        items.slice(0, 5).forEach((item) => {
          bot.chat(`- ${item.name} x${item.count}`);
        });
        if (items.length > 5) {
          bot.chat(`... and ${items.length - 5} more`);
        }
      }
    }

    // Command: !help
    if (message === "!help") {
      bot.chat("Commands: !status, !jump, !spin, !come, !inv, !help");
    }
  });
}

async function main(): Promise<void> {
  console.log("🔧 Debug Bot Starting...");
  const bot = createBot();

  bot.on("error", (err) => {
    console.error("❌ Bot error:", err.message);
  });

  bot.once("spawn", async () => {
    console.log("✅ Bot spawned successfully!");
    console.log(`Position: ${bot.entity.position}`);

    bot.chat("Starting automated debug tests...");

    // Setup interactive commands
    setupCommands(bot);

    // Log player joins
    bot.on("playerJoined", (player) => {
      console.log(`👋 Player joined: ${player.username}`);
    });

    bot.on("playerLeft", (player) => {
      console.log(`👋 Player left: ${player.username}`);
    });

    // Log health changes (only after initial)
    let firstHealth = true;
    bot.on("health", () => {
      if (firstHealth) {
        firstHealth = false;
        return;
      }
      console.log(
        `❤️  Health: ${bot.health}/20 | Food: ${bot.food}/20 | Saturation: ${
          bot.foodSaturation.toFixed(1)
        }`,
      );
    });

    // Log experience changes
    bot.on("experience", () => {
      console.log(
        `⭐ Level ${bot.experience.level} | ${bot.experience.points} points | ${
          (bot.experience.progress * 100).toFixed(1)
        }%`,
      );
    });

    // Wait for health event before starting automated tests
    await new Promise<void>((resolve) => {
      bot.once("health", () => {
        setTimeout(resolve, 500);
      });
    });

    console.log("\n🧪 Running automated debug tests...\n");

    // Test 1: Display initial state
    console.log("📊 Test 1: Display Bot State");
    displayBotState(bot);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test 2: Look around
    console.log("👀 Test 2: Looking Around (8 directions)");
    for (let i = 0; i < 8; i++) {
      const yaw = (i / 8) * Math.PI * 2;
      await bot.look(yaw, 0, false);
      console.log(
        `  Looking ${(yaw * 180 / Math.PI).toFixed(0)}° (${i + 1}/8)`,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log("  ✓ Look test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 3: Jump test
    console.log("🦘 Test 3: Jump Test (5 jumps)");
    for (let i = 0; i < 5; i++) {
      bot.setControlState("jump", true);
      console.log(`  Jump ${i + 1}/5`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      bot.setControlState("jump", false);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log("  ✓ Jump test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 4: Movement test
    console.log("🚶 Test 4: Movement Test (forward, back, left, right)");
    const moves = [
      { dir: "forward", label: "Forward" },
      { dir: "back", label: "Backward" },
      { dir: "left", label: "Strafe Left" },
      { dir: "right", label: "Strafe Right" },
    ] as const;

    for (const move of moves) {
      const startPos = bot.entity.position.clone();
      bot.setControlState(move.dir, true);
      console.log(`  ${move.label}...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      bot.setControlState(move.dir, false);
      const endPos = bot.entity.position.clone();
      const distance = startPos.distanceTo(endPos);
      console.log(`  Moved ${distance.toFixed(2)} blocks`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log("  ✓ Movement test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 5: Sprint test
    console.log("🏃 Test 5: Sprint Test");
    const sprintStart = bot.entity.position.clone();
    bot.setControlState("forward", true);
    bot.setControlState("sprint", true);
    console.log("  Sprinting forward for 2 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    bot.clearControlStates();
    const sprintEnd = bot.entity.position.clone();
    const sprintDist = sprintStart.distanceTo(sprintEnd);
    console.log(`  Sprint distance: ${sprintDist.toFixed(2)} blocks`);
    console.log("  ✓ Sprint test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 6: Inventory check
    console.log("🎒 Test 6: Inventory Check");
    const items = bot.inventory.items();
    console.log(`  Total items: ${items.length}/36`);
    console.log(`  Held item: ${bot.heldItem?.name ?? "none"}`);
    if (items.length > 0) {
      console.log("  Items in inventory:");
      items.forEach((item) => {
        console.log(`    - ${item.name} x${item.count}`);
      });
    }
    console.log("  ✓ Inventory check complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 7: Nearby entities scan
    console.log("🔍 Test 7: Scanning Nearby Entities");
    const players = Object.values(bot.players).filter(
      (p) =>
        p.entity && p.username !== bot.username &&
        bot.entity.position.distanceTo(p.entity.position) < 32,
    );
    console.log(`  Players nearby: ${players.length}`);
    if (players.length > 0) {
      players.forEach((p) => {
        const dist = bot.entity.position.distanceTo(p.entity.position);
        console.log(`    - ${p.username} (${dist.toFixed(1)} blocks)`);
      });
    }

    const entities = Object.values(bot.entities).filter(
      (e) =>
        e.type !== "player" && e.position &&
        bot.entity.position.distanceTo(e.position) < 16,
    );
    console.log(`  Other entities: ${entities.length}`);
    if (entities.length > 0) {
      const types = entities.reduce((acc, e) => {
        const type = e.name || e.type || "unknown";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      Object.entries(types).forEach(([type, count]) => {
        console.log(`    - ${type}: ${count}`);
      });
    }
    console.log("  ✓ Entity scan complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 8: Crouch/Sneak test
    console.log("🤫 Test 8: Crouch/Sneak Test");
    bot.setControlState("sneak", true);
    console.log("  Sneaking for 2 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    bot.setControlState("sneak", false);
    console.log("  ✓ Sneak test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 9: Look up and down (pitch test)
    console.log("🔺 Test 9: Pitch Test (look up/down)");
    const pitches = [
      { angle: -Math.PI / 2, label: "Up (90°)" },
      { angle: -Math.PI / 4, label: "Up (45°)" },
      { angle: 0, label: "Straight (0°)" },
      { angle: Math.PI / 4, label: "Down (45°)" },
      { angle: Math.PI / 2, label: "Down (90°)" },
    ];
    for (const { angle, label } of pitches) {
      await bot.look(bot.entity.yaw, angle, false);
      console.log(`  Looking ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    console.log("  ✓ Pitch test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 10: Block finding test
    console.log("🔍 Test 10: Block Finding Test");
    try {
      const nearbyBlock = bot.findBlock({
        matching: (block) => block.name !== "air",
        maxDistance: 32,
        count: 1,
      });
      if (nearbyBlock) {
        console.log(`  Found block: ${nearbyBlock.name}`);
        console.log(
          `  Position: (${nearbyBlock.position.x}, ${nearbyBlock.position.y}, ${nearbyBlock.position.z})`,
        );
        console.log(
          `  Distance: ${
            bot.entity.position.distanceTo(nearbyBlock.position).toFixed(2)
          } blocks`,
        );

        // Try to look at the block
        await bot.lookAt(nearbyBlock.position);
        console.log("  Looking at block...");
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Check if we can see it
        const canSee = bot.canSeeBlock(nearbyBlock);
        console.log(`  Can see block: ${canSee ? "Yes" : "No"}`);
      } else {
        console.log("  No blocks found nearby");
      }
    } catch (error) {
      console.log(
        `  Error finding blocks: ${
          error instanceof Error ? error.message : "Unknown"
        }`,
      );
    }
    console.log("  ✓ Block finding test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 11: Physics state test
    console.log("⚡ Test 11: Physics State Test");
    console.log(`  On ground: ${bot.entity.onGround}`);
    console.log(`  In water: ${bot.entity.isInWater}`);
    console.log(`  In lava: ${bot.entity.isInLava}`);
    console.log(`  In web: ${bot.entity.isInWeb}`);
    console.log(
      `  Velocity: (${bot.entity.velocity.x.toFixed(2)}, ${
        bot.entity.velocity.y.toFixed(2)
      }, ${bot.entity.velocity.z.toFixed(2)})`,
    );
    console.log(`  Yaw: ${(bot.entity.yaw * 180 / Math.PI).toFixed(1)}°`);
    console.log(`  Pitch: ${(bot.entity.pitch * 180 / Math.PI).toFixed(1)}°`);
    console.log("  ✓ Physics state test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 12: Biome detection test
    console.log("🌲 Test 12: Biome Detection Test");
    try {
      const biome = bot.blockAt(bot.entity.position)?.biome;
      if (biome) {
        console.log(`  Current biome: ${biome.name}`);
        console.log(`  Biome ID: ${biome.id}`);
        console.log(
          `  Temperature: ${biome.temperature?.toFixed(2) ?? "N/A"}`,
        );
        console.log(`  Rainfall: ${biome.rainfall?.toFixed(2) ?? "N/A"}`);
      } else {
        console.log("  Biome data not available");
      }
    } catch (error) {
      console.log(
        `  Error getting biome: ${
          error instanceof Error ? error.message : "Unknown"
        }`,
      );
    }
    console.log("  ✓ Biome detection test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 13: Chat message test
    console.log("💬 Test 13: Chat Message Test");
    const messages = [
      "Testing chat functionality!",
      "Can you see these messages?",
      "Debug bot reporting in! 🤖",
    ];
    for (let i = 0; i < messages.length; i++) {
      bot.chat(messages[i]);
      console.log(`  Sent: "${messages[i]}"`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log("  ✓ Chat message test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 14: Hand swap test
    console.log("🤚 Test 14: Hand Swap Test");
    console.log(`  Main hand: ${bot.settings.mainHand}`);
    console.log(`  Held item slot: ${bot.quickBarSlot}`);
    // Cycle through hotbar slots
    for (let slot = 0; slot < 9; slot++) {
      bot.setQuickBarSlot(slot);
      console.log(`  Switched to hotbar slot ${slot}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    bot.setQuickBarSlot(0); // Reset to slot 0
    console.log("  ✓ Hand swap test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 15: Rain/Weather detection
    console.log("🌧️  Test 15: Weather Detection Test");
    console.log(`  Is raining: ${bot.isRaining ? "Yes" : "No"}`);
    console.log(`  Thunder state: ${bot.thunderState}`);
    console.log(`  World time: ${bot.time.time}`);
    console.log(`  Time of day: ${bot.time.timeOfDay}`);
    console.log(
      `  Day/Night cycle: ${bot.time.doDaylightCycle ? "On" : "Off"}`,
    );
    console.log(`  Moon phase: ${bot.time.moonPhase}`);
    console.log("  ✓ Weather detection test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 16: Connection & server info
    console.log("🌐 Test 16: Connection & Server Info");
    console.log(`  Server brand: ${bot.game.serverBrand}`);
    console.log(`  Protocol version: ${bot.protocolVersion}`);
    console.log(`  Max players: ${bot.game.maxPlayers}`);
    console.log(`  Hardcore mode: ${bot.game.hardcore ? "Yes" : "No"}`);
    console.log(`  Total players online: ${Object.keys(bot.players).length}`);
    console.log(`  Physics enabled: ${bot.physicsEnabled ? "Yes" : "No"}`);
    console.log("  ✓ Connection info test complete\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 17: Final state display
    console.log("📊 Test 17: Final Bot State");
    displayBotState(bot);

    console.log("✅ All automated tests complete!\n");
    bot.chat("All debug tests complete!");

    // Auto-exit
    console.log("⏱️  Exiting in 3 seconds...");
    setTimeout(() => {
      bot.quit("Debug session complete");
    }, 3000);
  });

  bot.on("kicked", (reason) => {
    console.log("🚫 Bot was kicked:", reason);
    process.exit(1);
  });

  bot.on("end", () => {
    console.log("👋 Bot disconnected");
    process.exit(0);
  });
}

// Handle Ctrl+C
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
