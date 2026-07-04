import AdmZip from "adm-zip";
import type { ArchiveExtractor } from "../../domain/ports";

// ArchiveExtractor backed by adm-zip. Reads a zip entirely in memory and
// returns every file entry (directories skipped) as { filename, content }.
// filename keeps the entry's path inside the archive so downstream naming stays
// meaningful.
export class AdmZipExtractor implements ArchiveExtractor {
  async extract(buffer: Buffer): Promise<{ filename: string; content: Buffer }[]> {
    const zip = new AdmZip(buffer);
    const out: { filename: string; content: Buffer }[] = [];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const content = entry.getData();
      if (content.length === 0) continue;
      // basename: drop any folder path so the saved file name is clean.
      const filename = entry.entryName.split("/").pop() || entry.entryName;
      out.push({ filename, content });
    }
    return out;
  }
}
