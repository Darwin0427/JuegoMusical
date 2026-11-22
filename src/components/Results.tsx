"use client";

import { useState } from "react";
import { supabase, type Player, type Room } from "@/lib/supabase";
import type { Session } from "@/lib/session";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Results({ players, isHost, session, room }: { players: Player[]; isHost: boolean; session: Session; room: Room }) {
  const [busy, setBusy] = useState(false);
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
    </section>
  );
}
