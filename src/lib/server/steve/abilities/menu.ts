/**
 * Interactive menu system for Minecraft bots
 *
 * @example
 * ```typescript
 * import { showMenu } from "$lib/server/steve/abilities/menu";
 *
 * showMenu(bot, [
 *   { name: "Echo messages", handler: (bot) => { ... } },
 *   { name: "Follow player", handler: (bot) => { ... } }
 * ], setActiveTask);
 * ```
 */

import type { Bot } from "mineflayer";
import { logInfo } from "./log.ts";

export interface MenuItem {
  name: string;
  handler: (bot: Bot, username?: string) => void;
}

export type TaskHandler = ((username: string, message: string) => void) | null;

/**
 * Display a numbered menu in chat and wait for user selection
 */
export function showMenu(
  bot: Bot,
  items: MenuItem[],
  setActiveTask: (task: TaskHandler) => void,
): void {
  // Display menu only in console, not in game chat
  console.log("What should I do?");
  items.forEach((item, index) => {
    console.log(`${index + 1}. ${item.name}`);
  });

  let taskSelected = false;

  setActiveTask((username, message) => {
    if (taskSelected) return;

    const choice = parseInt(message.trim());

    if (isNaN(choice) || choice < 1 || choice > items.length) {
      console.log(
        `Invalid choice: ${choice}. Please enter a number between 1 and ${items.length}`,
      );
      return;
    }

    taskSelected = true;
    const selected = items[choice - 1];
    console.log(`Starting: ${selected.name}`);
    logInfo(null, `Task selected: ${selected.name}`, {
      chat: false,
      file: false,
    });

    selected.handler(bot, username);
  });
}
