import { useState } from "react";
import type { FileRecord } from "../types";
import { deleteFile, rawUrl } from "../api";
import { formatDate, formatSize, isImageMime, typeLabel } from "../utils";
import { FileIcon, IconDel, IconRefresh, IconSearch, IconView } from "../icons";
import { TagEditor } from "./TagEditor";

interface FilesCardProps {
  files: FileRecord[];
  activeTag: string;
  onFilter: (tag: string) => void;
  onClearFilter: () => void;
  onReload: () => void;
  onTagsChange: (id: string, tags: string[]) => void;
  showToast: (msg: string) => void;
}

export function FilesCard({
  files,
  activeTag,
  onFilter,
  onClearFilter,
  onReload,
  onTagsChange,
  showToast,
}: FilesCardProps) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  let items = files;
  if (q) {
    items = items.filter(
      (f) =>
        (f.title || "").toLowerCase().includes(q) ||
        (f.originalName || "").toLowerCase().includes(q),
    );
  }
  if (activeTag) items = items.filter((f) => (f.tags || []).includes(activeTag));

  const onDelete = async (id: string) => {
    const file = files.find((f) => f.id === id);
    const name = file ? file.originalName : "este archivo";
    if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return;
    if (await deleteFile(id)) {
      showToast("Archivo eliminado");
      onReload();
    } else {
      showToast("No se pudo eliminar");
    }
  };

  return (
    <section className="card">
      <div className="files-head">
        <h2>Archivos guardados</h2>
        <span className="count-chip">{files.length}</span>
        <span className="spacer" />
        <button
          className="icon-btn"
          title="Actualizar"
          aria-label="Actualizar"
          onClick={onReload}
        >
          <IconRefresh />
        </button>
      </div>

      <div className="search-wrap">
        <IconSearch />
        <input
          id="searchInput"
          type="search"
          placeholder="Buscar por nombre…"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {activeTag && (
        <div className="filter-bar">
          <span>Filtrando por tag:</span>
          <span className="tag active">{activeTag}</span>
          <span className="clear" onClick={onClearFilter}>
            Quitar filtro
          </span>
        </div>
      )}

      <ul className="list">
        {files.length === 0 ? (
          <li className="empty">Aún no hay archivos. Sube tu primer documento arriba.</li>
        ) : items.length === 0 ? (
          <li className="empty">Ningún archivo coincide con el filtro.</li>
        ) : (
          items.map((f) => {
            const isIndexable = f.mimeType === "application/pdf" || isImageMime(f.mimeType);
            const title = f.title || f.originalName;
            const showOriginal = title !== f.originalName;
            return (
              <li className="row" key={f.id}>
                <div className="fi">
                  <FileIcon mime={f.mimeType} />
                </div>
                <div className="body">
                  <div className="name">{title}</div>
                  <div className="meta">
                    {showOriginal && <span title="Nombre original">{f.originalName}</span>}
                    <span>{typeLabel(f.mimeType)}</span>
                    <span>{formatSize(f.size)}</span>
                    <span>{formatDate(f.createdAt)}</span>
                  </div>
                  <TagEditor
                    tags={f.tags}
                    activeTag={activeTag}
                    onFilter={onFilter}
                    onChange={(tags) => onTagsChange(f.id, tags)}
                  />
                </div>
                {isIndexable &&
                  (f.indexed ? (
                    <span className="badge badge-idx">Indexado</span>
                  ) : (
                    <span
                      className="badge badge-warn"
                      title="Guardado pero sin indexar (protegido o sin texto extraíble)"
                    >
                      Sin indexar
                    </span>
                  ))}
                <div className="actions">
                  <button
                    className="icon-btn"
                    title="Ver"
                    aria-label="Ver"
                    onClick={() => window.open(rawUrl(f.id, false), "_blank")}
                  >
                    <IconView />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Eliminar"
                    aria-label="Eliminar"
                    onClick={() => onDelete(f.id)}
                  >
                    <IconDel />
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
