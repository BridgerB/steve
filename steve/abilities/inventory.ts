import type { Bot } from "mineflayer";

export interface InventoryChange {
  item: string;
  diff: number;
}

export function setupInventoryTracking(bot: Bot): Map<string, number> {
  const snapshot = new Map<string, number>();
  bot.inventory.items().forEach((item) => {
    snapshot.set(item.name, item.count);
  });
  return snapshot;
}

export function updateInventorySnapshot(
  bot: Bot,
  snapshot: Map<string, number>,
): void {
  snapshot.clear();
  bot.inventory.items().forEach((item) => {
    snapshot.set(item.name, item.count);
  });
}

export function getInventoryChanges(
  bot: Bot,
  previousSnapshot: Map<string, number>,
): InventoryChange[] {
  const changes: InventoryChange[] = [];
  const currentItems = new Map<string, number>();

  // Get current inventory state
  bot.inventory.items().forEach((item) => {
    currentItems.set(item.name, item.count);
  });

  // Compare with previous state
  currentItems.forEach((count, item) => {
    const prevCount = previousSnapshot.get(item) || 0;
    if (count !== prevCount) {
      changes.push({
        item,
        diff: count - prevCount,
      });
    }
  });

  return changes;
}

export function setupInventoryLogging(bot: Bot): void {
  const previousItems = setupInventoryTracking(bot);

  bot.on("playerCollect", (collector) => {
    if (collector.username === bot.username) {
      const changes = getInventoryChanges(bot, previousItems);
      if (changes.length > 0) {
        changes.forEach((change) => {
          if (change.diff > 0) {
            bot.chat(`I just picked up ${change.diff}x ${change.item}`);
          }
        });
        updateInventorySnapshot(bot, previousItems);
      }
    }
  });
}

export async function dropItem(
  bot: Bot,
  itemType: string,
  amount = 1,
): Promise<boolean> {
  const item = bot.inventory.items().find((item) => item.name === itemType);
  if (!item) return false;

  await bot.toss(item.type, null, amount);
  return true;
}

export function hasItem(bot: Bot, itemName: string): boolean {
  return bot.inventory.items().some((item) => item.name === itemName);
}

export function countItem(bot: Bot, itemName: string): number {
  return bot.inventory
    .items()
    .filter((item) => item.name === itemName)
    .reduce((count, item) => count + item.count, 0);
}
