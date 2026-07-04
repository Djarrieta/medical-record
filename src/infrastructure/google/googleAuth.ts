import { google } from "googleapis";

import type { BotConfig } from "../config";

// The OAuth2 client type as constructed by googleapis itself. Importing
// OAuth2Client from google-auth-library directly clashes with the copy bundled
// inside googleapis-common, so we derive the type from the constructor instead.
export type GoogleOAuthClient = InstanceType<typeof google.auth.OAuth2>;

// OAuth scopes requested for the shared Google client. Gmail is read-only (the
// poller never mutates the mailbox); calendar.events is reserved so a future
// Calendar adapter can reuse the same consent without re-authorizing.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

// The OAuth redirect used by the one-time auth helper script. "oob"/localhost
// style out-of-band flow is avoided; we use a loopback URI the helper prints.
export const GOOGLE_REDIRECT_URI = "http://localhost:53682/oauth2callback";

// Builds a bare OAuth2 client from the configured client id/secret. Shared by
// the running app (authorized via the stored refresh token) and the one-time
// auth helper (which performs the consent flow to mint that refresh token).
export function createOAuthClient(config: BotConfig): GoogleOAuthClient {
  const { gmailClientId, gmailClientSecret } = config;
  if (!gmailClientId || !gmailClientSecret)
    throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required for Google auth");

  return new google.auth.OAuth2(gmailClientId, gmailClientSecret, GOOGLE_REDIRECT_URI);
}

// Returns an authorized OAuth2 client ready for API calls, using the stored
// refresh token. Used by GmailApiSource (and a future Calendar adapter).
export function createGoogleAuth(config: BotConfig): GoogleOAuthClient {
  const client = createOAuthClient(config);
  if (!config.gmailRefreshToken)
    throw new Error("GMAIL_REFRESH_TOKEN is required (run: bun run scripts/google-auth.ts)");
  client.setCredentials({ refresh_token: config.gmailRefreshToken });
  return client;
}
