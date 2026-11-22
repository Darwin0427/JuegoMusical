"use client";

import { useEffect, useState } from "react";
import { supabase, type Player, type Room, type Round } from "@/lib/supabase";
import type { Session } from "@/lib/session";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Results({ players, isHost, session, room }: { players: Player[]; isHost: boolean; session: Session; room: Room }) {
  const [busy, setBusy] = useState(false);
  const [songs, setSongs] = useState<NonNullable<Round["answer"]>[]>([]);

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
  const ranking = [...players].sort((a, b) => b.score - a.score);
  const winner = ranking[0];

  async function again() {
    setBusy(true);
    await supabase.rpc("back_to_lobby", { p_token: session.token });
    setBusy(false);
  }

  return (
    <section className="card mx-auto flex w-full max-w-xl flex-col items-center gap-6 p-8 text-center">
      <p className="text-sm text-muted">Fin de la partida · {room.source_label}</p>
      {winner && (
        <div className="animate-pop">
          <p className="text-6xl">🏆</p>
          <h2 className="mt-2 text-3xl font-black">
            {winner.id === session.player_id ? "¡Ganaste!" : `Ganó ${winner.nickname}`}
          </h2>
          <p className="tabular text-muted">{winner.score} puntos</p>
        </div>
      )}
      <ol className="flex w-full flex-col gap-2">
        {ranking.map((p, i) => (
          <li key={p.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 ${p.id === session.player_id ? "bg-brand/15" : "bg-white/[.04]"}`}>
            <span className="tabular w-8 text-lg">{MEDALS[i] ?? i + 1}</span>
            <span className="flex-1 truncate text-left font-medium">{p.nickname}</span>
            <span className="tabular font-bold">{p.score}</span>
          </li>
        ))}
      </ol>
      {isHost ? (
        <button className="btn-primary w-full" onClick={again} disabled={busy}>{busy ? "…" : "Jugar otra vez"}</button>
      ) : (
        <p className="text-sm text-muted">Esperando a que el anfitrión inicie otra partida…</p>
      )}

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
