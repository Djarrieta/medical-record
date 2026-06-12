/**
 * Document → raw text extraction (plan §3, §6).
 *
 *  - text/plain        → decode UTF-8
 *  - application/pdf   → native text via unpdf; fall back to OCR for scanned pages
 *  - image/*           → OCR (tesseract.js, Spanish)
 *
 * Returns per-page text so chunks can keep page citations.
 */

import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import type { SourceText } from "./chunker.ts";
import { ocrImage } from "./ocr.ts";
import { renderPdfToImages } from "./pdfRender.ts";
import { resolvePdfPassword, type UnlockResult } from "./pdfUnlock.ts";
import { createLogger } from "../util/logger.ts";

const log = createLogger("extractors");

export interface ExtractInput {
  data: Uint8Array;
  mime: string;
  filename: string;
  /** Candidate PDF passwords, most-recently-used first. */
  candidatePasswords?: string[];
}

export interface ExtractResult {
  pages: SourceText[];
  pageCount: number;
  /** Password that unlocked the PDF (so the caller can persist/mark it). */
  usedPassword?: string;
  wasEncrypted: boolean;
}

/** Minimum characters of native text per page before we consider OCR unnecessary. */
const MIN_NATIVE_CHARS_PER_PAGE = 40;

function isPdf(mime: string, filename: string): boolean {
  return mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

function isImage(mime: string, filename: string): boolean {
  return mime.startsWith("image/") || /\.(png|jpe?g|webp|tiff?)$/i.test(filename);
}

function isText(mime: string, filename: string): boolean {
  return mime.startsWith("text/") || /\.(txt|md|csv)$/i.test(filename);
}

async function extractFromPdf(input: ExtractInput): Promise<ExtractResult> {
  const candidates = input.candidatePasswords ?? [];
  const unlock: UnlockResult = await resolvePdfPassword(input.data, candidates);
  const openOpts = unlock.password ? { password: unlock.password } : undefined;

  // Native text first.
  const proxy = await getDocumentProxy(input.data, openOpts);
  const { text, totalPages } = await extractPdfText(proxy, { mergePages: false });
  const nativePages: string[] = Array.isArray(text) ? text : [text];

  const pages: SourceText[] = [];
  const pagesNeedingOcr: number[] = [];

  for (let i = 0; i < totalPages; i++) {
    const pageText = (nativePages[i] ?? "").trim();
    if (pageText.length >= MIN_NATIVE_CHARS_PER_PAGE) {
      pages.push({ page: i + 1, text: pageText });
    } else {
      pagesNeedingOcr.push(i + 1);
    }
  }

  // Scanned / low-text pages: rasterize and OCR.
  if (pagesNeedingOcr.length > 0) {
    log.info(`OCR needed for ${pagesNeedingOcr.length}/${totalPages} page(s)`);
    const images = await renderPdfToImages(input.data, {
      password: unlock.password,
    });
    const needed = new Set(pagesNeedingOcr);
    for (const { page, image } of images) {
      if (!needed.has(page)) continue;
      const ocrText = await ocrImage(image);
      if (ocrText.trim().length > 0) {
        pages.push({ page, text: ocrText });
      }
    }
  }

  pages.sort((a, b) => a.page - b.page);
  return {
    pages,
    pageCount: totalPages,
    usedPassword: unlock.password,
    wasEncrypted: unlock.wasEncrypted,
  };
}

async function extractFromImage(input: ExtractInput): Promise<ExtractResult> {
  const text = await ocrImage(input.data);
  return {
    pages: text.trim().length > 0 ? [{ page: 1, text }] : [],
    pageCount: 1,
    wasEncrypted: false,
  };
}

function extractFromText(input: ExtractInput): ExtractResult {
  const text = new TextDecoder("utf-8").decode(input.data).trim();
  return {
    pages: text.length > 0 ? [{ page: 1, text }] : [],
    pageCount: 1,
    wasEncrypted: false,
  };
}

/** Dispatch extraction by file type. Throws `PdfLockedError` if a PDF can't be unlocked. */
export async function extract(input: ExtractInput): Promise<ExtractResult> {
  if (isPdf(input.mime, input.filename)) return extractFromPdf(input);
  if (isImage(input.mime, input.filename)) return extractFromImage(input);
  if (isText(input.mime, input.filename)) return extractFromText(input);
  throw new Error(`Tipo de archivo no soportado: ${input.mime || input.filename}`);
}
