"use client";

import { useEffect, useState } from "react";
import { supabase, type Player, type Room, type Round } from "@/lib/supabase";
import type { Session } from "@/lib/session";

const secs = (ms: number) => (ms / 1000).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Podio: 2.º a la izquierda, 1.º al centro (más alto), 3.º a la derecha
const PODIUM = [
  { place: 1, medal: "🥈", height: "h-24", color: "from-slate-300/40 to-slate-400/10" },
  { place: 0, medal: "🥇", height: "h-32", color: "from-amber-300/50 to-amber-500/10" },
  { place: 2, medal: "🥉", height: "h-16", color: "from-orange-400/40 to-orange-600/10" },
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
    const place = players.length > 1 ? `Quedé #${myPlace} de ${players.length} ` : "";
    const text = `🎵 ${place}con ${me.score} puntos en JuegoMusical (${room.source_label}): ${me.correct_count}/${room.total_rounds} aciertos, mejor racha ${me.best_streak} 🔥. ¿Me ganas?`;
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
    <section className="card mx-auto flex w-full max-w-xl flex-col items-center gap-6 p-6 text-center sm:p-8">
      <p className="text-sm text-muted">Fin de la partida · {room.source_label}</p>

      {players.length > 1 ? (
        <div className="flex w-full items-end justify-center gap-3">
          {PODIUM.map(({ place, medal, height, color }) => {
            const p = ranking[place];
            if (!p) return <div key={place} className="w-1/3" />;
            return (
              <div key={place} className="animate-pop flex w-1/3 flex-col items-center gap-1" style={{ animationDelay: `${(2 - place) * 0.25}s` }}>
                <span className="text-3xl">{medal}</span>
                <span className={`max-w-full truncate font-bold ${p.id === session.player_id ? "text-brand-2" : ""}`}>{p.nickname}</span>
                <span className="tabular text-sm text-muted">{p.score}</span>
                <div className={`w-full rounded-t-xl bg-linear-to-b ${color} ${height}`} />
              </div>
            );
          })}
        </div>
      ) : (
        me && (
          <div className="animate-pop">
            <p className="text-6xl">🏆</p>
            <p className="tabular mt-2 text-4xl font-black">{me.score}</p>
            <p className="text-muted">puntos</p>
          </div>
        )
      )}

      {me && (
        <div className="grid w-full grid-cols-3 gap-2">
          <Stat label="Aciertos" value={`${me.correct_count}/${room.total_rounds}`} />
          <Stat label="Mejor racha" value={me.best_streak > 0 ? `🔥 ${me.best_streak}` : "0"} />
          <Stat label="Promedio" value={me.answered_count ? `${secs(me.total_ms / me.answered_count)} s` : "—"} />
        </div>
      )}

      {ranking.length > 3 && (
        <ol className="flex w-full flex-col gap-1.5" start={4}>
          {ranking.slice(3).map((p, i) => (
            <li key={p.id} className={`flex items-center gap-3 rounded-xl px-4 py-2 ${p.id === session.player_id ? "bg-brand/15" : "bg-white/[.04]"}`}>
              <span className="tabular w-6 text-muted">{i + 4}</span>
              <span className="flex-1 truncate text-left">{p.nickname}</span>
              <span className="tabular font-bold">{p.score}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="grid w-full gap-2 sm:grid-cols-2">
        {isHost ? (
          <button className="btn-primary" onClick={again} disabled={busy}>{busy ? "…" : "Jugar otra vez"}</button>
        ) : (
          <p className="self-center text-sm text-muted">Esperando al anfitrión…</p>
        )}
        <button className="btn-ghost" onClick={share}>{shared ? "¡Copiado!" : "Compartir resultado"}</button>
      </div>

      {songs.length > 0 && (
        <div className="w-full text-left">
          <h3 className="mb-2 text-sm font-semibold text-muted">Canciones de esta partida</h3>
          <ul className="flex flex-col gap-1.5">
            {songs.map((s, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl bg-white/[.04] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s.cover ? <img src={s.cover} alt="" className="size-10 rounded-lg object-cover" loading="lazy" /> : <span className="size-10" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.title}</span>
                  <span className="block truncate text-xs text-muted">{s.artist}</span>
                </span>
                {s.link && (
                  <a href={s.link} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-white/10 hover:text-white">
                    Escuchar ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[.04] p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="tabular mt-1 text-xl font-black">{value}</p>
    </div>
  );
}
