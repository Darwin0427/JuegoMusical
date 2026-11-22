"use client";

import { useEffect, useId, useRef, useState } from "react";

export type Suggestion = { id: string; name: string; picture: string; extra?: string };

// Buscador para responder escribiendo: sugiere canciones (o artistas) de TODO el catálogo de Deezer,
// así ayuda a quien no recuerda el nombre exacto sin delatar cuál es la respuesta.
export default function AnswerSearch({
  value, onChange, onSubmit, target, disabled, invalid, busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (text: string) => void;
  target: "song" | "artist";
  disabled?: boolean;
  invalid?: boolean;
  busy?: boolean;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const reqId = useRef(0);
  const listId = useId();

  useEffect(() => {
    const q = value.trim();
    const id = ++reqId.current;
    if (disabled || q.length < 2) {
      const t = setTimeout(() => {
        if (id !== reqId.current) return;
        setItems([]);
        setLoading(false);
      }, 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/deezer/search?type=${target === "artist" ? "artist" : "track"}&q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (id !== reqId.current) return; // respuesta vieja: se ignora
        setItems(((j.data ?? []) as Suggestion[]).slice(0, 6));
        setActive(-1);
      } catch {
        if (id === reqId.current) setItems([]);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value, target, disabled]);

  function pick(s: Suggestion) {
    setOpen(false);
    setItems([]);
    onSubmit(s.name);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && items[active]) pick(items[active]);
      else if (value.trim()) {
        setOpen(false);
        onSubmit(value.trim());
      }
    }
  }

  const showList = open && !disabled && value.trim().length >= 2 && (items.length > 0 || loading);

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          id="guess"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className={`input text-lg ${invalid ? "border-bad" : ""}`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={80}
          placeholder={disabled ? "" : target === "artist" ? "Busca el artista… ej: Karol" : "Busca la canción… ej: tusa"}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={disabled || busy || !value.trim()}
          onClick={() => {
            setOpen(false);
            onSubmit(value.trim());
          }}
        >
          {busy ? "…" : "Responder"}
        </button>
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={target === "artist" ? "Artistas sugeridos" : "Canciones sugeridas"}
          className="absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-xl border-[3px] border-ink bg-paper p-1 text-ink shadow-[0_5px_0_var(--color-ink)]"
        >
          {loading && items.length === 0 && <li className="px-3 py-2 font-bold text-muted">Buscando…</li>}
          {items.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 ${i === active ? "bg-sun" : "hover:bg-fog"}`}
            >
              {s.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.picture} alt="" className="size-10 shrink-0 rounded-md border-2 border-ink object-cover" loading="lazy" />
              ) : (
                <span className="size-10 shrink-0 rounded-md border-2 border-ink bg-fog" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-extrabold">{s.name}</span>
                {s.extra && target === "song" && <span className="block truncate text-sm font-bold text-muted">{s.extra}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
