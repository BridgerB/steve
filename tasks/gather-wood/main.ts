/**
 * Wood gathering task - punch trees to get logs
 */

import type { Bot } from "mineflayer";
import type { StepResult } from "../../types.ts";
import { pathfinder, Movements, goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

export const gatherWood = async (
  bot: Bot,
  targetCount: number,
): Promise<StepResult> => {
  // Load pathfinder plugin if not already loaded
  // deno-lint-ignore no-explicit-any
  if (!(bot as any).pathfinder) {
    bot.loadPlugin(pathfinder);
  }
  
  // deno-lint-ignore no-explicit-any
  const botAny = bot as any;
  // deno-lint-ignore no-explicit-any
  const movements = new Movements(bot as any);
  movements.canDig = true;
  movements.allowParkour = false;
  movements.allowSprinting = true;
  botAny.pathfinder.setMovements(movements);

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

  // Helper to count logs in inventory
  const countLogs = () =>
    bot.inventory.items()
      .filter((i: { name: string }) => i.name.includes("_log"))
      .reduce((sum: number, i: { count: number }) => sum + i.count, 0);

  // Helper to check if block is a log
  const isLog = (block: { name: string } | null) => 
    block && logTypes.includes(block.name);

  // Mine a block, wait until gone, then collect the dropped item
  const mineAndCollect = async (pos: Vec3): Promise<boolean> => {
    const targetX = pos.x;
    const targetY = pos.y;
    const targetZ = pos.z;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      // Get the EXACT block at this position
      const block = bot.blockAt(new Vec3(targetX, targetY, targetZ));
      if (!block || !isLog(block)) {
        console.log(`    Block at y=${targetY} is already gone (${block?.name})`);
        return true;
      }
      
      console.log(`    Attempt ${attempt + 1}: Mining ${block.name} at y=${targetY}`);
      
      // Look at the CENTER of this exact block
      const blockCenter = new Vec3(targetX + 0.5, targetY + 0.5, targetZ + 0.5);
      await bot.lookAt(blockCenter);
      await new Promise(r => setTimeout(r, 150));
      
      // VERIFY we are looking at the right block before mining
      const looking = bot.blockAtCursor(5);
      if (!looking || looking.position.x !== targetX || looking.position.y !== targetY || looking.position.z !== targetZ) {
        console.log(`    NOT looking at target! Looking at ${looking?.name} at y=${looking?.position.y}, want y=${targetY}`);
        // Try adjusting look angle slightly lower if we're looking too high
        if (looking && looking.position.y > targetY) {
          console.log(`    Adjusting aim lower...`);
          await bot.lookAt(new Vec3(targetX + 0.5, targetY + 0.2, targetZ + 0.5));
          await new Promise(r => setTimeout(r, 150));
        }
        const lookingRetry = bot.blockAtCursor(5);
        if (!lookingRetry || lookingRetry.position.y !== targetY) {
          console.log(`    Still not looking at target, skipping this attempt`);
          continue;
        }
      }
      
      console.log(`    Confirmed looking at y=${targetY}, digging...`);
      
      // Dig the block - forceLook=true ensures we keep looking at it
      try {
        const startTime = Date.now();
        await bot.dig(block, true); // forceLook = true
        const elapsed = Date.now() - startTime;
        console.log(`    Dig completed in ${elapsed}ms`);
      } catch (e) {
        console.log(`    Dig error: ${e}`);
      }
      
      // Wait and verify the EXACT position
      await new Promise(r => setTimeout(r, 200));
      const after = bot.blockAt(new Vec3(targetX, targetY, targetZ));
      console.log(`    After: block at y=${targetY} is now ${after?.name}`);
      
      if (!after || !isLog(after)) {
        console.log(`    SUCCESS - block gone, collecting...`);
        
        // Walk to where the block was to collect the drop
        const dropPos = new Vec3(targetX, targetY, targetZ);
        await bot.lookAt(dropPos);
        
        // Walk forward with stuck detection
        const startPos = bot.entity.position.clone();
        bot.setControlState("forward", true);
        
        for (let t = 0; t < 6; t++) {
          await new Promise(r => setTimeout(r, 100));
          const moved = bot.entity.position.distanceTo(startPos) > 0.1;
          if (!moved && t >= 3) {
            console.log(`    Stuck while collecting, stopping`);
            break;
          }
        }
        
        bot.setControlState("forward", false);
        await new Promise(r => setTimeout(r, 200));
        
        console.log(`    Have ${countLogs()} logs now`);
        return true;
      }
      
      console.log(`    FAILED: Block still at y=${targetY}, retrying...`);
    }
    
    return false;
  };

  // Navigate to a position with stuck detection
  const goTo = async (pos: Vec3): Promise<boolean> => {
    const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 1);
    
    // Track position to detect stuck
    let lastPos = bot.entity.position.clone();
    let stuckTime = 0;
    let stopped = false;
    const checkInterval = 100; // ms
    const stuckThreshold = 500; // ms without moving = stuck
    
    const stuckChecker = setInterval(() => {
      if (stopped) return;
      
      const currentPos = bot.entity.position;
      const moved = currentPos.distanceTo(lastPos) > 0.1;
      if (moved) {
        lastPos = currentPos.clone();
        stuckTime = 0;
      } else {
        stuckTime += checkInterval;
      }
      
      if (stuckTime >= stuckThreshold && !stopped) {
        stopped = true;
        console.log(`    Stuck, cancelling`);
        clearInterval(stuckChecker);
        botAny.pathfinder.stop();
      }
    }, checkInterval);
    
    try {
      await botAny.pathfinder.goto(goal);
      stopped = true;
      clearInterval(stuckChecker);
      return true;
    } catch (_err) {
      stopped = true;
      clearInterval(stuckChecker);
      return bot.entity.position.distanceTo(pos) <= 2;
    }
  };

  let searchAttempts = 0;
  const maxSearchAttempts = 5;

  while (countLogs() < targetCount) {
    // Find nearest log
    const log = bot.findBlock({
      matching: (block: { name: string }) => logTypes.includes(block.name),
      maxDistance: 64,
    });

    if (!log) {
      if (searchAttempts < maxSearchAttempts) {
        searchAttempts++;
        console.log(`  No trees found, exploring...`);
        const angle = Math.random() * Math.PI * 2;
        await goTo(new Vec3(
          bot.entity.position.x + Math.cos(angle) * 30,
          bot.entity.position.y,
          bot.entity.position.z + Math.sin(angle) * 30
        ));
        continue;
      }
      return { success: countLogs() >= targetCount, message: `No trees found` };
    }

    searchAttempts = 0;
    const treeX = log.position.x;
    const treeZ = log.position.z;

    try {
      console.log(`  Found tree at x=${treeX}, z=${treeZ}`);
      
      // Mine the tree one log at a time, always getting the lowest first
      let treeComplete = false;
      while (!treeComplete && countLogs() < targetCount) {
        const botY = Math.floor(bot.entity.position.y);
        
        // Find the lowest log in this column that we can reach (within 2 blocks of our height)
        let lowestLog: Vec3 | null = null;
        for (let y = botY - 1; y <= botY + 2; y++) {
          const pos = new Vec3(treeX, y, treeZ);
          const block = bot.blockAt(pos);
          if (block && isLog(block)) {
            lowestLog = pos;
            break; // Found the lowest reachable, stop looking
          }
        }
        
        if (!lowestLog) {
          console.log(`  No reachable logs in column (bot at y=${botY})`);
          treeComplete = true;
          break;
        }
        
        console.log(`  Lowest reachable log at y=${lowestLog.y} (bot at y=${botY})`);
        
        // Go next to this log
        const adjacent = [
          new Vec3(treeX + 1, lowestLog.y, treeZ),
          new Vec3(treeX - 1, lowestLog.y, treeZ),
          new Vec3(treeX, lowestLog.y, treeZ + 1),
          new Vec3(treeX, lowestLog.y, treeZ - 1),
        ].sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b));

        let reached = false;
        for (const pos of adjacent) {
          if (await goTo(pos)) { reached = true; break; }
        }
        if (!reached) { 
          console.log(`  Could not reach log`); 
          treeComplete = true;
          break;
        }

        // Mine this one log and collect it
        const success = await mineAndCollect(lowestLog);
        if (!success) {
          console.log(`  Failed to mine log, moving on`);
          treeComplete = true;
          break;
        }
        
        console.log(`  Have ${countLogs()}/${targetCount} logs`);
      }

    } catch (err) {
      console.log(`  Error: ${err}`);
    }
  }

  return { success: countLogs() >= targetCount, message: `Gathered ${countLogs()} logs` };
};
