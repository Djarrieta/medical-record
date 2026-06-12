/**
 * Encrypted-PDF detection and unlocking (plan §7).
 *
 * Strategy:
 *  - Try to open with no password. If pdf.js reports a password is needed, the PDF is encrypted.
 *  - Try each candidate password in turn; return the one that works.
 *  - If none works, throw `PdfLockedError` so the caller can ask the user for a password.
 *
 * Passwords are secrets: never logged here.
 */

import { getDocumentProxy } from "unpdf";

export class PdfLockedError extends Error {
  constructor(message = "El PDF está protegido con contraseña y no se pudo abrir.") {
    super(message);
    this.name = "PdfLockedError";
  }
}

/** True if a pdf.js error indicates the document needs a (different) password. */
export function isPasswordError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name ?? "";
  const message = (err as { message?: string }).message ?? "";
  return (
    name === "PasswordException" ||
    /password/i.test(message) ||
    /needpassword|incorrectpassword/i.test(name)
  );
}

export interface UnlockResult {
  /** The password that worked, or undefined if the PDF was never encrypted. */
  password?: string;
  /** Whether the PDF was encrypted at all. */
  wasEncrypted: boolean;
}

/**
 * Determine the working password for a PDF (or confirm it's not encrypted).
 * `candidates` should be ordered most-recently-used first.
 */
export async function resolvePdfPassword(
  data: Uint8Array,
  candidates: string[],
): Promise<UnlockResult> {
  // 1. Try with no password.
  try {
    await getDocumentProxy(data);
    return { wasEncrypted: false };
  } catch (err) {
    if (!isPasswordError(err)) throw err; // a non-encryption error: propagate.
  }

  // 2. Encrypted — try each candidate.
  for (const password of candidates) {
    try {
      await getDocumentProxy(data, { password });
      return { password, wasEncrypted: true };
    } catch (err) {
      if (!isPasswordError(err)) throw err;
      // wrong password, try the next one
    }
  }

  throw new PdfLockedError();
}
