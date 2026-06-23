import { useState } from "react";

interface TagEditorProps {
  tags?: string[];
  activeTag: string;
  onFilter: (tag: string) => void;
  onChange: (tags: string[]) => void;
}

export function TagEditor({ tags, activeTag, onFilter, onChange }: TagEditorProps) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const list = tags ?? [];

  const commit = () => {
    const val = value.trim().toLowerCase();
    setAdding(false);
    setValue("");
    if (!val || list.includes(val)) return;
    onChange([...list, val]);
  };

  return (
    <div className="tags">
      {list.map((t) => (
        <span
          key={t}
          className={"tag" + (t === activeTag ? " active" : "")}
          onClick={() => onFilter(t)}
        >
          {t}
          <span
            className="x"
            title="Quitar"
            onClick={(e) => {
              e.stopPropagation();
              onChange(list.filter((x) => x !== t));
            }}
          >
            ✕
          </span>
        </span>
      ))}
      {adding ? (
        <input
          className="tag-input"
          placeholder="nuevo tag"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setAdding(false);
              setValue("");
            }
          }}
          onBlur={commit}
        />
      ) : (
        <span className="tag-add" onClick={() => setAdding(true)}>
          + tag
        </span>
      )}
    </div>
  );
}
