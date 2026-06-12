import { describe, expect, test } from "bun:test";
import { chunkDocument, estimateTokens } from "../src/ingestion/chunker.ts";

describe("chunker", () => {
  test("returns no chunks for empty input", () => {
    expect(chunkDocument([])).toEqual([]);
    expect(chunkDocument([{ page: 1, text: "   " }])).toEqual([]);
  });

  test("keeps page metadata", () => {
    const chunks = chunkDocument([
      { page: 3, text: "Colesterol total 190 mg/dL. Resultado dentro del rango." },
    ]);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.page).toBe(3);
  });

  test("splits long text into multiple chunks", () => {
    const sentence = "El paciente presenta valores normales en el análisis. ";
    const longText = sentence.repeat(120); // well over one chunk
    const chunks = chunkDocument([{ page: 1, text: longText }]);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("each chunk stays roughly under the max token budget", () => {
    const sentence = "Hemoglobina 14.2 y glucosa 95 en ayunas medidos hoy. ";
    const chunks = chunkDocument([{ page: 1, text: sentence.repeat(200) }]);
    for (const c of chunks) {
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(520);
    }
  });

  test("estimateTokens grows with length", () => {
    expect(estimateTokens("hola")).toBeLessThan(estimateTokens("hola mundo esto es"));
  });
});
