import type { Player } from "@/lib/supabase";
import { Flame } from "./ui/Icons";

const secs = (ms: number) => (ms / 1000).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Cuando juegas solo, en vez de la tabla se muestran tus estadísticas
export default function SoloStats({ me, played }: { me: Player; played: number }) {
  const avg = me.answered_count > 0 ? me.total_ms / me.answered_count : null;
  const stats = [
    { label: "Racha", value: me.streak, flame: me.streak > 0 },
    { label: "Mejor racha", value: me.best_streak, flame: false },
    { label: "Aciertos", value: `${me.correct_count}/${played}`, flame: false },
    { label: "Promedio", value: avg === null ? "—" : `${secs(avg)} s`, flame: false },
  ];
  return (
    <div className="panel grid grid-cols-2 gap-2 p-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl bg-fog p-3 text-center">
          <p className="text-sm font-extrabold text-muted">{s.label}</p>
          <p className={`display tabular mt-0.5 flex items-center justify-center gap-1 text-3xl ${s.flame ? "text-tangerine" : ""}`}>
            {s.flame && <Flame className="size-6" />}
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}
