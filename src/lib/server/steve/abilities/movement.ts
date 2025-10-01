import pathfinder from "mineflayer-pathfinder";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";

export function initializeMovement(bot: Bot): void {
  // Load pathfinder plugin
  bot.loadPlugin(pathfinder.pathfinder);

  // Create movements after plugin is loaded
  const movements = new pathfinder.Movements(bot);

  // Set the movements
  bot.pathfinder.setMovements(movements);
}

export async function walkTo(bot: Bot, position: Vec3): Promise<void> {
  const goal = new pathfinder.goals.GoalNear(
    position.x,
    position.y,
    position.z,
    1,
  );
  await bot.pathfinder.goto(goal);
}

export function startSprinting(bot: Bot): void {
  bot.setControlState("sprint", true);
}

export function stopSprinting(bot: Bot): void {
  bot.setControlState("sprint", false);
}
