import { useState } from "react";
import type { Note } from "../types";
import { createNote, deleteNote, updateNote } from "../api";
import { IconDel, IconEdit, IconNote, IconPlus, IconRefresh } from "../icons";
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

// Inline editor used both for creating a new note and editing an existing one.
function NoteEditor({
  initialTitle,
  initialText,
  busy,
  onCancel,
  onSave,
}: {
  initialTitle: string;
  initialText: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (text: string, title: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);

  return (
    <div className="note-editor">
      <input
        className="note-title-input"
        placeholder="Título (opcional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="note-text-input"
        placeholder="Escribe tu nota…"
        rows={4}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="note-editor-actions">
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => onSave(text.trim(), title.trim())}
        >
          Guardar
        </button>
      </div>
    </div>
  );
}

export function NotesCard({
  notes,
  activeTag,
  onFilter,
  onReload,
  onTagsChange,
  showToast,
}: NotesCardProps) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  let items = notes;
  if (activeTag) items = items.filter((n) => (n.tags || []).includes(activeTag));

  const onCreate = async (text: string, title: string) => {
    setBusy(true);
    const created = await createNote(text, title || undefined);
    setBusy(false);
    if (created) {
      setCreating(false);
      showToast("Nota creada");
      onReload();
    } else {
      showToast("No se pudo crear la nota");
    }
  };

  const onEdit = async (id: string, text: string, title: string) => {
    setBusy(true);
    const updated = await updateNote(id, text, title || undefined);
    setBusy(false);
    if (updated) {
      setEditingId(null);
      showToast("Nota actualizada");
      onReload();
    } else {
      showToast("No se pudo actualizar");
    }
  };

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
        <button className="icon-btn" title="Actualizar" aria-label="Actualizar" onClick={onReload}>
          <IconRefresh />
        </button>
      </div>

      {activeTag && (
        <div className="filter-bar">
          <span>Filtrando por tag:</span>
          <span className="tag active">{activeTag}</span>
          <span className="clear" onClick={() => onFilter("")}>
            Quitar filtro
          </span>
        </div>
      )}

      {creating ? (
        <NoteEditor
          initialTitle=""
          initialText=""
          busy={busy}
          onCancel={() => setCreating(false)}
          onSave={onCreate}
        />
      ) : (
        <button className="btn btn-primary btn-block" type="button" onClick={() => setCreating(true)}>
          <IconPlus />
          <span>Nueva nota</span>
        </button>
      )}

      <ul className="list">
        {notes.length === 0 ? (
          <li className="empty">Aún no hay notas. Crea la primera con “Nueva nota”.</li>
        ) : items.length === 0 ? (
          <li className="empty">Ninguna nota coincide con el filtro.</li>
        ) : (
          items.map((n) =>
            editingId === n.id ? (
              <li className="row row-editing" key={n.id}>
                <NoteEditor
                  initialTitle={n.title || ""}
                  initialText={n.text}
                  busy={busy}
                  onCancel={() => setEditingId(null)}
                  onSave={(text, title) => onEdit(n.id, text, title)}
                />
              </li>
            ) : (
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
                    className="icon-btn"
                    title="Editar"
                    aria-label="Editar"
                    onClick={() => setEditingId(n.id)}
                  >
                    <IconEdit />
                  </button>
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
            ),
          )
        )}
      </ul>
    </section>
  );
}
