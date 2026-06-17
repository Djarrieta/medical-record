import { extractText } from "unpdf";

export class PdfExtractor {
  async extract(buffer: Buffer): Promise<string> {
    const { text } = await extractText(buffer);
    return Array.isArray(text) ? text.join("\n\n") : text;
  }
}
