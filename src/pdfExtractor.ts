import { extractText } from "unpdf";

export class PdfExtractor {
  async extract(buffer: Buffer): Promise<string> {
    const { text } = await extractText(new Uint8Array(buffer));
    return Array.isArray(text) ? text.join("\n\n") : text;
  }
}
