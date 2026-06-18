import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Chunker } from "../../domain/ports";

export class RecursiveChunker implements Chunker {
  private readonly splitter: RecursiveCharacterTextSplitter;

  constructor(chunkSize = 1000, chunkOverlap = 200) {
    this.splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  }

  split(text: string): Promise<string[]> {
    return this.splitter.splitText(text);
  }
}
