/**
 * Debug script to test mining a single log and see what happens
 */

import { createBot, vec3, distance, offset, equals, type Vec3, windowItems } from "typecraft";

const bot = createBot({
  host: "localhost",
  port: 25565,
  username: "DebugBot",
  version: "1.21",
});

const logTypes = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
];

const isLog = (block: { name: string } | null) =>
  block && logTypes.includes(block.name);

bot.once("spawn", async () => {
  console.log(`Bot spawned at ${bot.entity.position.x}, ${bot.entity.position.y}, ${bot.entity.position.z}`);
  await new Promise((r) => setTimeout(r, 1000));

  // Find nearest log
  const log = bot.findBlock({
    matching: (name: string) => logTypes.includes(name),
    maxDistance: 64,
  }) as any;

  if (!log) {
    console.log("No trees found!");
    bot.quit();
    return;
  }

  console.log(`Found log: ${log.name} at ${log.position.x}, ${log.position.y}, ${log.position.z}`);

  const treeX = log.position.x;
  const treeZ = log.position.z;

  // Find lowest log in column
  let lowestY = log.position.y;
  for (let y = log.position.y - 5; y < log.position.y; y++) {
    const block = bot.blockAt(vec3(treeX, y, treeZ)) as any;
    if (block && isLog(block)) {
      lowestY = y;
      break;
    }
  }

  console.log(`Lowest log at y=${lowestY}`);

  // Check what's at cursor before anything
  console.log(`\n=== BEFORE MOVING ===`);
  console.log(`Bot position: ${bot.entity.position.x}, ${bot.entity.position.y}, ${bot.entity.position.z}`);
  console.log(`Bot yaw: ${bot.entity.yaw}, pitch: ${bot.entity.pitch}`);
  const cursorBefore = bot.blockAtCursor(5) as any;
  console.log(
    `Block at cursor: ${cursorBefore?.name} at ${cursorBefore?.position?.x}, ${cursorBefore?.position?.y}, ${cursorBefore?.position?.z}`,
  );

  // Look at the log
  const targetPos = vec3(treeX, lowestY, treeZ);
  console.log(`\n=== LOOKING AT LOG ===`);
  console.log(`Target: ${targetPos.x}, ${targetPos.y}, ${targetPos.z}`);
  await bot.lookAt(offset(targetPos, 0.5, 0.5, 0.5));
  await new Promise((r) => setTimeout(r, 200));

  console.log(`After lookAt:`);
  console.log(`Bot yaw: ${bot.entity.yaw}, pitch: ${bot.entity.pitch}`);
  const cursorAfterLook = bot.blockAtCursor(5) as any;
  console.log(
    `Block at cursor: ${cursorAfterLook?.name} at ${cursorAfterLook?.position?.x}, ${cursorAfterLook?.position?.y}, ${cursorAfterLook?.position?.z}`,
  );

  // Check distance
  const dist = distance(bot.entity.position, targetPos);
  console.log(`Distance to target: ${dist.toFixed(2)}`);

  if (dist > 4) {
    console.log(`Too far, need to get closer first`);
    // Walk toward it
    bot.setControlState("forward", true);
    await new Promise((r) => setTimeout(r, 2000));
    bot.setControlState("forward", false);
    await new Promise((r) => setTimeout(r, 500));

    const newDist = distance(bot.entity.position, targetPos);
    console.log(`New distance: ${newDist.toFixed(2)}`);
    console.log(`New position: ${bot.entity.position.x}, ${bot.entity.position.y}, ${bot.entity.position.z}`);
  }

  // Look again
  await bot.lookAt(offset(targetPos, 0.5, 0.5, 0.5));
  await new Promise((r) => setTimeout(r, 200));

  console.log(`\n=== ATTEMPTING TO MINE ===`);
  const blockToMine = bot.blockAt(targetPos) as any;
  console.log(`Block at target position: ${blockToMine?.name}`);

  if (!blockToMine || !isLog(blockToMine)) {
    console.log(`No log at target position!`);
    bot.quit();
    return;
  }

  // Check what we're actually looking at
  const cursorBlock = bot.blockAtCursor(5) as any;
  console.log(
    `Block at cursor: ${cursorBlock?.name} at ${cursorBlock?.position?.x}, ${cursorBlock?.position?.y}, ${cursorBlock?.position?.z}`,
  );

  if (cursorBlock?.position && equals(cursorBlock.position, targetPos)) {
    console.log(`GOOD: Looking at the correct block`);
  } else {
    console.log(`BAD: Looking at wrong block!`);
    console.log(`  Want: ${targetPos.x}, ${targetPos.y}, ${targetPos.z}`);
    console.log(`  Have: ${cursorBlock?.position?.x}, ${cursorBlock?.position?.y}, ${cursorBlock?.position?.z}`);
  }

  // Set up item collector listener
  bot.on("playerCollect" as any, (collector: any, collected: any) => {
    console.log(
      `COLLECT EVENT: ${collector.username} collected ${collected.name}`,
    );
  });

  // Listen for item spawn
  bot.on("itemDrop" as any, (entity: any) => {
    console.log(`ITEM DROP: ${entity.name} at ${entity.position?.x}, ${entity.position?.y}, ${entity.position?.z}`);
  });

  // Try to dig
  console.log(`\nStarting dig...`);
  const startTime = Date.now();
  try {
    await bot.dig(blockToMine, true);
    const elapsed = Date.now() - startTime;
    console.log(`Dig call returned after ${elapsed}ms`);
  } catch (e) {
    console.log(`Dig error: ${e}`);
  }

  // Check result
  await new Promise((r) => setTimeout(r, 300));
  const afterBlock = bot.blockAt(targetPos) as any;
  console.log(`\n=== AFTER DIG ===`);
  console.log(`Block at target: ${afterBlock?.name}`);

  if (!afterBlock || afterBlock.name === "air") {
    console.log(`SUCCESS: Block was mined!`);
  } else {
    console.log(`FAILED: Block still there!`);
  }

  // Check inventory before collecting
  const logsBefore = windowItems(bot.inventory).filter((i) =>
    i.name.includes("_log")
  );
  console.log(
    `Logs in inventory before: ${
      logsBefore.reduce((s, i) => s + i.count, 0)
    }`,
  );

  // Try to collect the drop by walking to the block position
  console.log(`\n=== COLLECTING DROP ===`);
  console.log(`Walking to ${targetPos.x}, ${targetPos.y}, ${targetPos.z}`);

  await bot.lookAt(targetPos);
  await new Promise((r) => setTimeout(r, 100));

  // Walk toward drop
  bot.setControlState("forward", true);
  await new Promise((r) => setTimeout(r, 1500));
  bot.setControlState("forward", false);

  console.log(`Now at: ${bot.entity.position.x}, ${bot.entity.position.y}, ${bot.entity.position.z}`);
  console.log(
    `Distance to target: ${
      distance(bot.entity.position, targetPos).toFixed(2)
    }`,
  );

  // Wait for pickup
  await new Promise((r) => setTimeout(r, 500));

  // Check inventory after
  const logsAfter = windowItems(bot.inventory).filter((i) =>
    i.name.includes("_log")
  );
  console.log(
    `Logs in inventory after: ${
      logsAfter.reduce((s, i) => s + i.count, 0)
    }`,
  );

  // Check nearby entities (dropped items)
  const items = Object.values(bot.entities).filter((e) =>
    e.name === "item"
  );
  console.log(`Nearby item entities: ${items.length}`);
  for (const item of items.slice(0, 3)) {
    const d = distance(item.position, bot.entity.position);
    console.log(`  Item at ${item.position.x}, ${item.position.y}, ${item.position.z}, dist=${d.toFixed(2)}`);
  }

  // Wait a bit then quit
  await new Promise((r) => setTimeout(r, 500));
  bot.quit();
});

bot.on("error", (err) => {
  console.log(`Bot error: ${err}`);
});

bot.on("end", () => {
  console.log("Bot disconnected");
  process.exit(0);
});
