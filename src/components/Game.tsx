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
import { Check, Cross, Flame, Speaker } from "./ui/Icons";

const REVEAL_MS = 5000;

// Cada pulsador con su color y número (también se responde con las teclas 1-4).
// Verde y rojo quedan reservados para acertar y fallar.
const STYLES = ["bg-sun", "bg-pink", "bg-cyan", "bg-tangerine"];

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

  // Si el navegador bloqueó el sonido, cualquier toque o tecla lo activa
  useEffect(() => {
    if (!needsTap || phase !== "playing") return;
    const unlock = () => play(Math.max(0, (Date.now() + offset - startsAt) / 1000));
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [needsTap, phase, play, offset, startsAt]);

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
      <section className="flex flex-col gap-5">
        <header className="flex items-center justify-between gap-3">
          <p className="display text-2xl">
            Ronda <span className="tabular">{room.current_round}</span>
            <span className="text-paper/60">/{room.total_rounds}</span>
          </p>
          <p className="hidden min-w-0 truncate font-extrabold text-paper/80 sm:block">{room.source_label}</p>
          <div className="flex shrink-0 items-center gap-2 rounded-xl border-[3px] border-ink bg-paper px-2 py-1 text-ink">
            <button
              onClick={() => saveVolume(volume > 0 ? 0 : lastVolume.current)}
              className="grid size-8 place-items-center rounded-lg hover:bg-fog"
              aria-label={volume > 0 ? "Silenciar música" : "Activar música"}
            >
              <Speaker muted={volume === 0} />
            </button>
            <input
              type="range" min={0} max={1} step={0.05} value={volume}
              onChange={(e) => saveVolume(Number(e.target.value))}
              className="hidden w-20 accent-stage sm:block"
              aria-label="Volumen de la música"
            />
            <button
              onClick={() => saveSfx(!sfxOn)}
              aria-pressed={sfxOn}
              className={`rounded-lg px-2 py-1 text-sm font-extrabold ${sfxOn ? "bg-ink text-paper" : "text-muted line-through"}`}
              title="Sonidos al acertar o fallar"
            >
              Efectos
            </button>
          </div>
        </header>

        <div className="flex flex-col items-center gap-3 py-2">
          <TimerRing pct={pct} urgent={urgent} spinning={phase === "playing"} cover={cover}>
            {phase === "countdown" && (
              <span key={countdown} className="display animate-pop tabular grid size-20 place-items-center rounded-full border-[3px] border-ink bg-paper text-5xl text-ink">{countdown}</span>
            )}
            {phase === "playing" && (
              <span className={`display tabular grid size-16 place-items-center rounded-full border-[3px] border-ink text-3xl ${urgent ? "bg-bad text-paper" : "bg-paper text-ink"}`}>
                {Math.ceil(left / 1000)}
              </span>
            )}
            {phase === "closing" && <span className="display rounded-xl border-[3px] border-ink bg-sun px-3 py-1 text-2xl text-ink">¡Tiempo!</span>}
          </TimerRing>

          {phase !== "reveal" ? (
            <div className="flex min-h-20 flex-col items-center gap-2 text-center">
              <Equalizer analyserRef={analyserRef} active={phase === "playing"} />
              <p className="display text-2xl">
                {phase === "countdown" ? "Prepárate"
                  : phase === "closing" ? "Veamos la respuesta"
                  : mine ? `Respondiste en ${secs(mine.ms)} s`
                  : "¿Qué canción es?"}
              </p>
            </div>
          ) : (
            round.answer && (
              <div className="animate-pop relative flex min-h-20 flex-col items-center text-center">
                <p className="display text-3xl sm:text-4xl">{round.answer.title}</p>
                <p className="font-extrabold text-paper/80">{round.answer.artist}</p>
                {myResult ? (
                  <p className={`mt-2 inline-flex items-center gap-1.5 rounded-xl border-[3px] border-ink px-3 py-1 font-black ${myResult.is_correct ? "bg-ok" : "bg-bad"} text-paper`}>
                    {myResult.is_correct ? <Check /> : <Cross />}
                    {myResult.is_correct ? `Correcto en ${secs(myResult.time_ms)} s` : `Era otra. Respondiste en ${secs(myResult.time_ms)} s`}
                  </p>
                ) : roundResults ? (
                  <p className="mt-2 font-extrabold text-paper/80">No alcanzaste a responder</p>
                ) : null}
                {myResult?.is_correct && (
                  <span className="display animate-float-up absolute -top-4 right-0 text-right text-3xl text-sun [text-shadow:0_3px_0_var(--color-ink)] sm:-right-24">
                    +{myResult.points}
                    {myResult.bonus > 0 && <span className="flex items-center justify-end gap-1 text-lg text-tangerine"><Flame />+{myResult.bonus}</span>}
                  </span>
                )}
              </div>
            )
          )}
        </div>

        {needsTap && phase === "playing" && (
          <button className="btn-ghost" onClick={() => play(Math.max(0, (now - startsAt) / 1000))}>
            <Speaker /> Toca aquí para activar el sonido
          </button>
        )}

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {round.options.map((o, i) => {
            const isCorrect = revealed && i === round.correct_index;
            const isMineWrong = revealed && i === mine?.index && !isCorrect;
            const picks = revealed ? (roundResults ?? []).filter((r) => r.choice === i) : [];
            const dim = (revealed && !isCorrect && !isMineWrong) || (!revealed && mine && mine.index !== i);
            const bg = isCorrect ? "bg-ok" : isMineWrong ? "bg-bad" : dim ? "bg-fog text-ink/55 [&_img]:grayscale" : STYLES[i % STYLES.length];
            const pressed = !revealed && mine?.index === i;
            return (
              <button
                key={i}
                onClick={() => answer(i)}
                disabled={phase !== "playing" || mine !== null}
                aria-pressed={pressed}
                className={`buzzer ${bg} ${pressed ? "is-pressed" : ""} ${phase === "countdown" ? "opacity-60" : ""} disabled:cursor-default`}
              >
                <span className="relative shrink-0">
                  {o.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.cover} alt="" className="size-14 rounded-xl border-[3px] border-ink object-cover sm:size-16" loading="eager" />
                  ) : (
                    <span className="block size-14 rounded-xl border-[3px] border-ink bg-paper sm:size-16" />
                  )}
                  <span className="display tabular absolute -top-2 -left-2 grid size-7 place-items-center rounded-lg border-[3px] border-ink bg-paper text-base text-ink">
                    {isCorrect ? <Check className="size-3.5" /> : isMineWrong ? <Cross className="size-3.5" /> : i + 1}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="display block truncate text-xl leading-tight">{o.title}</span>
                  {room.source_type !== "artist" && <span className="block truncate font-extrabold opacity-75">{o.artist}</span>}
                  {picks.length > 0 && (
                    <span className="mt-0.5 block truncate text-sm font-black">
                      {picks.map((r) => `${players.find((p) => p.id === r.player_id)?.nickname ?? "?"} ${secs(r.time_ms)}s`).join(", ")}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <p className="hidden text-center text-sm font-bold text-paper/70 sm:block">En el teclado puedes responder con 1, 2, 3 o 4</p>
        {roundError && <p className="text-center font-bold text-sun" role="alert">{roundError}</p>}
      </section>

      <aside className="flex flex-col gap-4">
        {me && (
          <div className="panel p-4 text-center">
            <p className="font-extrabold text-muted">Tus puntos</p>
            <p key={me.score} className="display animate-pop tabular text-5xl">{me.score}</p>
            {me.streak >= 2 && (
              <p className="mt-2 flex items-center justify-center gap-1 rounded-xl border-2 border-ink bg-tangerine px-2 py-1 text-sm font-black text-ink">
                <Flame />
                Racha de {me.streak}{me.streak < 3 ? ": una más y ganas bonus" : ": +150 por acierto"}
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
