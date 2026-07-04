// One-time helper to mint a Gmail (+ Calendar) refresh token for the app.
//
//   bun run scripts/google-auth.ts
//
// It prints a consent URL, starts a tiny loopback server to catch the redirect,
// exchanges the code, and prints GMAIL_REFRESH_TOKEN to paste into .env.
// Not part of the running app — pure setup convenience.

import { createServer } from "http";

import { Config } from "../src/infrastructure/config";
import {
  GOOGLE_REDIRECT_URI,
  GOOGLE_SCOPES,
  createOAuthClient,
} from "../src/infrastructure/google/googleAuth";

const cfg = new Config().botConfig;
const client = createOAuthClient(cfg);

const authUrl = client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force a refresh_token even on re-consent
  scope: GOOGLE_SCOPES,
});

const redirectPort = new URL(GOOGLE_REDIRECT_URI).port || "53682";

console.log("\n1. Open this URL in your browser and grant access:\n");
console.log(authUrl);
console.log("\n2. Waiting for the redirect on", GOOGLE_REDIRECT_URI, "...\n");

const server = createServer(async (req, res) => {
  if (!req.url) return;
  const url = new URL(req.url, `http://localhost:${redirectPort}`);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Missing ?code");
    return;
  }

  try {
    const { tokens } = await client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/plain" }).end(
      "Done. You can close this tab and return to the terminal.",
    );

    if (!tokens.refresh_token) {
      console.error(
        "\nNo refresh_token returned. Revoke the app's access in your Google " +
          "account and run this again (prompt=consent forces a fresh one).\n",
      );
    } else {
      console.log("\nSuccess. Paste this into your .env:\n");
      console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }
  } catch (err) {
    console.error("Token exchange failed:", err);
    res.writeHead(500).end("Token exchange failed; see terminal.");
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 100);
  }
});

server.listen(Number(redirectPort));
