import { extractText, getDocumentProxy } from "unpdf";

import type { TextExtractor } from "../../domain/ports";

export class UnpdfTextExtractor implements TextExtractor {
  async extract(buffer: Buffer): Promise<string> {
    const result = await this.tryExtract(buffer);
    if (result === null) throw new Error("PDF requires password");
    return result;
  }

  async tryExtract(buffer: Buffer, password?: string): Promise<string | null> {
    try {
      const data = new Uint8Array(buffer);
      const proxy = password
        ? await getDocumentProxy(data, { password })
        : await getDocumentProxy(data);
      const { text } = await extractText(proxy);
      return Array.isArray(text) ? text.join("\n\n") : text;
    } catch (e: any) {
      if (e?.name === "PasswordException") return null;
      throw e;
    }
  }
}
