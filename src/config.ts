/**
 * Centralized configuration loaded from environment variables (via dotenv).
 * Validates required values and exposes a typed config.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function intOpt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value || value.trim() === "") return fallback;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseUserIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n)),
  );
}

const allowedRaw = optional("ALLOWED_USER_IDS", "");
const allowedUserIds = parseUserIds(allowedRaw);

if (allowedUserIds.size === 0) {
  // Fail loud: an empty allowlist would let nobody in (and signals misconfiguration).
  console.warn(
    "[config] ALLOWED_USER_IDS is empty — no users will be allowed until it is set.",
  );
}

export const config = {
  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN"),
  },
  llm: {
    provider: optional("LLM_PROVIDER", "deepseek"),
    apiKey: optional("DEEPSEEK_API_KEY", ""),
    baseUrl: optional("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    model: optional("LLM_MODEL", "deepseek-chat"),
    timeoutMs: intOpt("LLM_TIMEOUT_MS", 30_000),
    maxRetries: intOpt("LLM_MAX_RETRIES", 3),
  },
  embeddings: {
    provider: optional("EMBEDDING_PROVIDER", "local"),
    model: optional("EMBEDDING_MODEL", "Xenova/multilingual-e5-small"),
    cacheDir: optional("MODEL_CACHE_DIR", "./data/models"),
    dimension: 384,
  },
  web: {
    enabled: optional("WEB_UI_ENABLED", "true") === "true",
    host: optional("WEB_HOST", "0.0.0.0"),
    port: intOpt("WEB_PORT", 3003),
    baseUrl: optional("WEB_BASE_URL", "http://localhost:3003"),
    uploadTokenTtlMin: intOpt("UPLOAD_TOKEN_TTL_MIN", 10),
  },
  storage: {
    dataDir: optional("DATA_DIR", "./data"),
  },
  limits: {
    qaPerHour: intOpt("RATE_LIMIT_QA_PER_HOUR", 30),
    maxUploadMb: intOpt("MAX_UPLOAD_MB", 200),
    ingestConcurrency: intOpt("INGEST_CONCURRENCY", 1),
  },
  allowedUserIds,
} as const;

export type AppConfig = typeof config;

