"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/ui/Logo";
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
    <main className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 px-5 py-10 sm:py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <Logo size="lg" />
        <p className="max-w-md text-lg font-bold text-paper/85">
          Suena un fragmento. Tú y tus amigos tienen 20 segundos para adivinar qué canción es.
        </p>
      </header>

      <section className="panel w-full max-w-md p-6">
        <label className="mb-2 block font-extrabold" htmlFor="nick">Tu apodo</label>
        <input
          id="nick"
          className="input"
          maxLength={20}
          placeholder="Como te verán los demás"
          value={nick}
          onChange={(e) => setNick(e.target.value)}
        />

        <button className="btn-primary mt-5 w-full py-4 text-xl" onClick={create} disabled={busy !== null}>
          {busy === "create" ? "Creando sala…" : "Crear sala"}
        </button>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-bold text-muted">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="size-4 accent-stage" />
          Que aparezca en salas públicas
        </label>

        <div className="my-6 border-t-[3px] border-dashed border-fog" />

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <input
            className="input tabular display text-center text-2xl uppercase tracking-[.25em]"
            maxLength={5}
            placeholder="CÓDIGO"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label="Código de sala"
          />
          <button className="btn-ghost" disabled={busy !== null}>{busy === "join" ? "…" : "Entrar"}</button>
        </form>

        {error && <p className="mt-4 rounded-xl border-2 border-bad bg-bad/10 px-3 py-2 text-sm font-bold text-bad" role="alert">{error}</p>}
      </section>

      <section className="w-full max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-2xl">Salas públicas</h2>
          <button className="font-extrabold text-paper/80 underline-offset-4 hover:text-paper hover:underline" onClick={loadRooms}>Actualizar</button>
        </div>
        {rooms === null ? (
          <p className="font-bold text-paper/70">Buscando salas…</p>
        ) : rooms.length === 0 ? (
          <p className="rounded-2xl border-[3px] border-dashed border-paper/40 p-5 text-center font-bold text-paper/80">
            No hay salas públicas abiertas. Crea una y márcala como pública.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rooms.map((r) => (
              <li key={r.code} className="panel flex items-center justify-between p-4">
                <div>
                  <p className="display text-xl tracking-widest">{r.code}</p>
                  <p className="text-sm font-bold text-muted">Sala de {r.host ?? "alguien"}, {r.players} jugador{r.players === 1 ? "" : "es"}</p>
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
