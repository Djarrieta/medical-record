/**
 * Minimal logger. Deliberately simple: prints structured-ish lines to stdout/stderr.
 * IMPORTANT: never pass document contents, passwords, or tokens to these functions.
 */

type Level = "info" | "warn" | "error" | "debug";

function emit(level: Level, scope: string, message: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] (${scope}) ${message}`;
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra !== undefined) {
    out(line, extra);
  } else {
    out(line);
  }
}

export function createLogger(scope: string) {
  return {
    info: (message: string, extra?: unknown) => emit("info", scope, message, extra),
    warn: (message: string, extra?: unknown) => emit("warn", scope, message, extra),
    error: (message: string, extra?: unknown) => emit("error", scope, message, extra),
    debug: (message: string, extra?: unknown) => {
      if (process.env.DEBUG) emit("debug", scope, message, extra);
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
