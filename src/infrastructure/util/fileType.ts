// Magic-byte file-type detection. Used when the MIME type is missing or
// ambiguous (e.g. "application/octet-stream") to decide how to handle a buffer.

export function isPdfBuffer(buffer: Buffer): boolean {
  // "%PDF-"
  return (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  );
}

// Detects raster image formats tesseract/leptonica can read natively:
// JPEG, PNG, GIF, BMP, TIFF. HEIC/WEBP are intentionally out of scope.
export function isImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return true;
  }

  // GIF: 47 49 46 38 ("GIF8")
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return true;
  }

  // BMP: 42 4D ("BM")
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return true;

  // TIFF little-endian: 49 49 2A 00
  if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) {
    return true;
  }

  // TIFF big-endian: 4D 4D 00 2A
  if (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a) {
    return true;
  }

  return false;
}
