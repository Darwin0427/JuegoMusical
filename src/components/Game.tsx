"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, type Player, type Room, type Round, type RoundResult } from "@/lib/supabase";
import type { Session } from "@/lib/session";
import PlayerList from "./PlayerList";
import TimerRing from "./TimerRing";
import Equalizer from "./Equalizer";
import { useGameAudio } from "./useGameAudio";
import SoloStats from "./SoloStats";
import { useSfx, useVolume } from "@/lib/prefs";
import { playSfx } from "@/lib/sfx";

const REVEAL_MS = 5000;

// Cada opción con su color y número (también se responde con las teclas 1-4)
const STYLES = [
  { idle: "border-violet-400/30 bg-violet-500/10 hover:enabled:bg-violet-500/25", picked: "border-violet-300 bg-violet-500/35 ring-2 ring-violet-300/60", badge: "bg-violet-500" },
  { idle: "border-pink-400/30 bg-pink-500/10 hover:enabled:bg-pink-500/25", picked: "border-pink-300 bg-pink-500/35 ring-2 ring-pink-300/60", badge: "bg-pink-500" },
  { idle: "border-cyan-400/30 bg-cyan-500/10 hover:enabled:bg-cyan-500/25", picked: "border-cyan-300 bg-cyan-500/35 ring-2 ring-cyan-300/60", badge: "bg-cyan-500" },
  { idle: "border-amber-400/30 bg-amber-500/10 hover:enabled:bg-amber-500/25", picked: "border-amber-300 bg-amber-500/35 ring-2 ring-amber-300/60", badge: "bg-amber-500" },
];

const secs = (ms: number) => (ms / 1000).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function Game({
  room, players, round, me, session, offset,
}: { room: Room; players: Player[]; round: Round; me: Player | null; session: Session; offset: number }) {
  const [now, setNow] = useState(() => Date.now() + offset);
  const [choice, setChoice] = useState<{ round: string; index: number; ms: number } | null>(null);
  const [error, setError] = useState<{ round: string; msg: string } | null>(null);
  const [results, setResults] = useState<{ round: string; list: RoundResult[] } | null>(null);
  const lastAdvance = useRef(0);
  const { play, pause, setVolume, needsTap, analyserRef } = useGameAudio(round.preview_url);
  const [volume, saveVolume] = useVolume();
  const [sfxOn, saveSfx] = useSfx();
  const lastVolume = useRef(0.8);
  const sfxPlayed = useRef<string | null>(null);

  useEffect(() => {
    setVolume(volume);
    if (volume > 0) lastVolume.current = volume;
  }, [volume, setVolume, round.id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 100);
    return () => clearInterval(t);
  }, [offset]);

  const startsAt = round.starts_at ? new Date(round.starts_at).getTime() : Infinity;
  const endsAt = round.ends_at ? new Date(round.ends_at).getTime() : Infinity;
  const revealedAt = round.revealed_at ? new Date(round.revealed_at).getTime() : null;
  const phase: "countdown" | "playing" | "closing" | "reveal" =
    revealedAt ? "reveal" : now < startsAt ? "countdown" : now < endsAt ? "playing" : "closing";

  const mine = choice?.round === round.id ? choice : null;
  const roundResults = results?.round === round.id ? results.list : null;
  const roundError = error?.round === round.id ? error.msg : "";

  // Cualquier jugador empuja el juego cuando toca (el servidor decide si corresponde)
  useEffect(() => {
    const due = phase === "closing" || (phase === "reveal" && revealedAt !== null && now >= revealedAt + REVEAL_MS);
    if (!due || Date.now() - lastAdvance.current < 1200) return;
    lastAdvance.current = Date.now();
    supabase.rpc("advance", { p_token: session.token }).then(({ error }) => {
      if (error) console.error("advance", error.message);
    });
  }, [phase, now, revealedAt, session.token]);

  // Audio sincronizado: todos empiezan en el mismo segundo
  useEffect(() => {
    if (phase === "playing") play(Math.max(0, (now - startsAt) / 1000));
    if (phase === "countdown") pause();
  }, [phase, now, startsAt, play, pause]);

  useEffect(() => {
    if (phase !== "reveal") return;
    const t = setTimeout(pause, REVEAL_MS - 400);
    supabase.rpc("round_results", { p_round_id: round.id }).then(({ data }) =>
      setResults({ round: round.id, list: (data as RoundResult[]) ?? [] }),
    );
    return () => clearTimeout(t);
  }, [phase, round.id, pause]);

  // Efecto de sonido al revelar (una vez por ronda)
  useEffect(() => {
    if (!roundResults || sfxPlayed.current === round.id) return;
    sfxPlayed.current = round.id;
    if (!sfxOn) return;
    const r = roundResults.find((x) => x.player_id === session.player_id);
    if (!r) return;
    playSfx(r.is_correct ? (r.bonus > 0 ? "streak" : "correct") : "wrong", volume);
  }, [roundResults, round.id, sfxOn, session.player_id, volume]);

  const answer = useCallback(
    async (i: number) => {
      if (mine || phase !== "playing") return;
      setChoice({ round: round.id, index: i, ms: Math.max(0, now - startsAt) });
      const { error } = await supabase.rpc("submit_answer", { p_token: session.token, p_round_id: round.id, p_choice: i });
      if (error) setError({ round: round.id, msg: error.message });
    },
    [mine, phase, round.id, now, startsAt, session.token],
  );

  // Teclas 1-4
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= round.options.length) answer(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, round.options.length]);

  const total = Math.max(1, endsAt - startsAt);
  const left = Math.max(0, endsAt - now);
  const pct = phase === "playing" ? left / total : phase === "countdown" ? 1 : 0;
  const urgent = phase === "playing" && left <= 5000;
  const countdown = Math.max(1, Math.ceil((startsAt - now) / 1000));
  const myResult = roundResults?.find((r) => r.player_id === session.player_id);
  const revealed = phase === "reveal" && round.correct_index !== null;
  const cover = phase === "reveal" ? round.answer?.cover : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section className="card relative overflow-hidden p-5 sm:p-8">
        {/* Portada difuminada de fondo al revelar */}
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" aria-hidden className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-25 blur-3xl" />
        )}

        <div className="relative flex flex-col gap-6">
          <header className="flex items-center justify-between gap-3 text-sm text-muted">
            <span className="shrink-0">Ronda <b className="tabular text-white">{room.current_round}</b> de {room.total_rounds}</span>
            <span className="hidden min-w-0 truncate sm:block">{room.source_label}</span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => saveVolume(volume > 0 ? 0 : lastVolume.current)}
                className="grid size-8 place-items-center rounded-lg hover:bg-white/10"
                aria-label={volume > 0 ? "Silenciar música" : "Activar música"}
                title="Volumen de la música"
              >
                {volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
              </button>
              <input
                type="range" min={0} max={1} step={0.05} value={volume}
                onChange={(e) => saveVolume(Number(e.target.value))}
                className="hidden w-20 accent-brand sm:block"
                aria-label="Volumen de la música"
              />
              <button
                onClick={() => saveSfx(!sfxOn)}
                className={`rounded-lg px-2 py-1 text-xs ${sfxOn ? "bg-white/10 text-white" : "text-muted line-through"}`}
                title="Sonidos al acertar o fallar"
              >
                Efectos
              </button>
            </div>
          </header>

          <div className="flex flex-col items-center gap-4">
            <TimerRing pct={pct} urgent={urgent} spinning={phase === "playing"} cover={cover}>
              {phase === "countdown" && (
                <span key={countdown} className="animate-pop tabular rounded-full bg-ink/80 px-5 py-2 text-5xl font-black">{countdown}</span>
              )}
              {phase === "playing" && (
                <span className={`tabular rounded-full bg-ink/80 px-4 py-1.5 text-3xl font-black ${urgent ? "text-rose-400" : ""}`}>
                  {Math.ceil(left / 1000)}
                </span>
              )}
              {phase === "closing" && <span className="rounded-full bg-ink/80 px-4 py-1.5 text-xl font-black">¡Tiempo!</span>}
            </TimerRing>

            {phase !== "reveal" ? (
              <div className="flex min-h-20 flex-col items-center gap-2 text-center">
                <Equalizer analyserRef={analyserRef} active={phase === "playing"} />
                <p className="text-muted">
                  {phase === "countdown" ? "Prepárate…"
                    : phase === "closing" ? "Revelando la respuesta…"
                    : mine ? `Respondiste en ${secs(mine.ms)} s. Esperando a los demás…`
                    : room.source_type === "artist" ? "¿Qué canción es?" : "¿Qué canción suena?"}
                </p>
              </div>
            ) : (
              round.answer && (
                <div className="animate-pop relative flex min-h-20 flex-col items-center text-center">
                  <p className="text-2xl font-black sm:text-3xl">{round.answer.title}</p>
                  <p className="text-muted">{round.answer.artist}</p>
                  {myResult ? (
                    <p className={`mt-2 font-semibold ${myResult.is_correct ? "text-emerald-300" : "text-rose-300"}`}>
                      {myResult.is_correct ? `¡Correcto! en ${secs(myResult.time_ms)} s` : `Fallaste · respondiste en ${secs(myResult.time_ms)} s`}
                    </p>
                  ) : roundResults ? (
                    <p className="mt-2 text-muted">No respondiste a tiempo</p>
                  ) : null}
                  {myResult?.is_correct && (
                    <span className="animate-float-up absolute -top-2 right-0 text-right text-2xl font-black text-emerald-300 sm:-right-20">
                      +{myResult.points}
                      {myResult.bonus > 0 && <span className="block text-sm text-orange-300">+{myResult.bonus} 🔥 racha</span>}
                    </span>
                  )}
                </div>
              )
            )}
          </div>

          {needsTap && phase === "playing" && (
            <button className="btn-primary" onClick={() => play(Math.max(0, (now - startsAt) / 1000))}>
              🔊 Toca para activar el sonido
            </button>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {round.options.map((o, i) => {
              const s = STYLES[i % STYLES.length];
              const isCorrect = revealed && i === round.correct_index;
              const isMineWrong = revealed && i === mine?.index && !isCorrect;
              const picks = revealed ? (roundResults ?? []).filter((r) => r.choice === i) : [];
              const state = isCorrect ? "border-emerald-400 bg-emerald-500/25 ring-2 ring-emerald-400/60"
                : isMineWrong ? "border-rose-400 bg-rose-500/20"
                : revealed ? "border-line bg-white/[.02] opacity-45"
                : mine?.index === i ? s.picked
                : mine ? `${s.idle} opacity-50`
                : s.idle;
              return (
                <button
                  key={i}
                  onClick={() => answer(i)}
                  disabled={phase !== "playing" || mine !== null}
                  className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition sm:p-4 disabled:cursor-default ${state} ${phase === "countdown" ? "opacity-40" : ""}`}
                >
                  <span className={`tabular grid size-9 shrink-0 place-items-center rounded-xl text-lg font-black text-white ${isCorrect ? "bg-emerald-500" : isMineWrong ? "bg-rose-500" : s.badge}`}>
                    {isCorrect ? "✓" : isMineWrong ? "✕" : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{o.title}</span>
                    {room.source_type !== "artist" && <span className="block truncate text-sm text-muted">{o.artist}</span>}
                    {picks.length > 0 && (
                      <span className="mt-0.5 block truncate text-xs text-white/70">
                        {picks.map((r) => `${players.find((p) => p.id === r.player_id)?.nickname ?? "?"} ${secs(r.time_ms)}s`).join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="hidden text-center text-xs text-muted sm:block">Tip: responde con las teclas 1 a 4</p>
          {roundError && <p className="text-center text-sm text-rose-300" role="alert">{roundError}</p>}
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        {me && (
          <div className="card p-5 text-center">
            <p className="text-sm text-muted">Tus puntos</p>
            <p key={me.score} className="animate-pop tabular text-4xl font-black">{me.score}</p>
            {me.streak >= 2 && (
              <p className="mt-1 text-sm font-bold text-orange-300">
                🔥 Racha x{me.streak}{me.streak >= 2 && me.streak < 3 ? " · ¡una más y hay bonus!" : " · +150 por acierto"}
              </p>
            )}
          </div>
        )}
        {players.length === 1 && me ? (
          <SoloStats me={me} played={phase === "reveal" ? room.current_round : room.current_round - 1} />
        ) : (
          <PlayerList players={players} hostId={room.host_player_id} meId={session.player_id} showScore answeredRound={phase === "reveal" ? undefined : room.current_round} />
        )}
      </aside>
    </div>
  );
}
