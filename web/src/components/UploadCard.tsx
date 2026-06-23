import { useRef, useState } from "react";
import { uploadFile } from "../api";
import { formatSize } from "../utils";
import { FileIcon, IconUpload } from "../icons";

type QueueStatus = "queued" | "uploading" | "processing" | "done" | "warn" | "error";

interface QueueItem {
  file: File;
  name: string;
  size: number;
  status: QueueStatus;
  detail?: string;
}

type SummaryKind = "ok" | "has-warn" | "has-errors";

const STATUS_TEXT: Record<QueueStatus, string> = {
  queued: "En cola",
  uploading: "Subiendo…",
  processing: "Procesando…",
  done: "Listo",
  warn: "Atención",
  error: "Error",
};

interface UploadCardProps {
  onUploaded: () => void;
}

export function UploadCard({ onUploaded }: UploadCardProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [summary, setSummary] = useState<{ kind: SummaryKind; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: File[]) => {
    setQueue((prev) => {
      const next = [...prev];
      for (const f of files) {
        if (next.some((q) => q.name === f.name && q.size === f.size)) continue;
        next.push({ file: f, name: f.name, size: f.size, status: "queued" });
      }
      return next;
    });
  };

  const startUpload = async () => {
    if (uploading) return;
    setUploading(true);
    setSummary(null);

    // Work on a local mutable copy and push it to state after each change so the
    // UI reflects per-item progress.
    const items = queue.map((q) => ({ ...q }));
    const flush = () => setQueue(items.map((q) => ({ ...q })));
    let ok = 0;
    let err = 0;
    let warn = 0;

    for (const item of items) {
      if (item.status === "done" || item.status === "error") continue;
      item.status = "uploading";
      item.detail = "";
      flush();

      const result = await uploadFile(item.file);
      if (result.expired) {
        item.status = "error";
        item.detail = "Sesión expirada";
        err++;
        flush();
        break;
      }
      if (!result.ok) {
        item.status = "error";
        item.detail = result.error || "Error";
        err++;
      } else if (result.duplicate) {
        item.status = "warn";
        item.detail = "Duplicado · ya estaba guardado";
        warn++;
      } else if (result.reason === "locked") {
        item.status = "warn";
        item.detail =
          "No guardado · PDF protegido. Registra la contraseña en Telegram y vuelve a subirlo.";
        warn++;
      } else if (result.reason === "empty") {
        item.status = "warn";
        item.detail = "Guardado · sin texto indexable (escaneado)";
        warn++;
      } else if (result.indexed) {
        item.status = "done";
        item.detail = "Guardado e indexado";
        ok++;
      } else {
        item.status = "done";
        item.detail = "Guardado";
        ok++;
      }
      flush();
    }

    const parts: string[] = [];
    if (ok) parts.push(ok + " correcto" + (ok !== 1 ? "s" : ""));
    if (warn) parts.push(warn + " con aviso" + (warn !== 1 ? "s" : ""));
    if (err) parts.push(err + " con error" + (err !== 1 ? "es" : ""));
    setSummary({
      kind: err ? "has-errors" : warn ? "has-warn" : "ok",
      text: parts.join(", ") + ".",
    });

    setUploading(false);
    // Keep only items that still need attention.
    setQueue(items.filter((item) => item.status === "warn" || item.status === "error"));
    onUploaded();
  };

  return (
    <section className="card">
      <div
        id="dropZone"
        className={dragover ? "dragover" : ""}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragover(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="icon" aria-hidden="true">
          <IconUpload />
        </div>
        <strong>Arrastra archivos aquí</strong>
        <span>o haz clic para seleccionar · PDF, imágenes y más</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) addFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      {queue.length > 0 && (
        <button
          className="btn btn-primary btn-upload"
          disabled={uploading}
          onClick={startUpload}
        >
          Subir archivos
        </button>
      )}

      <ul className="list">
        {queue.map((f, i) => (
          <li className="row" key={f.name + ":" + f.size + ":" + i}>
            <div className="fi">
              <FileIcon mime={f.file.type} />
            </div>
            <div className="body">
              <div className="name">{f.name}</div>
              <div className="meta">
                <span>{formatSize(f.size)}</span>
                {f.detail ? <span>{f.detail}</span> : null}
              </div>
            </div>
            <div className={"status status-" + f.status}>{STATUS_TEXT[f.status]}</div>
          </li>
        ))}
      </ul>

      {summary && (
        <div className={"summary " + summary.kind}>{summary.text}</div>
      )}
    </section>
  );
}
