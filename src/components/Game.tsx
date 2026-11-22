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
import AnswerSearch from "./AnswerSearch";

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
  // Modo escribir: texto actual e intentos de esta ronda
  const [guess, setGuess] = useState<{ round: string; text: string }>({ round: "", text: "" });
  const [typed, setTyped] = useState<{ round: string; left: number; correct: boolean; ms: number; lastWrong: string } | null>(null);
  const [sending, setSending] = useState(false);
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
  const isTyped = room.answer_mode === "typed";
  const isArtist = room.target === "artist";
  const myTyped = typed?.round === round.id ? typed : null;
  const typedDone = !!myTyped && (myTyped.correct || myTyped.left === 0);
  const guessText = guess.round === round.id ? guess.text : "";
  // Segundo del fragmento que debe sonar ahora (con fragmento al azar empieza más adelante)
  const audioAt = useCallback((t: number) => (round.start_offset ?? 0) + Math.max(0, (t - startsAt) / 1000), [round.start_offset, startsAt]);
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
    if (phase === "playing") play(audioAt(now));
    if (phase === "countdown") pause();
  }, [phase, now, audioAt, play, pause]);

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
    const unlock = () => play(audioAt(Date.now() + offset));
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [needsTap, phase, play, offset, audioAt]);

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

  async function submitGuess(raw: string) {
    const text = raw.trim();
    if (!text || sending || typedDone || phase !== "playing") return;
    setSending(true);
    const ms = Math.max(0, now - startsAt);
    const { data, error } = await supabase.rpc("submit_answer", { p_token: session.token, p_round_id: round.id, p_text: text });
    setSending(false);
    if (error) return setError({ round: round.id, msg: error.message });
    const r = data as { correct: boolean; attempts_left: number };
    setTyped({ round: round.id, left: r.attempts_left, correct: r.correct, ms, lastWrong: r.correct ? "" : text });
    if (!r.correct) setGuess({ round: round.id, text: "" });
    if (sfxOn && !r.correct && r.attempts_left > 0) playSfx("wrong", volume * 0.6);
  }

  // Teclas 1-4 (solo con opciones, y nunca mientras se escribe en un campo)
  useEffect(() => {
    if (isTyped) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= round.options.length) answer(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, round.options.length, isTyped]);

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
                  : myTyped?.correct ? `¡La sacaste en ${secs(myTyped.ms)} s!`
                  : typedDone ? "Se acabaron tus intentos"
                  : isArtist ? "¿Quién canta?" : "¿Qué canción es?"}
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
          <button className="btn-ghost" onClick={() => play(audioAt(now))}>
            <Speaker /> Toca aquí para activar el sonido
          </button>
        )}

        {isTyped ? (
          phase === "reveal" ? (
            <div className="panel p-4">
              <h3 className="display mb-2 text-xl">Lo que escribió cada uno</h3>
              <ul className="flex flex-col gap-2">
                {players.map((p) => {
                  const r = (roundResults ?? []).find((x) => x.player_id === p.id);
                  return (
                    <li key={p.id} className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2 ${r?.is_correct ? "border-ink bg-ok text-paper" : "border-fog"}`}>
                      <span className="w-24 shrink-0 truncate font-black">{p.nickname}</span>
                      <span className="min-w-0 flex-1 truncate font-bold">
                        {r?.text_answer ? `“${r.text_answer}”` : <span className="opacity-60">sin respuesta</span>}
                      </span>
                      {r && <span className="tabular text-sm font-black">{r.is_correct ? `${secs(r.time_ms)} s` : `${r.attempts} intento${r.attempts === 1 ? "" : "s"}`}</span>}
                      {r && (r.is_correct ? <Check /> : <Cross className="size-4 text-bad" />)}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="panel flex flex-col gap-3 p-4">
              <label htmlFor="guess" className="display text-xl">{isArtist ? "¿Quién canta? Búscalo" : "¿Qué canción es? Búscala"}</label>
              <AnswerSearch
                value={guessText}
                onChange={(text) => setGuess({ round: round.id, text })}
                onSubmit={submitGuess}
                target={isArtist ? "artist" : "song"}
                disabled={phase !== "playing" || typedDone}
                invalid={!!myTyped?.lastWrong && !typedDone}
                busy={sending}
              />
              <p className={`text-sm font-extrabold ${myTyped?.correct ? "text-ok" : myTyped?.lastWrong ? "text-bad" : "text-muted"}`} aria-live="polite">
                {myTyped?.correct
                  ? "¡Correcto! Espera a que se revele para ver tus puntos."
                  : myTyped?.lastWrong
                    ? myTyped.left > 0
                      ? `“${myTyped.lastWrong}” no es. Te quedan ${myTyped.left} intento${myTyped.left === 1 ? "" : "s"}.`
                      : `“${myTyped.lastWrong}” tampoco era. Ya no te quedan intentos.`
                    : "Escribe parte del nombre y elige de la lista. Tienes 3 intentos."}
              </p>
            </div>
          )
        ) : (
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
                  {room.source_type !== "artist" && !isArtist && <span className="block truncate font-extrabold opacity-75">{o.artist}</span>}
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
        )}

        {!isTyped && <p className="hidden text-center text-sm font-bold text-paper/70 sm:block">En el teclado puedes responder con 1, 2, 3 o 4</p>}
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
