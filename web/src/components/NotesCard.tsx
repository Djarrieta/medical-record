import type { Note } from "../types";
import { deleteNote } from "../api";
import { IconDel, IconNote, IconRefresh } from "../icons";
import { TagEditor } from "./TagEditor";

interface NotesCardProps {
  notes: Note[];
  activeTag: string;
  onFilter: (tag: string) => void;
  onReload: () => void;
  onTagsChange: (id: string, tags: string[]) => void;
  showToast: (msg: string) => void;
}

function excerpt(text: string): string {
  const raw = (text || "").replace(/\s+/g, " ").trim();
  return raw.slice(0, 120) + (raw.length > 120 ? "…" : "");
}

export function NotesCard({
  notes,
  activeTag,
  onFilter,
  onReload,
  onTagsChange,
  showToast,
}: NotesCardProps) {
  const onDelete = async (id: string) => {
    const note = notes.find((n) => n.id === id);
    const name = note ? note.title || "esta nota" : "esta nota";
    if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return;
    if (await deleteNote(id)) {
      showToast("Nota eliminada");
      onReload();
    } else {
      showToast("No se pudo eliminar");
    }
  };

  return (
    <section className="card">
      <div className="files-head">
        <h2>Notas</h2>
        <span className="count-chip">{notes.length}</span>
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

      <ul className="list">
        {notes.length === 0 ? (
          <li className="empty">Aún no hay notas. Crea una desde Telegram con el botón Nota.</li>
        ) : (
          notes.map((n) => (
            <li className="row" key={n.id}>
              <div className="fi">
                <IconNote />
              </div>
              <div className="body">
                <div className="name">{n.title || "Nota"}</div>
                <div className="meta">
                  <span>{excerpt(n.text)}</span>
                </div>
                <TagEditor
                  tags={n.tags}
                  activeTag={activeTag}
                  onFilter={onFilter}
                  onChange={(tags) => onTagsChange(n.id, tags)}
                />
              </div>
              <div className="actions">
                <button
                  className="icon-btn danger"
                  title="Eliminar"
                  aria-label="Eliminar"
                  onClick={() => onDelete(n.id)}
                >
                  <IconDel />
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
