export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

export function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

export function typeLabel(mime?: string): string {
  if (!mime) return "Archivo";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Imagen";
  if (mime.startsWith("text/")) return "Texto";
  return (mime.split("/").pop() || "").toUpperCase();
}

export function isImageMime(mime?: string): boolean {
  return !!mime && mime.startsWith("image/");
}
