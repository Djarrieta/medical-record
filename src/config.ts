import type { BotConfig } from "./types";

export class Config {
  readonly botConfig: BotConfig;

  constructor() {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) throw new Error("BOT_TOKEN is required");

    const allowedUserId = Number(process.env.ALLOWED_USER_ID);
    if (!allowedUserId) throw new Error("ALLOWED_USER_ID is required");

    this.botConfig = {
      botToken,
      allowedUserId,
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      dataDir: process.env.DATA_DIR ?? "./data",
    };
  }
}
