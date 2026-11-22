"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Player } from "@/lib/supabase";
import { Crown, Flame } from "./ui/Icons";

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
    <div className="panel p-4">
      <h3 className="display mb-3 text-xl">Jugadores <span className="tabular text-muted">{players.length}/12</span></h3>
      <ul className="flex flex-col gap-2">
        {list.map((p, i) => {
          const move = moves[p.id];
          return (
            <li
              key={p.id}
              ref={(el) => {
                if (el) rows.current.set(p.id, el);
                else rows.current.delete(p.id);
              }}
              className={`relative flex items-center gap-3 rounded-xl border-2 px-3 py-2 ${p.id === meId ? "border-ink bg-sun" : "border-fog bg-paper"}`}
            >
              {showScore && <span className="display tabular w-6 text-lg">{i + 1}</span>}
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-extrabold">
                <span className="truncate">{p.nickname}</span>
                {p.id === hostId && <span className={p.id === meId ? "text-ink" : "text-tangerine"} title="Anfitrión"><Crown /></span>}
                {p.id === meId && <span className="text-xs font-black text-ink/70">tú</span>}
              </span>
              {move !== undefined && (
                <span className={`animate-pop rounded-md px-1.5 text-xs font-black text-paper ${move > 0 ? "bg-ok" : "bg-bad"}`}>
                  {move > 0 ? `▲${move}` : `▼${-move}`}
                </span>
              )}
              {showScore && p.streak >= 2 && (
                <span className={`flex items-center gap-0.5 text-sm font-black ${p.id === meId ? "text-ink" : "text-tangerine"}`} title={`${p.streak} aciertos seguidos`}><Flame />{p.streak}</span>
              )}
              {answeredRound !== undefined && p.answered_round === answeredRound && (
                <span className="rounded-md bg-ok px-1.5 text-xs font-black text-paper">listo</span>
              )}
              {showScore && <span className="display tabular text-lg">{p.score}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
