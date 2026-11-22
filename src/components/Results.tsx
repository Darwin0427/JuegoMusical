"use client";

import { useEffect, useState } from "react";
import { supabase, type Player, type Room, type Round } from "@/lib/supabase";
import type { Session } from "@/lib/session";
import { ArrowOut, Flame } from "./ui/Icons";

const secs = (ms: number) => (ms / 1000).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Podio: 2.º a la izquierda, 1.º al centro (más alto), 3.º a la derecha
const PODIUM = [
  { place: 1, height: "h-24", color: "bg-cyan" },
  { place: 0, height: "h-36", color: "bg-sun" },
  { place: 2, height: "h-16", color: "bg-tangerine" },
];

export default function Results({ players, isHost, session, room }: { players: Player[]; isHost: boolean; session: Session; room: Room }) {
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(false);
  const [songs, setSongs] = useState<NonNullable<Round["answer"]>[]>([]);
  const ranking = [...players].sort((a, b) => b.score - a.score);
  const me = players.find((p) => p.id === session.player_id);
  const myPlace = ranking.findIndex((p) => p.id === session.player_id) + 1;

  useEffect(() => {
    let alive = true;
    supabase
      .from("rounds")
      .select("answer")
      .eq("room_id", room.id)
      .not("answer", "is", null)
      .order("round_number")
      .then(({ data }) => alive && setSongs(((data ?? []) as Pick<Round, "answer">[]).map((r) => r.answer!).filter(Boolean)));
    return () => {
      alive = false;
    };
  }, [room.id]);

  async function again() {
    setBusy(true);
    await supabase.rpc("back_to_lobby", { p_token: session.token });
    setBusy(false);
  }

  async function share() {
    if (!me) return;
    const lead = players.length > 1 ? `Quedé de ${myPlace} entre ${players.length} con ${me.score} puntos` : `Hice ${me.score} puntos`;
    const text = `${lead} en JuegoMusical (${room.source_label}): ${me.correct_count} de ${room.total_rounds} canciones, mejor racha de ${me.best_streak}. ¿Me ganas?`;
    const url = location.origin;
    try {
      if (navigator.share) {
        await navigator.share({ title: "JuegoMusical", text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {}
  }

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 text-center">
      <h1 className="display text-4xl sm:text-5xl [text-shadow:0_4px_0_var(--color-ink)]">
        {players.length > 1 ? (ranking[0]?.id === session.player_id ? "¡Ganaste!" : `Ganó ${ranking[0]?.nickname}`) : "Fin de la partida"}
      </h1>

      {players.length > 1 ? (
        <div className="flex w-full items-end justify-center gap-2 sm:gap-3">
          {PODIUM.map(({ place, height, color }) => {
            const p = ranking[place];
            if (!p) return <div key={place} className="w-1/3" />;
            return (
              <div key={place} className="animate-pop flex w-1/3 flex-col items-center gap-1" style={{ animationDelay: `${(2 - place) * 0.3}s` }}>
                <span className="max-w-full truncate font-black">{p.nickname}{p.id === session.player_id ? " (tú)" : ""}</span>
                <span className="display tabular text-xl">{p.score}</span>
                <div className={`grid w-full place-items-start justify-center rounded-t-xl border-[3px] border-b-0 border-ink pt-2 ${color} ${height}`}>
                  <span className="display text-4xl text-ink">{place + 1}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        me && (
          <div className="panel animate-pop px-10 py-5">
            <p className="font-extrabold text-muted">Puntaje final</p>
            <p className="display tabular text-6xl">{me.score}</p>
          </div>
        )
      )}

      <div className="panel flex w-full flex-col gap-5 p-5 text-ink">
        {me && (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Aciertos" value={`${me.correct_count}/${room.total_rounds}`} />
            <Stat label="Mejor racha" value={String(me.best_streak)} flame={me.best_streak >= 3} />
            <Stat label="Promedio" value={me.answered_count ? `${secs(me.total_ms / me.answered_count)} s` : "—"} />
          </div>
        )}

        {ranking.length > 3 && (
          <ol className="flex flex-col gap-1.5">
            {ranking.slice(3).map((p, i) => (
              <li key={p.id} className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2 ${p.id === session.player_id ? "border-ink bg-sun" : "border-fog"}`}>
                <span className="display tabular w-6 text-lg">{i + 4}</span>
                <span className="flex-1 truncate text-left font-extrabold">{p.nickname}</span>
                <span className="display tabular text-lg">{p.score}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {isHost ? (
            <button className="btn-primary" onClick={again} disabled={busy}>{busy ? "Preparando…" : "Jugar otra vez"}</button>
          ) : (
            <p className="self-center font-bold text-muted">El anfitrión decide si juegan otra</p>
          )}
          <button className="btn-ghost" onClick={share}>{shared ? "Resultado copiado" : "Compartir resultado"}</button>
        </div>

        {songs.length > 0 && (
          <div className="text-left">
            <h2 className="display mb-2 text-xl">Las canciones que sonaron</h2>
            <ul className="flex flex-col gap-2">
              {songs.map((s, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl bg-fog p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.cover ? <img src={s.cover} alt="" className="size-11 rounded-lg border-2 border-ink object-cover" loading="lazy" /> : <span className="size-11" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-extrabold">{s.title}</span>
                    <span className="block truncate text-sm font-bold text-muted">{s.artist}</span>
                  </span>
                  {s.link && (
                    <a href={s.link} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border-2 border-ink bg-paper px-3 py-1.5 text-sm font-extrabold hover:bg-sun">
                      Escuchar en Deezer <ArrowOut />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, flame = false }: { label: string; value: string; flame?: boolean }) {
  return (
    <div className="rounded-xl bg-fog p-3">
      <p className="text-sm font-extrabold text-muted">{label}</p>
      <p className={`display tabular mt-0.5 flex items-center justify-center gap-1 text-2xl ${flame ? "text-tangerine" : ""}`}>
        {flame && <Flame className="size-5" />}
        {value}
      </p>
    </div>
  );
}
