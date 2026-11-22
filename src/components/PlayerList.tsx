"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Player } from "@/lib/supabase";

// Tabla de jugadores. Con showScore se ordena por puntaje y anima los cambios de puesto.
export default function PlayerList({
  players, hostId, meId, showScore = false, answeredRound,
}: { players: Player[]; hostId: string | null; meId: string; showScore?: boolean; answeredRound?: number }) {
  const list = showScore ? [...players].sort((a, b) => b.score - a.score || a.joined_at.localeCompare(b.joined_at)) : players;
  const rows = useRef(new Map<string, HTMLLIElement>());
  const prevTop = useRef(new Map<string, number>());
  const prevRank = useRef(new Map<string, number>());
  const [moves, setMoves] = useState<Record<string, number>>({});
  const order = list.map((p) => p.id).join(",");

  // Animación FLIP: cada fila arranca donde estaba y se desliza a su nuevo puesto
  useLayoutEffect(() => {
    const changes: Record<string, number> = {};
    list.forEach((p, i) => {
      const el = rows.current.get(p.id);
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const before = prevTop.current.get(p.id);
      if (before !== undefined && before !== top) {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], {
          duration: 550,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      }
      const r = prevRank.current.get(p.id);
      if (showScore && r !== undefined && r !== i) changes[p.id] = r - i;
      prevTop.current.set(p.id, top);
      prevRank.current.set(p.id, i);
    });
    if (Object.keys(changes).length) {
      const show = requestAnimationFrame(() => setMoves(changes));
      const hide = setTimeout(() => setMoves({}), 2500);
      return () => {
        cancelAnimationFrame(show);
        clearTimeout(hide);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted">Jugadores ({players.length}/12)</h3>
      <ul className="flex flex-col gap-1.5">
        {list.map((p, i) => {
          const move = moves[p.id];
          return (
            <li
              key={p.id}
              ref={(el) => {
                if (el) rows.current.set(p.id, el);
                else rows.current.delete(p.id);
              }}
              className={`relative flex items-center gap-3 rounded-lg px-3 py-2 ${p.id === meId ? "bg-brand/15" : "bg-white/[.03]"}`}
            >
              {showScore && <span className="tabular w-5 text-sm text-muted">{i + 1}</span>}
              <span className="min-w-0 flex-1 truncate">
                {p.nickname}
                {p.id === hostId && <span className="ml-1.5 text-xs text-amber-300" title="Anfitrión">★</span>}
                {p.id === meId && <span className="ml-1.5 text-xs text-muted">(tú)</span>}
              </span>
              {move !== undefined && (
                <span className={`animate-pop text-xs font-bold ${move > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {move > 0 ? `▲${move}` : `▼${-move}`}
                </span>
              )}
              {showScore && p.streak >= 2 && (
                <span className="text-xs font-bold text-orange-300" title={`${p.streak} aciertos seguidos`}>🔥{p.streak}</span>
              )}
              {answeredRound !== undefined && p.answered_round === answeredRound && (
                <span className="text-xs text-emerald-300">respondió</span>
              )}
              {showScore && <span className="tabular font-semibold">{p.score}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
