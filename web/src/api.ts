import type { FileRecord, Note, Password, TagKind, UploadResult } from "./types";

// Auth comes from the URL: /u/<userId>?token=<sessionToken>.
const PATH_MATCH = window.location.pathname.match(/\/u\/(\d+)/);
export const USER_ID = PATH_MATCH ? PATH_MATCH[1] : "";
export const TOKEN = new URLSearchParams(window.location.search).get("token") || "";

// The API calls enforce auth; on a 401 the session is gone, so we notify the
// app once to swap in the "session expired" screen.
let onExpired: () => void = () => {};
export function setOnExpired(cb: () => void): void {
  onExpired = cb;
}

// Append the auth params (userId + token) to any API URL.
export function authQuery(extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  p.set("userId", USER_ID);
  p.set("token", TOKEN);
  if (extra) for (const k in extra) p.set(k, extra[k]);
  return p.toString();
}

function expired(res: Response): boolean {
  if (res.status === 401) {
    onExpired();
    return true;
  }
  return false;
}

export function rawUrl(id: string, download: boolean): string {
  return (
    "/api/files/" +
    encodeURIComponent(id) +
    "/raw?" +
    authQuery(download ? { download: "1" } : undefined)
  );
}

export async function listFiles(): Promise<FileRecord[] | null> {
  try {
    const res = await fetch("/api/files?" + authQuery());
    if (expired(res)) return null;
    if (!res.ok) return null;
    return (await res.json()) as FileRecord[];
  } catch {
    return null;
  }
}

export async function listNotes(): Promise<Note[] | null> {
  try {
    const res = await fetch("/api/notes?" + authQuery());
    if (expired(res)) return null;
    if (!res.ok) return null;
    return (await res.json()) as Note[];
  } catch {
    return null;
  }
}

export async function deleteFile(id: string): Promise<boolean> {
  try {
    const res = await fetch("/api/files/" + encodeURIComponent(id) + "?" + authQuery(), {
      method: "DELETE",
    });
    if (expired(res)) return false;
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteNote(id: string): Promise<boolean> {
  try {
    const res = await fetch("/api/notes/" + encodeURIComponent(id) + "?" + authQuery(), {
      method: "DELETE",
    });
    if (expired(res)) return false;
    return res.ok;
  } catch {
    return false;
  }
}

export async function createNote(text: string, title?: string): Promise<Note | null> {
  try {
    const res = await fetch("/api/notes?" + authQuery(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, title }),
    });
    if (expired(res)) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; note?: Note };
    return data.ok && data.note ? data.note : null;
  } catch {
    return null;
  }
}

export async function updateNote(id: string, text: string, title?: string): Promise<Note | null> {
  try {
    const res = await fetch("/api/notes/" + encodeURIComponent(id) + "?" + authQuery(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, title }),
    });
    if (expired(res)) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; note?: Note };
    return data.ok && data.note ? data.note : null;
  } catch {
    return null;
  }
}

export async function listPasswords(): Promise<Password[] | null> {
  try {
    const res = await fetch("/api/passwords?" + authQuery());
    if (expired(res)) return null;
    if (!res.ok) return null;
    return (await res.json()) as Password[];
  } catch {
    return null;
  }
}

export async function addPassword(password: string): Promise<Password[] | null> {
  try {
    const res = await fetch("/api/passwords?" + authQuery(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (expired(res)) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; passwords?: Password[] };
    return data.passwords ?? null;
  } catch {
    return null;
  }
}

export async function deletePassword(id: number): Promise<boolean> {
  try {
    const res = await fetch("/api/passwords/" + id + "?" + authQuery(), { method: "DELETE" });
    if (expired(res)) return false;
    return res.ok;
  } catch {
    return false;
  }
}

// Replaces the full tag list for a file/note. Returns the normalized tags the
// server stored, or null on failure.
export async function patchTags(
  kind: TagKind,
  id: string,
  tags: string[],
): Promise<string[] | null> {
  try {
    const res = await fetch(
      "/api/" + kind + "s/" + encodeURIComponent(id) + "/tags?" + authQuery(),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      },
    );
    if (expired(res)) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { tags?: string[] };
    return data.tags ?? tags;
  } catch {
    return null;
  }
}

export async function uploadFile(file: File): Promise<UploadResult> {
  try {
    const headers: Record<string, string> = {
      "X-File-Name": encodeURIComponent(file.name),
      "Content-Type": file.type || "application/octet-stream",
    };
    const res = await fetch("/upload?" + authQuery(), { method: "POST", headers, body: file });
    if (res.status === 401) {
      onExpired();
      return { ok: false, expired: true };
    }
    let data: Partial<UploadResult> = {};
    try {
      data = (await res.json()) as Partial<UploadResult>;
    } catch {
      /* ignore non-JSON bodies */
    }
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ? String(data.error) : "HTTP " + res.status };
    }
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
