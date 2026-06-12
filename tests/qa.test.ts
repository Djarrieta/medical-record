import { describe, expect, test } from "bun:test";
import { splitForTelegram } from "../src/util/telegram.ts";

describe("qa helpers", () => {
  test("short messages are not split", () => {
    expect(splitForTelegram("hola")).toEqual(["hola"]);
  });

  test("long messages are split under the limit", () => {
    const text = "línea de texto.\n".repeat(1000);
    const parts = splitForTelegram(text, 4096);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
  });

  test("splitting preserves all content (no data loss in word count)", () => {
    const text = "palabra ".repeat(2000).trim();
    const parts = splitForTelegram(text, 500);
    const joinedWords = parts.join(" ").split(/\s+/).filter(Boolean).length;
    expect(joinedWords).toBe(2000);
  });
});
