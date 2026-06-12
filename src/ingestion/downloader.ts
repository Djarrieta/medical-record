/**
 * Download files sent directly in Telegram (plan §5, within the 20 MB Bot API limit).
 */

import { config } from "../config.ts";

/** Fetch a Telegram file by its `file_path` (from getFile) and return its bytes. */
export async function downloadTelegramFile(filePath: string): Promise<Uint8Array> {
  const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar el archivo de Telegram (HTTP ${res.status}).`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
