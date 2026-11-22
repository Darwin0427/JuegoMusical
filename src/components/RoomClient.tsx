"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, type Player, type Room, type Round } from "@/lib/supabase";
import { clearSession, saveNickname, saveSession, useHydrated, useSession, useStoredNickname, type Session } from "@/lib/session";
import Lobby from "./Lobby";
import Game from "./Game";
import Results from "./Results";

type RoomState = { room: Room | null; players: Player[]; round: Round | null };

async function fetchState(code: string): Promise<RoomState> {
  const { data: r } = await supabase.from("rooms").select("*").eq("code", code).maybeSingle();
  if (!r) return { room: null, players: [], round: null };
  const [{ data: ps }, { data: rd }] = await Promise.all([
    supabase.from("players").select("*").eq("room_id", r.id).order("joined_at"),
    r.current_round > 0
      ? supabase.from("rounds").select("*").eq("room_id", r.id).eq("round_number", r.current_round).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { room: r as Room, players: (ps as Player[]) ?? [], round: (rd as Round) ?? null };
}

export default function RoomClient({ code }: { code: string }) {
  const router = useRouter();
  const session = useSession(code);
  const checked = useHydrated();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [players, setPlayers] = useState<Player[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [offset, setOffset] = useState(0);

  const apply = useCallback((s: RoomState) => {
    setRoom(s.room);
    setPlayers(s.players);
    setRound(s.round);
  }, []);

  const refresh = useCallback(async () => {
    apply(await fetchState(code));
  }, [code, apply]);

  // Sincronizar reloj con el servidor + carga inicial
  useEffect(() => {
    let alive = true;
    const t0 = Date.now();
    supabase.rpc("server_now").then(({ data }) => {
      const t1 = Date.now();
      if (alive && data) setOffset(new Date(data as string).getTime() - (t0 + t1) / 2);
    });
    fetchState(code).then((s) => alive && apply(s));
    return () => {
      alive = false;
    };
  }, [code, apply]);

  useEffect(() => {
    if (!room?.id) return;
    const ch = supabase
      .channel(`sala-${room.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: `room_id=eq.${room.id}` }, refresh)
      .subscribe();
    const poll = setInterval(refresh, 6000); // respaldo por si se cae la conexión en vivo
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
    };
  }, [room?.id, refresh]);

  // Si el jugador ya no existe en la sala (lo sacaron o la sala se reinició), pedir apodo otra vez
  useEffect(() => {
    if (!session || !room || players.length === 0 || players.some((p) => p.id === session.player_id)) return;
    let cancel = false;
    supabase
      .from("players")
      .select("id")
      .eq("id", session.player_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancel || error || data) return;
        clearSession(code);
      });
    return () => {
      cancel = true;
    };
  }, [session, room, players, code]);

  async function leave() {
    if (session) await supabase.rpc("leave_room", { p_token: session.token });
    clearSession(code);
    router.push("/");
  }

  if (room === undefined || !checked) {
    return <Centered><p className="text-muted">Cargando sala…</p></Centered>;
  }
  if (room === null) {
    return (
      <Centered>
        <h1 className="text-2xl font-bold">No encontramos la sala {code}</h1>
        <p className="text-muted">Revisa el código o crea una nueva.</p>
        <Link href="/" className="btn-primary">Volver al inicio</Link>
      </Centered>
    );
  }
  if (!session) {
    return <JoinPrompt code={code} onJoined={() => refresh()} />;
  }

  const me = players.find((p) => p.id === session.player_id) ?? null;
  const isHost = room.host_player_id === session.player_id;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:py-10">
      <nav className="flex items-center justify-between">
        <Link href="/" className="text-lg font-black">
          Juego<span className="bg-linear-to-r from-brand to-brand-2 bg-clip-text text-transparent">Musical</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-lg border border-line px-3 py-1 font-mono tracking-widest">{room.code}</span>
          <button onClick={leave} className="text-muted hover:text-white">Salir</button>
        </div>
      </nav>

      {room.status === "lobby" && <Lobby room={room} players={players} session={session} isHost={isHost} />}
      {room.status === "playing" && round && (
        <Game room={room} players={players} round={round} me={me} session={session} offset={offset} />
      )}
      {room.status === "finished" && <Results players={players} isHost={isHost} session={session} room={room} />}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">{children}</main>;
}

function JoinPrompt({ code, onJoined }: { code: string; onJoined: (s: Session) => void }) {
  const stored = useStoredNickname();
  const [typed, setNick] = useState<string | null>(null);
  const nick = typed ?? stored;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const n = nick.trim();
    if (!n) return setError("Escribe tu apodo");
    setBusy(true);
    const { data, error } = await supabase.rpc("join_room", { p_code: code, p_nickname: n });
    setBusy(false);
    if (error) return setError(error.message);
    saveNickname(n);
    saveSession(data as Session);
    onJoined(data as Session);
  }

  return (
    <Centered>
      <form onSubmit={join} className="card w-full max-w-sm p-6 text-left">
        <h1 className="mb-1 text-xl font-bold">Entrar a la sala <span className="font-mono">{code}</span></h1>
        <p className="mb-4 text-sm text-muted">Elige cómo te verán los demás.</p>
        <input className="input" maxLength={20} placeholder="Tu apodo" value={nick} onChange={(e) => setNick(e.target.value)} autoFocus />
        {error && <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>}
        <button className="btn-primary mt-4 w-full" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </Centered>
  );
}
