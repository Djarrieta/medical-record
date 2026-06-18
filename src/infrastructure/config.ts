export interface BotConfig {
  botToken: string;
  allowedUserIds: number[];
  deepseekApiKey?: string;
  deepseekModel: string;
  deepseekBaseUrl: string;
  dataDir: string;
  qdrantUrl: string;
  embeddingModel: string;
  webHost: string;
  webPort: number;
  webPassword?: string;
  webUrl: string;
}

export class Config {
  readonly botConfig: BotConfig;

  constructor() {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) throw new Error("BOT_TOKEN is required");

    const allowedUserIds = (process.env.ALLOWED_USER_ID ?? "")
      .split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id) && id !== 0);
    if (allowedUserIds.length === 0)
      throw new Error("ALLOWED_USER_ID is required");

    const webPort = parseInt(process.env.WEB_PORT ?? "3000", 10);

    this.botConfig = {
      botToken,
      allowedUserIds,
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      dataDir: process.env.DATA_DIR ?? "./data",
      qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
      embeddingModel: process.env.EMBEDDING_MODEL ?? "Xenova/multilingual-e5-small",
      webHost: process.env.WEB_HOST ?? "0.0.0.0",
      webPort,
      webPassword: process.env.WEB_PASSWORD,
      webUrl: process.env.WEB_URL ?? `http://REDACTED-HOST:${webPort}`,
    };
  }
}
