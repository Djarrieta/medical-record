import { existsSync, readFileSync, writeFileSync } from "fs";

import type { MailMessage, MailAttachment } from "../../domain/types";
import type { MailSource, SenderAllowlist } from "../../domain/ports";

// Delegated OAuth2 scopes. `offline_access` is required to receive a refresh
// token; `Mail.Read` to list messages and attachments.
export const GRAPH_SCOPES = "offline_access Mail.Read";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export function tokenEndpoint(authority: string): string {
  return `https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`;
}

export function authorizeEndpoint(authority: string): string {
  return `https://login.microsoftonline.com/${authority}/oauth2/v2.0/authorize`;
}

interface StoredToken {
  refreshToken: string;
  accessToken?: string;
  // Epoch milliseconds when `accessToken` expires.
  expiresAt?: number;
}

export interface OutlookGraphMailSourceOptions {
  clientId: string;
  authority: string;
  tokenPath: string;
  allowlist: SenderAllowlist;
}

// Strip HTML tags to plain text (Graph returns HTML bodies by default). Crude
// but enough to make an informational email searchable as a note.
function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Reads Outlook/Hotmail mail through Microsoft Graph using a delegated OAuth2
// refresh token (the only flow available for personal accounts). The refresh
// token rotates on each exchange and is persisted back to `tokenPath`.
export class OutlookGraphMailSource implements MailSource {
  constructor(private readonly opts: OutlookGraphMailSourceOptions) {}

  private readToken(): StoredToken {
    if (!existsSync(this.opts.tokenPath)) {
      throw new Error(
        `No graph token at ${this.opts.tokenPath}. Run \`bun run auth:mail\` first.`,
      );
    }
    return JSON.parse(readFileSync(this.opts.tokenPath, "utf8")) as StoredToken;
  }

  private writeToken(token: StoredToken): void {
    writeFileSync(this.opts.tokenPath, JSON.stringify(token, null, 2));
  }

  // Return a valid access token, refreshing (and persisting the rotated refresh
  // token) when the cached one is missing or about to expire.
  private async accessToken(): Promise<string> {
    const stored = this.readToken();
    if (stored.accessToken && stored.expiresAt && stored.expiresAt - 60_000 > Date.now()) {
      return stored.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
      scope: GRAPH_SCOPES,
    });

    const res = await fetch(tokenEndpoint(this.opts.authority), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(`Graph token refresh failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const next: StoredToken = {
      refreshToken: json.refresh_token ?? stored.refreshToken,
      accessToken: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    this.writeToken(next);
    return next.accessToken!;
  }

  async fetchMessages(opts: {
    stopAtProcessed?: (id: string) => boolean;
  }): Promise<MailMessage[]> {
    const token = await this.accessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const select = "id,subject,from,receivedDateTime,body";
    let url: string | null =
      `${GRAPH_BASE}/me/messages?$top=50&$select=${select}` +
      `&$orderby=receivedDateTime%20desc&$expand=attachments`;

    const out: MailMessage[] = [];
    let stop = false;

    while (url && !stop) {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Graph messages fetch failed (${res.status}): ${await res.text()}`);
      }
      const page = (await res.json()) as { value: any[]; "@odata.nextLink"?: string };

      for (const raw of page.value) {
        const id = raw.id as string;
        // Messages are newest-first; once we reach one already processed, every
        // older message is processed too, so stop paginating.
        if (opts.stopAtProcessed?.(id)) {
          stop = true;
          break;
        }

        const from = (raw.from?.emailAddress?.address as string) ?? "";
        if (!this.opts.allowlist.matches(from)) continue;

        out.push(this.mapMessage(raw, id, from));
      }

      url = stop ? null : page["@odata.nextLink"] ?? null;
    }

    return out;
  }

  private mapMessage(raw: any, id: string, from: string): MailMessage {
    const contentType = raw.body?.contentType as string | undefined;
    const content = (raw.body?.content as string) ?? "";
    const bodyText = contentType === "html" ? stripHtml(content) : content.trim();

    const attachments: MailAttachment[] = [];
    for (const att of (raw.attachments as any[]) ?? []) {
      if (att["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
      if (typeof att.contentBytes !== "string") continue;
      attachments.push({
        name: (att.name as string) ?? "attachment",
        mimeType: (att.contentType as string) ?? "application/octet-stream",
        buffer: Buffer.from(att.contentBytes, "base64"),
      });
    }

    return {
      id,
      from,
      subject: (raw.subject as string) ?? "",
      receivedAt: (raw.receivedDateTime as string) ?? "",
      bodyText,
      attachments,
    };
  }
}
