import { describe, expect, test } from "bun:test";
import { extract } from "../src/ingestion/extractors.ts";
import { isPasswordError, PdfLockedError } from "../src/ingestion/pdfUnlock.ts";

describe("extractors", () => {
  test("extracts plain text", async () => {
    const text = "Colesterol total: 190 mg/dL\nFecha: 2024-05-01";
    const data = new TextEncoder().encode(text);
    const res = await extract({ data, mime: "text/plain", filename: "nota.txt" });
    expect(res.pageCount).toBe(1);
    expect(res.pages[0]!.text).toContain("Colesterol");
    expect(res.wasEncrypted).toBe(false);
  });

  test("rejects unsupported types", async () => {
    const data = new Uint8Array([0, 1, 2, 3]);
    await expect(
      extract({ data, mime: "application/zip", filename: "x.zip" }),
    ).rejects.toThrow();
  });
});

describe("pdfUnlock helpers", () => {
  test("isPasswordError detects pdf.js password exceptions", () => {
    expect(isPasswordError({ name: "PasswordException", message: "No password" })).toBe(true);
    expect(isPasswordError({ name: "Error", message: "incorrect password given" })).toBe(true);
    expect(isPasswordError({ name: "TypeError", message: "boom" })).toBe(false);
    expect(isPasswordError(null)).toBe(false);
  });

  test("PdfLockedError has a Spanish message", () => {
    expect(new PdfLockedError().message).toMatch(/contraseña/i);
  });
});
