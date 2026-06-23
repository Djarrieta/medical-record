import { useEffect, useState } from "react";
import type { Password } from "../types";
import { addPassword, deletePassword, listPasswords } from "../api";
import { IconDel, IconEye, IconEyeOff, IconLock, IconPlus, IconRefresh } from "../icons";

interface PasswordsCardProps {
  showToast: (msg: string) => void;
}

export function PasswordsCard({ showToast }: PasswordsCardProps) {
  const [items, setItems] = useState<Password[]>([]);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const data = await listPasswords();
    if (data) setItems(data);
  };

  useEffect(() => {
    void reload();
  }, []);

  const onAdd = async () => {
    const pwd = value.trim();
    if (!pwd || busy) return;
    setBusy(true);
    const updated = await addPassword(pwd);
    setBusy(false);
    if (!updated) {
      showToast("No se pudo guardar");
      return;
    }
    setItems(updated);
    setValue("");
    showToast("Contraseña guardada");
  };

  const onDelete = async (id: number) => {
    if (!confirm("¿Eliminar esta contraseña?")) return;
    if (await deletePassword(id)) {
      setItems((prev) => prev.filter((p) => p.id !== id));
      showToast("Contraseña eliminada");
    } else {
      showToast("No se pudo eliminar");
    }
  };

  return (
    <section className="card">
      <div className="files-head">
        <h2>Contraseñas de PDF</h2>
        <span className="count-chip">{items.length}</span>
        <span className="spacer" />
        <button className="icon-btn" title="Actualizar" aria-label="Actualizar" onClick={reload}>
          <IconRefresh />
        </button>
      </div>

      <p className="section-hint">
        Se prueban automáticamente al subir un PDF protegido para desbloquearlo e indexarlo.
      </p>

      <form
        className="pwd-add"
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd();
        }}
      >
        <div className="pwd-input">
          <IconLock />
          <input
            type={reveal ? "text" : "password"}
            placeholder="Nueva contraseña…"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            type="button"
            className="pwd-toggle"
            title={reveal ? "Ocultar" : "Mostrar"}
            aria-label={reveal ? "Ocultar" : "Mostrar"}
            onClick={() => setReveal((r) => !r)}
          >
            {reveal ? <IconEyeOff /> : <IconEye />}
          </button>
        </div>
        <button type="submit" className="btn btn-primary pwd-add-btn" disabled={busy || !value.trim()}>
          <IconPlus />
          <span>Agregar</span>
        </button>
      </form>

      <ul className="list">
        {items.length === 0 ? (
          <li className="empty">Aún no hay contraseñas guardadas.</li>
        ) : (
          items.map((p) => (
            <li className="row" key={p.id}>
              <div className="fi">
                <IconLock />
              </div>
              <div className="body">
                <div className="name pwd-value">{reveal ? p.password : "•".repeat(Math.min(p.password.length, 12))}</div>
              </div>
              <div className="actions">
                <button
                  className="icon-btn danger"
                  title="Eliminar"
                  aria-label="Eliminar"
                  onClick={() => onDelete(p.id)}
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
