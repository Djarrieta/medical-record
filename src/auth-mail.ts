import { createHash, randomBytes } from "crypto";
import { writeFileSync } from "fs";

import {
  GRAPH_SCOPES,
  authorizeEndpoint,
  tokenEndpoint,
} from "./infrastructure/mail/outlookGraphMailSource";

// One-time interactive helper to obtain a Microsoft Graph refresh token for a
// personal Outlook/Hotmail account (delegated OAuth2 + PKCE). Run once with
// `bun run auth:mail`; the runtime then refreshes access tokens automatically.

const clientId = process.env.GRAPH_CLIENT_ID;
if (!clientId) {
  console.error("GRAPH_CLIENT_ID is required (set it in .env).");
  process.exit(1);
}

const authority = process.env.GRAPH_AUTHORITY ?? "consumers";
const tokenPath = process.env.GRAPH_TOKEN_PATH ?? "./data/graph-token.json";
const port = parseInt(process.env.GRAPH_REDIRECT_PORT ?? "53682", 10);
const redirectUri = `http://localhost:${port}`;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const codeVerifier = base64url(randomBytes(32));
const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

const authUrl =
  `${authorizeEndpoint(authority)}?` +
  new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: GRAPH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

async function exchangeCode(code: string): Promise<void> {
  const body = new URLSearchParams({
    client_id: clientId!,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    scope: GRAPH_SCOPES,
  });
  const res = await fetch(tokenEndpoint(authority), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  writeFileSync(
    tokenPath,
    JSON.stringify(
      {
        refreshToken: json.refresh_token,
        accessToken: json.access_token,
        expiresAt: Date.now() + json.expires_in * 1000,
      },
      null,
      2,
    ),
  );
}

const done = Promise.withResolvers<void>();

const server = Bun.serve({
  port,
  hostname: "localhost",
  async fetch(req) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      done.reject(new Error(`Authorization error: ${error} ${url.searchParams.get("error_description") ?? ""}`));
      return new Response("Autorización fallida. Puedes cerrar esta pestaña.", { status: 400 });
    }
    if (!code) {
      return new Response("Esperando el parámetro 'code'...", { status: 400 });
    }

    try {
      await exchangeCode(code);
      done.resolve();
      return new Response("✅ Autorización completa. Ya puedes cerrar esta pestaña.");
    } catch (err) {
      done.reject(err as Error);
      return new Response("Error al intercambiar el código. Revisa la consola.", { status: 500 });
    }
  },
});

console.log("\nAbre esta URL en tu navegador y autoriza el acceso:\n");
console.log(authUrl + "\n");
console.log(`Escuchando el redirect en ${redirectUri} ...\n`);

try {
  await done.promise;
  console.log(`✅ Refresh token guardado en ${tokenPath}`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  server.stop(true);
}
