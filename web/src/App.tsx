import { useCallback, useEffect, useRef, useState } from "react";
import type { FileRecord, Note, TagKind } from "./types";
import {
  listFiles,
  listNotes,
  patchTags,
  setOnExpired,
} from "./api";
import { IconClock, IconLogo } from "./icons";
import { Navbar, type View } from "./components/Navbar";
import { UploadCard } from "./components/UploadCard";
import { FilesCard } from "./components/FilesCard";
import { NotesCard } from "./components/NotesCard";
import { PasswordsCard } from "./components/PasswordsCard";

export function App() {
  const [view, setView] = useState<View>("files");
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeTag, setActiveTag] = useState("");
  const [toast, setToast] = useState("");
  const [expired, setExpired] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const reloadFiles = useCallback(async () => {
    const data = await listFiles();
    if (data) setFiles(data);
  }, []);

  const reloadNotes = useCallback(async () => {
    const data = await listNotes();
    if (data) setNotes(data);
  }, []);

  useEffect(() => {
    setOnExpired(() => setExpired(true));
    void reloadFiles();
    void reloadNotes();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [reloadFiles, reloadNotes]);

  // Reset any active tag filter when switching sections so each view starts clean.
  const changeView = useCallback((next: View) => {
    setView(next);
    setActiveTag("");
  }, []);

  // Persist a tag change optimistically against the server, then sync the stored
  // (normalized) tags back into local state.
  const changeTags = useCallback(
    async (kind: TagKind, id: string, tags: string[]) => {
      const stored = await patchTags(kind, id, tags);
      if (!stored) {
        showToast("No se pudieron guardar los tags");
        return;
      }
      if (kind === "file") {
        setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, tags: stored } : f)));
      } else {
        setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, tags: stored } : n)));
      }
    },
    [showToast],
  );

  if (expired) {
    return (
      <div id="expired" role="alertdialog" aria-modal="true" aria-labelledby="expiredTitle">
        <div className="panel">
          <div className="badge" aria-hidden="true">
            <IconClock />
          </div>
          <h2 id="expiredTitle">Sesión expirada</h2>
          <p>
            Por seguridad, este enlace ya no es válido. Vuelve a pedir el enlace en Telegram para
            continuar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="app">
        <div className="mark" aria-hidden="true">
          <IconLogo />
        </div>
        <div>
          <h1>Expediente médico</h1>
          <p>Sube y administra tus documentos clínicos.</p>
        </div>
      </header>

      <Navbar active={view} onChange={changeView} />

      <main className="view">
        {view === "files" && (
          <>
            <UploadCard onUploaded={reloadFiles} />
            <FilesCard
              files={files}
              activeTag={activeTag}
              onFilter={setActiveTag}
              onClearFilter={() => setActiveTag("")}
              onReload={reloadFiles}
              onTagsChange={(id, tags) => changeTags("file", id, tags)}
              showToast={showToast}
            />
          </>
        )}

        {view === "passwords" && <PasswordsCard showToast={showToast} />}

        {view === "notes" && (
          <NotesCard
            notes={notes}
            activeTag={activeTag}
            onFilter={setActiveTag}
            onReload={reloadNotes}
            onTagsChange={(id, tags) => changeTags("note", id, tags)}
            showToast={showToast}
          />
        )}
      </main>

      <div id="toast" className={toast ? "show" : ""} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
