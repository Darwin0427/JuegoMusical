"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, type Player, type Room, type Round, type RoundResult } from "@/lib/supabase";
import type { Session } from "@/lib/session";
import PlayerList from "./PlayerList";

const REVEAL_MS = 5000;

export default function Game({
  room, players, round, me, session, offset,
}: { room: Room; players: Player[]; round: Round; me: Player | null; session: Session; offset: number }) {
  const [now, setNow] = useState(() => Date.now() + offset);
  const [choice, setChoice] = useState<{ round: string; index: number } | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<RoundResult[] | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastAdvance = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 200);
    return () => clearInterval(t);
  }, [offset]);

  const startsAt = round.starts_at ? new Date(round.starts_at).getTime() : Infinity;
  const endsAt = round.ends_at ? new Date(round.ends_at).getTime() : Infinity;
  const revealedAt = round.revealed_at ? new Date(round.revealed_at).getTime() : null;
  const phase: "countdown" | "playing" | "closing" | "reveal" =
    revealedAt ? "reveal" : now < startsAt ? "countdown" : now < endsAt ? "playing" : "closing";

  const myChoice = choice?.round === round.id ? choice.index : null;

  // Cualquier jugador empuja el juego cuando toca (el servidor decide si corresponde)
  useEffect(() => {
    const due = phase === "closing" || (phase === "reveal" && revealedAt !== null && now >= revealedAt + REVEAL_MS);
    if (!due || Date.now() - lastAdvance.current < 1200) return;
    lastAdvance.current = Date.now();
    supabase.rpc("advance", { p_token: session.token });
  }, [phase, now, revealedAt, session.token]);

  // Audio: cargar el fragmento de cada ronda y sonar al mismo tiempo para todos
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.src = round.preview_url;
    a.load();
    setResults(null);
    setError("");
  }, [round.id, round.preview_url]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (phase === "playing" && a.paused) {
      const elapsed = Math.max(0, (now - startsAt) / 1000);
      if (elapsed < 29) {
        try { a.currentTime = elapsed; } catch {}
      }
      a.volume = 0.9;
      a.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
    }
    if (phase === "countdown" && !a.paused) a.pause();
  }, [phase, now, startsAt]);

  // Fade y pausa unos segundos después de revelar
  useEffect(() => {
    if (phase !== "reveal") return;
    const a = audioRef.current;
    const t = setTimeout(() => a?.pause(), REVEAL_MS - 500);
    supabase.rpc("round_results", { p_round_id: round.id }).then(({ data }) => setResults((data as RoundResult[]) ?? []));
    return () => clearTimeout(t);
  }, [phase, round.id]);

  async function answer(i: number) {
    if (myChoice !== null || phase !== "playing") return;
    setChoice({ round: round.id, index: i });
    const { error } = await supabase.rpc("submit_answer", { p_token: session.token, p_round_id: round.id, p_choice: i });
    if (error) setError(error.message);
  }

  const total = Math.max(1, endsAt - startsAt);
  const left = Math.max(0, endsAt - now);
  const pct = phase === "playing" ? (left / total) * 100 : phase === "countdown" ? 100 : 0;
  const countdown = Math.ceil((startsAt - now) / 1000);
  const myResult = results?.find((r) => r.player_id === session.player_id);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="card flex flex-col gap-6 p-5 sm:p-8">
        <audio ref={audioRef} preload="auto" />
        <header className="flex items-center justify-between text-sm text-muted">
          <span>Ronda <b className="tabular text-white">{room.current_round}</b> de {room.total_rounds}</span>
          <span className="truncate pl-3">{room.source_label}</span>
        </header>

        <div className="h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className="h-full rounded-full bg-linear-to-r from-brand to-brand-2 transition-[width] duration-200 ease-linear" style={{ width: `${pct}%` }} />
        </div>

        <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
          {phase === "countdown" && (
            <>
              <p className="text-muted">Prepárate…</p>
              <p key={countdown} className="animate-pop tabular text-7xl font-black">{Math.max(1, countdown)}</p>
            </>
          )}
          {(phase === "playing" || phase === "closing") && (
            <>
              <div className="eq" aria-hidden><span /><span /><span /><span /><span /></div>
              <p className="tabular text-3xl font-black">{Math.ceil(left / 1000)} s</p>
              <p className="text-muted">{myChoice !== null ? "Respuesta enviada. Esperando a los demás…" : room.source_type === "artist" ? "¿Qué canción es?" : "¿Qué canción suena?"}</p>
            </>
          )}
          {phase === "reveal" && round.answer && (
            <div className="animate-pop flex flex-col items-center gap-3 sm:flex-row sm:text-left">
              {round.answer.cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={round.answer.cover} alt="" className="size-32 rounded-xl object-cover shadow-2xl shadow-brand/30" />
              )}
              <div>
                <p className="text-sm text-muted">Era…</p>
                <p className="text-2xl font-black">{round.answer.title}</p>
                <p className="text-muted">{round.answer.artist}</p>
                {myResult ? (
                  <p className={`mt-2 font-semibold ${myResult.is_correct ? "text-emerald-300" : "text-red-300"}`}>
                    {myResult.is_correct ? `¡Correcto! +${myResult.points}` : "Fallaste esta"}
                  </p>
                ) : results ? (
                  <p className="mt-2 text-muted">No respondiste a tiempo</p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {needsTap && phase === "playing" && (
          <button className="btn-primary" onClick={() => audioRef.current?.play().then(() => setNeedsTap(false))}>
            🔊 Toca para activar el sonido
          </button>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {round.options.map((o, i) => {
            const revealed = phase === "reveal" && round.correct_index !== null;
            const isCorrect = revealed && i === round.correct_index;
            const isMineWrong = revealed && i === myChoice && !isCorrect;
            const whoPicked = revealed ? (results ?? []).filter((r) => r.choice === i).map((r) => players.find((p) => p.id === r.player_id)?.nickname).filter(Boolean) : [];
            return (
              <button
                key={i}
                onClick={() => answer(i)}
                disabled={phase !== "playing" || myChoice !== null}
                className={`rounded-2xl border p-4 text-left transition disabled:cursor-default ${
                  isCorrect ? "border-emerald-400 bg-emerald-500/20"
                  : isMineWrong ? "border-red-400 bg-red-500/15"
                  : myChoice === i ? "border-brand bg-brand/20"
                  : "border-line bg-white/[.03] hover:enabled:border-brand hover:enabled:bg-brand/10"
                } ${phase === "countdown" ? "opacity-40" : ""}`}
              >
                <span className="block font-semibold">{o.title}</span>
                {room.source_type !== "artist" && <span className="block text-sm text-muted">{o.artist}</span>}
                {whoPicked.length > 0 && <span className="mt-1 block text-xs text-muted">{whoPicked.join(", ")}</span>}
              </button>
            );
          })}
        </div>

        {error && <p className="text-center text-sm text-red-300" role="alert">{error}</p>}
      </section>

      <aside className="flex flex-col gap-4">
        {me && (
          <div className="card p-5 text-center">
            <p className="text-sm text-muted">Tus puntos</p>
            <p className="tabular text-4xl font-black">{me.score}</p>
          </div>
        )}
        <PlayerList players={players} hostId={room.host_player_id} meId={session.player_id} showScore answeredRound={phase === "reveal" ? undefined : room.current_round} />
      </aside>
    </div>
  );
}
