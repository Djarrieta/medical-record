import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type { Ocr } from "../../domain/ports";
import { isPdfBuffer } from "../util/fileType";

// OCR adapter for scanned/image-only documents.
// PDFs: pdftoppm (poppler) rasterizes each page to PNG, then tesseract reads
// the text out of each image. Plain images are fed straight to tesseract —
// leptonica autodetects the format. Both are native binaries installed in the
// Docker image. Everything stays local — no document leaves the server.
export class TesseractOcr implements Ocr {
  constructor(
    private readonly languages = "spa+eng",
    private readonly dpi = 300,
  ) {}

  async extract(buffer: Buffer, password?: string): Promise<string> {
    return isPdfBuffer(buffer)
      ? this.extractPdf(buffer, password)
      : this.extractImage(buffer);
  }

  private async extractPdf(buffer: Buffer, password?: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "ocr-"));
    try {
      const pdfPath = join(dir, "input.pdf");
      await Bun.write(pdfPath, buffer);

      const prefix = join(dir, "page");
      const ppmArgs = ["-png", "-r", String(this.dpi)];
      if (password) ppmArgs.push("-upw", password);
      ppmArgs.push(pdfPath, prefix);
      await this.run("pdftoppm", ppmArgs);

      const pages = readdirSync(dir)
        .filter((f) => f.startsWith("page") && f.endsWith(".png"))
        .sort();

      const texts: string[] = [];
      for (const page of pages) {
        const out = await this.run("tesseract", [
          join(dir, page),
          "stdout",
          "-l",
          this.languages,
        ]);
        texts.push(out);
      }

      return texts.join("\n\n").trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async extractImage(buffer: Buffer): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "ocr-"));
    try {
      // Leptonica autodetects the format from the content, so the extension
      // of the temp file does not matter.
      const imagePath = join(dir, "input");
      await Bun.write(imagePath, buffer);

      const out = await this.run("tesseract", [
        imagePath,
        "stdout",
        "-l",
        this.languages,
      ]);
      return out.trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async run(cmd: string, args: string[]): Promise<string> {
    const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`${cmd} failed (exit ${exitCode}): ${stderr.trim()}`);
    }
    return stdout;
  }
}
