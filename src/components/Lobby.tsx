"use client";

import { useEffect, useState } from "react";
import type { Player, Room } from "@/lib/supabase";
import type { Session } from "@/lib/session";
import PlayerList from "./PlayerList";

type Mode = "genre" | "playlist" | "artist";
type Item = { id: string; name: string; picture: string; extra?: string };

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "genre", label: "Por género", hint: "Las más escuchadas del género" },
  { id: "playlist", label: "Por playlist", hint: "Cualquier playlist pública de Deezer" },
  { id: "artist", label: "Por artista", hint: "Solo canciones de un artista" },
];

const PLAYLIST_IDEAS = ["Top Colombia", "Reggaeton", "Rock en español", "Éxitos 2000", "Salsa", "Vallenato", "Pop en inglés", "Baladas"];
const ARTIST_IDEAS = ["Bad Bunny", "Karol G", "Shakira", "Feid", "Soda Stereo", "Juanes", "Taylor Swift", "Carlos Vives"];

export default function Lobby({ room, players, session, isHost }: { room: Room; players: Player[]; session: Session; isHost: boolean }) {
  const host = players.find((p) => p.id === room.host_player_id);
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard?.writeText(`${location.origin}/sala/${room.code}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="panel p-5 sm:p-6">
        {isHost ? (
          <HostSetup session={session} playersCount={players.length} />
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
            <h2 className="display text-3xl">{host?.nickname ?? "El anfitrión"} está eligiendo la música</h2>
            <p className="font-bold text-muted">La partida arranca sola cuando la inicie. Mientras tanto, comparte el código.</p>
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-4">
        <div className="panel bg-sun! p-5 text-center">
          <p className="font-extrabold">Código para entrar</p>
          <p className="display my-1 text-5xl tracking-[.18em]">{room.code}</p>
          <button className="btn-ghost w-full py-2" onClick={copyLink}>{copied ? "Enlace copiado" : "Copiar enlace de invitación"}</button>
        </div>
        <PlayerList players={players} hostId={room.host_player_id} meId={session.player_id} />
      </aside>
    </div>
  );
}

function HostSetup({ session, playersCount }: { session: Session; playersCount: number }) {
  const [mode, setMode] = useState<Mode>("genre");
  const [selected, setSelected] = useState<Item | null>(null);
  const [rounds, setRounds] = useState(10);
  const [seconds, setSeconds] = useState(20);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    if (!selected) return;
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.token, source_type: mode, source_id: selected.id, source_label: selected.name, rounds, seconds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo iniciar");
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="display text-3xl">Elige la música</h2>
        <p className="font-bold text-muted">{playersCount === 1 ? "Puedes jugar solo o esperar a que entren tus amigos." : `${playersCount} jugadores en la sala.`}</p>
      </div>

      <div className="grid grid-cols-3 gap-2" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => { setMode(m.id); setSelected(null); }}
            className={`rounded-xl border-[3px] border-ink px-3 py-3 text-left transition-[transform,box-shadow] duration-75 ${mode === m.id ? "translate-y-[3px] bg-stage text-paper shadow-[0_1px_0_var(--color-ink)]" : "bg-paper shadow-[0_4px_0_var(--color-ink)] hover:bg-fog"}`}
          >
            <span className="display block text-lg">{m.label}</span>
            <span className={`hidden text-xs font-bold sm:block ${mode === m.id ? "text-paper/80" : "text-muted"}`}>{m.hint}</span>
          </button>
        ))}
      </div>

      {mode === "genre" && <GenrePicker selected={selected} onSelect={setSelected} />}
      {mode === "playlist" && <SearchPicker key="playlist" type="playlist" ideas={PLAYLIST_IDEAS} selected={selected} onSelect={setSelected} />}
      {mode === "artist" && <SearchPicker key="artist" type="artist" ideas={ARTIST_IDEAS} selected={selected} onSelect={setSelected} />}

      <div className="grid grid-cols-2 gap-3">
        <label className="font-extrabold">Rondas
          <select className="input mt-1" value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
            {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="font-extrabold">Segundos por ronda
          <select className="input mt-1" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
            {[10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {error && <p className="rounded-xl border-2 border-bad bg-bad/10 px-3 py-2 text-sm font-bold text-bad" role="alert">{error}</p>}

      <button className="btn-primary py-4 text-xl" disabled={!selected || starting} onClick={start}>
        {starting ? "Preparando canciones…" : selected ? `Empezar con ${selected.name}` : "Elige qué música suena"}
      </button>
    </div>
  );
}

function ItemCard({ item, active, onClick }: { item: Item; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border-[3px] p-2 text-left transition-colors ${active ? "border-ink bg-sun" : "border-fog bg-paper hover:border-ink"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.picture} alt="" className="size-12 shrink-0 rounded-lg border-2 border-ink object-cover" loading="lazy" />
      <span className="min-w-0">
        <span className="block truncate font-extrabold">{item.name}</span>
        {item.extra && <span className="block truncate text-xs font-bold text-muted">{item.extra}</span>}
      </span>
    </button>
  );
}

function GenrePicker({ selected, onSelect }: { selected: Item | null; onSelect: (i: Item) => void }) {
  const [genres, setGenres] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/deezer/genres")
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setGenres(j.data)))
      .catch(() => setError("No se pudieron cargar los géneros"));
  }, []);
  if (error) return <p className="text-sm font-bold text-bad">{error}</p>;
  if (!genres) return <p className="font-bold text-muted">Cargando géneros…</p>;
  return (
    <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
      {genres.map((g) => <ItemCard key={g.id} item={g} active={selected?.id === g.id} onClick={() => onSelect(g)} />)}
    </div>
  );
}

function SearchPicker({ type, ideas, selected, onSelect }: { type: "playlist" | "artist"; ideas: string[]; selected: Item | null; onSelect: (i: Item) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run(query: string) {
    const term = query.trim();
    if (!term) return;
    // Enlace directo de playlist de Deezer
    const m = term.match(/deezer\.com\/(?:[a-z]{2}\/)?playlist\/(\d+)/i);
    if (type === "playlist" && m) {
      onSelect({ id: m[1], name: "Playlist de Deezer", picture: "" });
      setResults([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/deezer/search?type=${type}&q=${encodeURIComponent(term)}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setResults(j.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <input
          className="input"
          placeholder={type === "playlist" ? "Busca una playlist o pega el enlace de Deezer" : "Busca un artista"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn-ghost" disabled={loading}>{loading ? "…" : "Buscar"}</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {ideas.map((i) => (
          <button key={i} className="rounded-full border-2 border-ink bg-fog px-3 py-1 text-sm font-extrabold hover:bg-sun" onClick={() => { setQ(i); run(i); }}>
            {i}
          </button>
        ))}
      </div>
      {error && <p className="text-sm font-bold text-bad">{error}</p>}
      {results && results.length === 0 && !selected && <p className="font-bold text-muted">Nada con ese nombre. Prueba otra búsqueda.</p>}
      {results && results.length > 0 && (
        <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {results.map((r) => <ItemCard key={r.id} item={r} active={selected?.id === r.id} onClick={() => onSelect(r)} />)}
        </div>
      )}
      {selected && !results?.some((r) => r.id === selected.id) && (
        <p className="font-bold text-muted">Elegiste: <span className="text-ink">{selected.name}</span></p>
      )}
    </div>
  );
}
