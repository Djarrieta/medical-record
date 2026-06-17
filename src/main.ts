import { Config } from "./config";
import { FileStore } from "./fileStore";
import { BotApp } from "./bot";

const config = new Config();
const fileStore = new FileStore(config.botConfig.dataDir);
const bot = new BotApp(config.botConfig, fileStore);

process.on("SIGINT", async () => {
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await bot.stop();
  process.exit(0);
});

bot.start();
