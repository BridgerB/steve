import type { Bot } from "mineflayer";

export async function mineBlock(bot: Bot, block: any): Promise<boolean> {
  if (!block) return false;

  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
  await bot.dig(block);
  return true;
}

export async function canMineBlock(bot: Bot): Promise<boolean> {
  const tool = bot.inventory.items().find((item) => {
    return (
      item.name.includes("_pickaxe") ||
      item.name.includes("_axe") ||
      item.name.includes("_shovel")
    );
  });
  return !!tool;
}
