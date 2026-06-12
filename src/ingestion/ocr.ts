/**
 * OCR wrapper around tesseract.js (Spanish, plan §3).
 * Documents are always in Spanish, so we use the `spa` language model only.
 */

import { createWorker, type Worker } from "tesseract.js";
import { createLogger } from "../util/logger.ts";

const log = createLogger("ocr");

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      log.info("Initializing tesseract.js worker (spa)");
      const worker = await createWorker("spa");
      return worker;
    })();
  }
  return workerPromise;
}

/** Run OCR over a single image buffer (PNG/JPEG) and return recognized Spanish text. */
export async function ocrImage(image: Buffer | Uint8Array): Promise<string> {
  const worker = await getWorker();
  const {
    data: { text },
  } = await worker.recognize(Buffer.from(image));
  return text.trim();
}

/** Release the OCR worker (called on graceful shutdown). */
export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}
