import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Chunker } from "../../domain/ports";

export class RecursiveChunker implements Chunker {
  private readonly splitter: RecursiveCharacterTextSplitter;

  constructor(chunkSize = 1000, chunkOverlap = 200) {
    // Separators favor document structure so clinical content stays intact:
    // paragraph -> line (keeps each lab-result row whole) -> sentence/clause
    // punctuation, only falling back to spaces/characters when a single line
    // still exceeds chunkSize. keepSeparator avoids cutting tokens mid-value.
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      keepSeparator: true,
      separators: ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""],
    });
  }

  split(text: string): Promise<string[]> {
    return this.splitter.splitText(text);
  }
}
