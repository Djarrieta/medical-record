/**
 * Rasterize PDF pages to PNG images for OCR (plan §3, scanned PDFs).
 * Uses `pdf-to-img`, which renders via pdf.js and supports a decryption password.
 */

import { pdf } from "pdf-to-img";
import { createLogger } from "../util/logger.ts";

const log = createLogger("pdfRender");

export interface RenderedPage {
  page: number;
  image: Buffer;
}

/**
 * Render each page of a (possibly password-protected) PDF to a PNG buffer.
 * `scale` boosts resolution for better OCR accuracy on small text.
 */
export async function renderPdfToImages(
  data: Uint8Array,
  opts: { password?: string; scale?: number; maxPages?: number } = {},
): Promise<RenderedPage[]> {
  const scale = opts.scale ?? 2.5;
  const document = await pdf(Buffer.from(data), {
    scale,
    ...(opts.password ? { password: opts.password } : {}),
  });

  const pages: RenderedPage[] = [];
  let pageNum = 0;
  for await (const image of document) {
    pageNum += 1;
    pages.push({ page: pageNum, image: image as Buffer });
    if (opts.maxPages && pageNum >= opts.maxPages) {
      log.warn(`Reached maxPages=${opts.maxPages}; remaining pages skipped`);
      break;
    }
  }
  return pages;
}
