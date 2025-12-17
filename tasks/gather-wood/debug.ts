/**
 * Debug script to test mining a single log and see what happens
 */

import mineflayer from "mineflayer";
import { Vec3 } from "vec3";

const bot = mineflayer.createBot({
  host: "localhost",
  port: 25565,
  username: "DebugBot",
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
  console.log(`Bot spawned at ${bot.entity.position}`);
  await new Promise((r) => setTimeout(r, 1000));

  // Find nearest log
  const log = bot.findBlock({
    matching: (block: { name: string }) => logTypes.includes(block.name),
    maxDistance: 64,
  });

  if (!log) {
    console.log("No trees found!");
    bot.quit();
    return;
  }

  console.log(`Found log: ${log.name} at ${log.position}`);

  const treeX = log.position.x;
  const treeZ = log.position.z;

  // Find lowest log in column
  let lowestY = log.position.y;
  for (let y = log.position.y - 5; y < log.position.y; y++) {
    const block = bot.blockAt(new Vec3(treeX, y, treeZ));
    if (block && isLog(block)) {
      lowestY = y;
      break;
    }
  }

  console.log(`Lowest log at y=${lowestY}`);

  // Check what's at cursor before anything
  console.log(`\n=== BEFORE MOVING ===`);
  console.log(`Bot position: ${bot.entity.position}`);
  console.log(`Bot yaw: ${bot.entity.yaw}, pitch: ${bot.entity.pitch}`);
  const cursorBefore = bot.blockAtCursor(5);
  console.log(
    `Block at cursor: ${cursorBefore?.name} at ${cursorBefore?.position}`,
  );

  // Look at the log
  const targetPos = new Vec3(treeX, lowestY, treeZ);
  console.log(`\n=== LOOKING AT LOG ===`);
  console.log(`Target: ${targetPos}`);
  await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5));
  await new Promise((r) => setTimeout(r, 200));

  console.log(`After lookAt:`);
  console.log(`Bot yaw: ${bot.entity.yaw}, pitch: ${bot.entity.pitch}`);
  const cursorAfterLook = bot.blockAtCursor(5);
  console.log(
    `Block at cursor: ${cursorAfterLook?.name} at ${cursorAfterLook?.position}`,
  );

  // Check distance
  const dist = bot.entity.position.distanceTo(targetPos);
  console.log(`Distance to target: ${dist.toFixed(2)}`);

  if (dist > 4) {
    console.log(`Too far, need to get closer first`);
    // Walk toward it
    bot.setControlState("forward", true);
    await new Promise((r) => setTimeout(r, 2000));
    bot.setControlState("forward", false);
    await new Promise((r) => setTimeout(r, 500));

    const newDist = bot.entity.position.distanceTo(targetPos);
    console.log(`New distance: ${newDist.toFixed(2)}`);
    console.log(`New position: ${bot.entity.position}`);
  }

  // Look again
  await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5));
  await new Promise((r) => setTimeout(r, 200));

  console.log(`\n=== ATTEMPTING TO MINE ===`);
  const blockToMine = bot.blockAt(targetPos);
  console.log(`Block at target position: ${blockToMine?.name}`);

  if (!blockToMine || !isLog(blockToMine)) {
    console.log(`No log at target position!`);
    bot.quit();
    return;
  }

  // Check what we're actually looking at
  const cursorBlock = bot.blockAtCursor(5);
  console.log(
    `Block at cursor: ${cursorBlock?.name} at ${cursorBlock?.position}`,
  );

  if (cursorBlock?.position.equals(targetPos)) {
    console.log(`GOOD: Looking at the correct block`);
  } else {
    console.log(`BAD: Looking at wrong block!`);
    console.log(`  Want: ${targetPos}`);
    console.log(`  Have: ${cursorBlock?.position}`);
  }

  // Set up item collector listener
  bot.on("playerCollect", (collector, collected) => {
    console.log(
      `COLLECT EVENT: ${collector.username} collected ${collected.name}`,
    );
  });

  // Listen for item spawn
  bot.on("itemDrop", (entity) => {
    console.log(`ITEM DROP: ${entity.name} at ${entity.position}`);
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
  const afterBlock = bot.blockAt(targetPos);
  console.log(`\n=== AFTER DIG ===`);
  console.log(`Block at target: ${afterBlock?.name}`);

  if (!afterBlock || afterBlock.name === "air") {
    console.log(`SUCCESS: Block was mined!`);
  } else {
    console.log(`FAILED: Block still there!`);
  }

  // Check inventory before collecting
  const logsBefore = bot.inventory.items().filter((i: any) =>
    i.name.includes("_log")
  );
  console.log(
    `Logs in inventory before: ${
      logsBefore.reduce((s: number, i: any) => s + i.count, 0)
    }`,
  );

  // Try to collect the drop by walking to the block position
  console.log(`\n=== COLLECTING DROP ===`);
  console.log(`Walking to ${targetPos}`);

  await bot.lookAt(targetPos);
  await new Promise((r) => setTimeout(r, 100));

  // Walk toward drop
  bot.setControlState("forward", true);
  await new Promise((r) => setTimeout(r, 1500));
  bot.setControlState("forward", false);

  console.log(`Now at: ${bot.entity.position}`);
  console.log(
    `Distance to target: ${
      bot.entity.position.distanceTo(targetPos).toFixed(2)
    }`,
  );

  // Wait for pickup
  await new Promise((r) => setTimeout(r, 500));

  // Check inventory after
  const logsAfter = bot.inventory.items().filter((i: any) =>
    i.name.includes("_log")
  );
  console.log(
    `Logs in inventory after: ${
      logsAfter.reduce((s: number, i: any) => s + i.count, 0)
    }`,
  );

  // Check nearby entities (dropped items)
  const items = Object.values(bot.entities).filter((e: any) =>
    e.name === "item"
  );
  console.log(`Nearby item entities: ${items.length}`);
  for (const item of items.slice(0, 3)) {
    const i = item as any;
    const d = i.position.distanceTo(bot.entity.position);
    console.log(`  Item at ${i.position}, dist=${d.toFixed(2)}`);
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
  Deno.exit(0);
});
