import { readFileSync } from "fs";

// A registered user, loaded from users.json (replaces ALLOWED_USER_ID).
// `email` is the attribution key for forwarded mail — a user with no email can
// still use the bot but cannot forward emails into the shared mailbox.
export interface UserRecord {
  id: number;
  name: string;
  email?: string;
}

export interface BotConfig {
  botToken: string;
  users: UserRecord[];
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
  webUrlLocal?: string;
  webUrlTailscale?: string;
  sessionTtlMs: number;
  sessionWarningGraceMs: number;
  sessionSweepMs: number;
  // Email ingestion (Gmail poller). Disabled by default so the app boots
  // without Gmail credentials.
  emailEnabled: boolean;
  emailPollMs: number;
  emailQueryDays: number;
  gmailClientId?: string;
  gmailClientSecret?: string;
  gmailRefreshToken?: string;
  gmailUser?: string;
}

export class Config {
  readonly botConfig: BotConfig;

  constructor() {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) throw new Error("BOT_TOKEN is required");

    const users = loadUsers();
    if (users.length === 0)
      throw new Error("No users configured (set USERS or USERS_FILE; at least one is required)");
    const allowedUserIds = users.map((u) => u.id);

    const webPort = parseInt(process.env.WEB_PORT ?? "3000", 10);

    const sessionTtlSeconds = parseInt(process.env.SESSION_TTL_SECONDS ?? "1800", 10);
    const sessionWarningGraceSeconds = parseInt(
      process.env.SESSION_WARNING_GRACE_SECONDS ?? "120",
      10,
    );
    const sessionSweepSeconds = parseInt(process.env.SESSION_SWEEP_SECONDS ?? "30", 10);

    const emailEnabled = (process.env.EMAIL_ENABLED ?? "false").toLowerCase() === "true";
    const emailPollSeconds = parseInt(process.env.EMAIL_POLL_SECONDS ?? "300", 10);
    const emailQueryDays = parseInt(process.env.EMAIL_QUERY_DAYS ?? "7", 10);

    this.botConfig = {
      botToken,
      users,
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
      webUrlLocal: process.env.WEB_URL_LOCAL,
      webUrlTailscale: process.env.WEB_URL_TAILSCALE,
      sessionTtlMs: sessionTtlSeconds * 1000,
      sessionWarningGraceMs: sessionWarningGraceSeconds * 1000,
      sessionSweepMs: sessionSweepSeconds * 1000,
      emailEnabled,
      emailPollMs: emailPollSeconds * 1000,
      emailQueryDays,
      gmailClientId: process.env.GMAIL_CLIENT_ID,
      gmailClientSecret: process.env.GMAIL_CLIENT_SECRET,
      gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN,
      gmailUser: process.env.GMAIL_USER,
    };
  }
}

// Loads and validates the user registry. Prefers an inline `USERS` env var
// (a JSON array — handy so the server only maintains a single .env file); falls
// back to the `USERS_FILE` JSON file (default ./users.json). Throws on a missing
// or malformed source (mirrors the old "ALLOWED_USER_ID is required" hard fail).
function loadUsers(): UserRecord[] {
  const inline = process.env.USERS?.trim();
  if (inline) return parseUsers(inline, "USERS env var");

  const path = process.env.USERS_FILE ?? "./users.json";
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Users source not found: set USERS in .env, or create ${path} (copy users.json.example)`);
  }
  return parseUsers(raw, `Users file ${path}`);
}

// Parses + validates a JSON array of users from a raw string. `source` labels
// error messages (either the env var or the file path).
function parseUsers(raw: string, source: string): UserRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }

  if (!Array.isArray(parsed))
    throw new Error(`${source} must be a JSON array`);

  return parsed.map((entry, i) => {
    if (typeof entry !== "object" || entry === null)
      throw new Error(`${source}: entry ${i} is not an object`);
    const { id, name, email } = entry as Record<string, unknown>;
    if (typeof id !== "number" || !Number.isFinite(id))
      throw new Error(`${source}: entry ${i} has an invalid "id"`);
    if (typeof name !== "string" || name.trim() === "")
      throw new Error(`${source}: entry ${i} has an invalid "name"`);
    if (email !== undefined && typeof email !== "string")
      throw new Error(`${source}: entry ${i} has an invalid "email"`);
    return {
      id,
      name,
      email: typeof email === "string" ? email.trim() : undefined,
    };
  });
}
