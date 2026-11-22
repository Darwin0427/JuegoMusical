import type { Player } from "@/lib/supabase";

export default function PlayerList({
  players, hostId, meId, showScore = false, answeredRound,
}: { players: Player[]; hostId: string | null; meId: string; showScore?: boolean; answeredRound?: number }) {
  const list = showScore ? [...players].sort((a, b) => b.score - a.score) : players;
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted">Jugadores ({players.length}/12)</h3>
      <ul className="flex flex-col gap-1.5">
        {list.map((p, i) => (
          <li key={p.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${p.id === meId ? "bg-brand/15" : "bg-white/[.03]"}`}>
            {showScore && <span className="tabular w-5 text-sm text-muted">{i + 1}</span>}
            <span className="flex-1 truncate">
              {p.nickname}
              {p.id === hostId && <span className="ml-1.5 text-xs text-amber-300" title="Anfitrión">★</span>}
              {p.id === meId && <span className="ml-1.5 text-xs text-muted">(tú)</span>}
            </span>
            {answeredRound !== undefined && p.answered_round === answeredRound && (
              <span className="text-xs text-emerald-300">respondió</span>
            )}
            {showScore && <span className="tabular font-semibold">{p.score}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
