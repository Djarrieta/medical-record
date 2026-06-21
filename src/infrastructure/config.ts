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
  webUrl: string;
  sessionTtlMs: number;
  sessionWarningGraceMs: number;
  sessionSweepMs: number;
  // Mail ingestion (Microsoft Graph, personal account). Optional: when
  // graphClientId is unset, the feature is disabled.
  graphClientId?: string;
  graphAuthority: string;
  graphTokenPath: string;
  mailPollMs: number;
  mailUserId: number;
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

    const sessionTtlSeconds = parseInt(process.env.SESSION_TTL_SECONDS ?? "1800", 10);
    const sessionWarningGraceSeconds = parseInt(
      process.env.SESSION_WARNING_GRACE_SECONDS ?? "120",
      10,
    );
    const sessionSweepSeconds = parseInt(process.env.SESSION_SWEEP_SECONDS ?? "30", 10);

    const mailPollSeconds = parseInt(process.env.MAIL_POLL_SECONDS ?? "600", 10);
    const mailUserId = process.env.MAIL_USER_ID
      ? Number(process.env.MAIL_USER_ID)
      : allowedUserIds[0];

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
      webUrl: process.env.WEB_URL ?? `http://localhost:${webPort}`,
      sessionTtlMs: sessionTtlSeconds * 1000,
      sessionWarningGraceMs: sessionWarningGraceSeconds * 1000,
      sessionSweepMs: sessionSweepSeconds * 1000,
      graphClientId: process.env.GRAPH_CLIENT_ID,
      graphAuthority: process.env.GRAPH_AUTHORITY ?? "consumers",
      graphTokenPath:
        process.env.GRAPH_TOKEN_PATH ??
        `${process.env.DATA_DIR ?? "./data"}/graph-token.json`,
      mailPollMs: mailPollSeconds * 1000,
      mailUserId,
    };
  }
}
