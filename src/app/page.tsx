"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { saveNickname, saveSession, useStoredNickname, type Session } from "@/lib/session";

type PublicRoom = { code: string; host: string | null; players: number; created_at: string };

async function fetchRooms(): Promise<PublicRoom[]> {
  const { data } = await supabase.rpc("list_public_rooms");
  return (data as PublicRoom[]) ?? [];
}

export default function Home() {
  const router = useRouter();
  const storedNick = useStoredNickname();
  const [typedNick, setNick] = useState<string | null>(null);
  const nick = typedNick ?? storedNick;
  const [code, setCode] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState("");
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchRooms().then((r) => alive && setRooms(r));
    return () => {
      alive = false;
    };
  }, []);

  async function loadRooms() {
    setRooms(null);
    setRooms(await fetchRooms());
  }

  function checkNick() {
    const n = nick.trim();
    if (!n) {
      setError("Escribe tu apodo primero");
      return null;
    }
    saveNickname(n);
    return n;
  }

  async function create() {
    const n = checkNick();
    if (!n) return;
    setBusy("create");
    setError("");
    const { data, error } = await supabase.rpc("create_room", { p_nickname: n, p_is_public: isPublic });
    setBusy(null);
    if (error) return setError(error.message);
    const s = data as Session;
    saveSession(s);
    router.push(`/sala/${s.code}`);
  }

  async function join(c = code) {
    const n = checkNick();
    if (!n) return;
    const clean = c.trim().toUpperCase();
    if (clean.length !== 5) return setError("El código tiene 5 caracteres");
    setBusy("join");
    setError("");
    const { data, error } = await supabase.rpc("join_room", { p_code: clean, p_nickname: n });
    setBusy(null);
    if (error) return setError(error.message);
    const s = data as Session;
    saveSession(s);
    router.push(`/sala/${s.code}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 py-10 sm:py-16">
      <header className="flex flex-col items-center gap-4 text-center">
        <div className="eq" aria-hidden><span /><span /><span /><span /><span /></div>
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
          Juego<span className="bg-linear-to-r from-brand to-brand-2 bg-clip-text text-transparent">Musical</span>
        </h1>
        <p className="max-w-md text-muted">
          Escucha 30 segundos, adivina la canción antes que tus amigos. Por género, playlist o artista.
        </p>
      </header>

      <section className="card mx-auto w-full max-w-md p-6">
        <label className="mb-2 block text-sm text-muted" htmlFor="nick">Tu apodo</label>
        <input
          id="nick"
          className="input"
          maxLength={20}
          placeholder="Ej: Darwin"
          value={nick}
          onChange={(e) => setNick(e.target.value)}
        />

        <div className="mt-6 grid gap-3">
          <button className="btn-primary w-full" onClick={create} disabled={busy !== null}>
            {busy === "create" ? "Creando…" : "Crear sala"}
          </button>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-brand" />
            Sala pública (cualquiera puede verla y entrar)
          </label>
        </div>

        <div className="my-6 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />o únete con un código<span className="h-px flex-1 bg-line" />
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <input
            className="input tabular text-center font-mono text-lg uppercase tracking-[.3em]"
            maxLength={5}
            placeholder="ABC12"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label="Código de sala"
          />
          <button className="btn-ghost" disabled={busy !== null}>{busy === "join" ? "…" : "Unirse"}</button>
        </form>

        {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">{error}</p>}
      </section>

      <section className="mx-auto w-full max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Salas públicas</h2>
          <button className="text-sm text-muted hover:text-white" onClick={loadRooms}>Actualizar</button>
        </div>
        {rooms === null ? (
          <p className="text-sm text-muted">Cargando salas…</p>
        ) : rooms.length === 0 ? (
          <p className="card p-5 text-sm text-muted">No hay salas públicas abiertas ahora. ¡Crea una!</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {rooms.map((r) => (
              <li key={r.code} className="card flex items-center justify-between p-4">
                <div>
                  <p className="font-mono font-bold tracking-widest">{r.code}</p>
                  <p className="text-sm text-muted">de {r.host ?? "—"} · {r.players} jugador{r.players === 1 ? "" : "es"}</p>
                </div>
                <button className="btn-ghost py-2" onClick={() => join(r.code)} disabled={busy !== null}>Entrar</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
