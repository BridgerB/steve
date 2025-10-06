/**
 * Chat message parsing for Minecraft bots
 *
 * @example
 * ```typescript
 * import { onChat } from "$lib/server/steve/abilities/chat";
 *
 * onChat(bot, (username, message) => {
 *   console.log(`${username}: ${message}`);
 * });
 * ```
 */

import type { Bot } from "mineflayer";

/**
 * Register a handler for all chat messages (ignores bot's own messages)
 */
export function onChat(
  bot: Bot,
  handler: (username: string, message: string) => void,
): void {
  bot.on("chat", (username, message) => {
    // Ignore self
    if (username === bot.username) return;

    handler(username, message);
  });
}
