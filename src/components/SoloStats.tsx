import type { Player } from "@/lib/supabase";

const secs = (ms: number) => (ms / 1000).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Cuando juegas solo, en vez de la tabla se muestran tus estadísticas
export default function SoloStats({ me, played }: { me: Player; played: number }) {
  const avg = me.answered_count > 0 ? me.total_ms / me.answered_count : null;
  const stats = [
    { label: "Racha actual", value: me.streak > 0 ? `🔥 ${me.streak}` : "0" },
    { label: "Mejor racha", value: String(me.best_streak) },
    { label: "Aciertos", value: `${me.correct_count}/${played}` },
    { label: "Tiempo promedio", value: avg === null ? "—" : `${secs(avg)} s` },
  ];
  return (
    <div className="card grid grid-cols-2 gap-3 p-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl bg-white/[.04] p-3 text-center">
          <p className="text-xs text-muted">{s.label}</p>
          <p className="tabular mt-1 text-2xl font-black">{s.value}</p>
        </div>
      ))}
    </div>
  );
}
