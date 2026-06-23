import type { ReactNode } from "react";
import { IconChat, IconFiles, IconLock, IconNote } from "../icons";

export type View = "chat" | "files" | "passwords" | "notes";

interface NavItem {
  id: View;
  label: string;
  icon: ReactNode;
}

const ITEMS: NavItem[] = [
  { id: "chat", label: "Chat", icon: <IconChat /> },
  { id: "files", label: "Archivos", icon: <IconFiles /> },
  { id: "passwords", label: "Contraseñas", icon: <IconLock /> },
  { id: "notes", label: "Notas", icon: <IconNote /> },
];

interface NavbarProps {
  active: View;
  onChange: (view: View) => void;
}

export function Navbar({ active, onChange }: NavbarProps) {
  return (
    <nav className="navbar" aria-label="Secciones">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={"nav-item" + (item.id === active ? " active" : "")}
          aria-current={item.id === active ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          <span className="nav-ico" aria-hidden="true">
            {item.icon}
          </span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
