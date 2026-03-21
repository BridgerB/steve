/**
 * Wood gathering task - punch trees to get logs
 */

import type { Bot, Pathfinder } from "typecraft";
import type { StepResult } from "../../types.ts";
import { createPathfinder, createGoalNear, windowItems } from "typecraft";
import { vec3, distance, offset, type Vec3 } from "typecraft";

export const gatherWood = async (
  bot: Bot,
  targetCount: number,
): Promise<StepResult> => {
  const pf = createPathfinder(bot);

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
    windowItems(bot.inventory)
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

    // Re-fetch the block fresh (in case world changed)
    const block = bot.blockAt(vec3(targetX, targetY, targetZ)) as { position: Vec3; name: string; stateId: number } | null;
    if (!block || !isLog(block)) {
      console.log(`    Block at y=${targetY} is already gone (${block?.name})`);
      return true;
    }

    // Check distance - bot.dig() requires being within ~4.5 blocks
    const blockCenter = vec3(targetX + 0.5, targetY + 0.5, targetZ + 0.5);
    const dist = distance(bot.entity.position, blockCenter);
    console.log(
      `    Mining ${block.name} at y=${targetY}, dist=${dist.toFixed(2)}`,
    );

    if (dist > 4.5) {
      console.log(`    Too far to mine (${dist.toFixed(2)} > 4.5)`);
      return false;
    }

    // Look at the block center
    await bot.lookAt(blockCenter);
    await new Promise((r) => setTimeout(r, 100));

    // Dig the block directly (forceLook=true)
    try {
      await bot.dig(block, true);
      console.log(`    Dig completed`);
    } catch (e) {
      console.log(`    Dig error: ${e}`);
      return false;
    }

    // Verify it's gone
    await new Promise((r) => setTimeout(r, 100));
    const after = bot.blockAt(vec3(targetX, targetY, targetZ)) as { position: Vec3; name: string; stateId: number } | null;
    if (after && isLog(after)) {
      console.log(`    Block still there after dig!`);
      return false;
    }

    console.log(`    Block mined, collecting drop...`);

    // Walk into the space where the block was to collect the drop
    const dropPos = vec3(targetX + 0.5, targetY, targetZ + 0.5);
    await bot.lookAt(dropPos);
    await new Promise((r) => setTimeout(r, 50));

    // Use pathfinder to walk to drop position
    try {
      const goal = createGoalNear(targetX, targetY, targetZ, 0);
      await Promise.race([
        pf.goto(goal),
        new Promise((r) => setTimeout(r, 3000)), // 3s timeout
      ]);
    } catch (_e) {
      // Ignore pathfinding errors - just walk forward
      bot.setControlState("forward", true);
      await new Promise((r) => setTimeout(r, 500));
      bot.setControlState("forward", false);
    }

    await new Promise((r) => setTimeout(r, 300));
    console.log(`    Have ${countLogs()} logs`);
    return true;
  };

  // Navigate to a position with stuck detection
  const goTo = async (pos: Vec3): Promise<boolean> => {
    const goal = createGoalNear(pos.x, pos.y, pos.z, 2);

    // Track position to detect stuck
    let lastPos = vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
    let stuckTime = 0;
    let stopped = false;
    const checkInterval = 100; // ms
    const stuckThreshold = 2000; // ms without moving = stuck (increased from 500)

    const stuckChecker = setInterval(() => {
      if (stopped) return;

      const currentPos = bot.entity.position;
      const moved = distance(currentPos, lastPos) > 0.05;
      if (moved) {
        lastPos = vec3(currentPos.x, currentPos.y, currentPos.z);
        stuckTime = 0;
      } else {
        stuckTime += checkInterval;
      }

      if (stuckTime >= stuckThreshold && !stopped) {
        stopped = true;
        console.log(`    Stuck for ${stuckThreshold}ms, cancelling`);
        clearInterval(stuckChecker);
        pf.stop();
      }
    }, checkInterval);

    try {
      await pf.goto(goal);
      stopped = true;
      clearInterval(stuckChecker);
      return true;
    } catch (_err) {
      stopped = true;
      clearInterval(stuckChecker);
      return distance(bot.entity.position, pos) <= 3;
    }
  };

  let searchAttempts = 0;
  const maxSearchAttempts = 5;

  while (countLogs() < targetCount) {
    // Find nearest log
    const log = bot.findBlock({
      matching: (name: string) => logTypes.includes(name),
      maxDistance: 64,
    }) as { position: Vec3; name: string; stateId: number } | null;

    if (!log) {
      if (searchAttempts < maxSearchAttempts) {
        searchAttempts++;
        console.log(`  No trees found, exploring...`);
        const angle = Math.random() * Math.PI * 2;
        await goTo(
          vec3(
            bot.entity.position.x + Math.cos(angle) * 30,
            bot.entity.position.y,
            bot.entity.position.z + Math.sin(angle) * 30,
          ),
        );
        continue;
      }
      return { success: countLogs() >= targetCount, message: `No trees found` };
    }

    searchAttempts = 0;

    try {
      // Use this log to identify the tree column
      const treeX = log.position.x;
      const treeZ = log.position.z;
      console.log(`  Found tree at column (${treeX}, ${treeZ})`);

      // Find ALL logs in this column (scan around the found log's position)
      const findLogsInColumn = (): Vec3[] => {
        const logs: Vec3[] = [];
        // Scan from 10 below to 30 above the found log
        const startY = Math.max(1, log.position.y - 10);
        const endY = Math.min(255, log.position.y + 30);
        for (let y = startY; y <= endY; y++) {
          const pos = vec3(treeX, y, treeZ);
          const block = bot.blockAt(pos) as { position: Vec3; name: string; stateId: number } | null;
          if (block && isLog(block)) {
            logs.push(pos);
          }
        }
        return logs;
      };

      let logsInColumn = findLogsInColumn();
      if (logsInColumn.length === 0) {
        console.log(`  No logs found in column`);
        continue;
      }

      console.log(
        `  Found ${logsInColumn.length} logs in column (y=${
          logsInColumn[0].y
        } to y=${logsInColumn[logsInColumn.length - 1].y})`,
      );

      // Go stand next to the LOWEST log
      const lowestLogY = logsInColumn[0].y;
      const adjacent = [
        vec3(treeX + 1, lowestLogY, treeZ),
        vec3(treeX - 1, lowestLogY, treeZ),
        vec3(treeX, lowestLogY, treeZ + 1),
        vec3(treeX, lowestLogY, treeZ - 1),
      ].sort((a, b) =>
        distance(bot.entity.position, a) - distance(bot.entity.position, b)
      );

      let reached = false;
      for (const pos of adjacent) {
        if (await goTo(pos)) {
          reached = true;
          break;
        }
      }

      if (!reached) {
        console.log(`  Could not reach tree`);
        continue;
      }

      const groundY = Math.floor(bot.entity.position.y);

      // Phase 1: Mine bottom 2 logs from the side (at groundY and groundY+1)
      console.log(
        `  Phase 1: Mining bottom logs from side (groundY=${groundY})`,
      );
      for (const logPos of logsInColumn) {
        if (logPos.y <= groundY + 1) {
          const success = await mineAndCollect(logPos);
          if (success) {
            console.log(
              `  Mined log at y=${logPos.y}, have ${countLogs()}/${targetCount} logs`,
            );
          }
          if (countLogs() >= targetCount) break;
        }
      }

      if (countLogs() >= targetCount) continue;

      // Phase 2: Move INTO the tree column (where logs used to be) and mine the rest from below
      // Re-scan column to see what's left
      logsInColumn = findLogsInColumn();
      if (logsInColumn.length === 0) {
        console.log(`  Tree cleared`);
        continue;
      }

      console.log(
        `  Phase 2: Moving under tree to mine ${logsInColumn.length} remaining logs`,
      );

      // Since we've cleared the bottom logs, we can walk directly into the tree column
      // Look at the center of the tree column at our height and walk forward
      const treeCenter = vec3(
        treeX + 0.5,
        bot.entity.position.y + 0.5,
        treeZ + 0.5,
      );
      await bot.lookAt(treeCenter);
      await new Promise((r) => setTimeout(r, 100));

      // Walk forward until we're close to the tree center
      const targetDist = 0.5; // Want to be within 0.5 blocks of tree center (XZ plane)
      const maxWalkTime = 2000;
      const startTime = Date.now();

      bot.setControlState("forward", true);
      while (Date.now() - startTime < maxWalkTime) {
        const dx = (treeX + 0.5) - bot.entity.position.x;
        const dz = (treeZ + 0.5) - bot.entity.position.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);

        if (distXZ < targetDist) {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      bot.setControlState("forward", false);
      await new Promise((r) => setTimeout(r, 100));

      console.log(
        `  Now at (${bot.entity.position.x.toFixed(1)}, ${
          bot.entity.position.y.toFixed(1)
        }, ${bot.entity.position.z.toFixed(1)}), tree at (${treeX}, ${treeZ})`,
      );

      // Mine remaining logs from below (looking up)
      while (countLogs() < targetCount) {
        logsInColumn = findLogsInColumn();
        if (logsInColumn.length === 0) {
          console.log(`  No more logs in column`);
          break;
        }

        // Mine the lowest remaining log (should be directly above us now)
        const success = await mineAndCollect(logsInColumn[0]);
        if (success) {
          console.log(
            `  Mined log at y=${
              logsInColumn[0].y
            }, have ${countLogs()}/${targetCount} logs`,
          );
        } else {
          console.log(`  Failed to mine log at y=${logsInColumn[0].y}`);
          break;
        }
      }
    } catch (err) {
      console.log(`  Error: ${err}`);
    }
  }

  return {
    success: countLogs() >= targetCount,
    message: `Gathered ${countLogs()} logs`,
  };
};
