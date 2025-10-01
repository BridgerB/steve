import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";

interface BotOptions {
  host: string;
  port: number;
  username: string;
  version?: string;
}

const options: BotOptions = {
  host: "localhost",
  port: 25565,
  username: "Steve",
};

const bot: Bot = mineflayer.createBot(options);

bot.once("spawn", () => {
  console.log("Steve spawned into the world");

  setTimeout(() => {
    console.log("10 seconds passed, disconnecting...");
    bot.quit();
  }, 10000);
});

bot.on("end", () => {
  console.log("Steve disconnected");
  process.exit(0);
});

bot.on("error", (err: Error) => {
  console.error("Bot error:", err.message);
  process.exit(1);
});
