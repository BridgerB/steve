import mineflayer from "mineflayer";

const bot = mineflayer.createBot({
  host: "localhost",
  port: 25565,
  username: "Steve",
});

bot.once("spawn", () => {
  console.log("Steve spawned into the world");
});

bot.on("end", () => {
  console.log("Steve disconnected");
});

bot.on("error", (err) => {
  console.error("Bot error:", err.message);
});
