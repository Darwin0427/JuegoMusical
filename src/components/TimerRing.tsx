// Temporizador del concurso: anillo grueso sobre un disco que gira mientras suena la canción.
const R = 88;
const C = 2 * Math.PI * R;

export default function TimerRing({
  pct, urgent, spinning, cover, children,
}: { pct: number; urgent: boolean; spinning: boolean; cover?: string | null; children?: React.ReactNode }) {
  return (
    <div className="relative grid place-items-center">
      <div className="sunburst pointer-events-none absolute -inset-24" aria-hidden />
      <div className={`relative size-52 sm:size-60 ${urgent ? "animate-urgent" : ""}`}>
        <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="100" cy="100" r={R} fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="22" />
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--color-fog)" strokeWidth="14" />
          <circle
            cx="100" cy="100" r={R} fill="none"
            stroke={urgent ? "var(--color-bad)" : "var(--color-sun)"}
            strokeWidth="14" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, pct)))}
            style={{ transition: "stroke-dashoffset .2s linear, stroke .2s" }}
          />
        </svg>
        <div
          className={`absolute inset-[17%] overflow-hidden rounded-full border-[3px] border-ink bg-ink ${spinning ? "animate-spin-slow" : ""}`}
          style={{ animationPlayState: spinning ? "running" : "paused" }}
        >
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="animate-pop size-full object-cover" />
          ) : (
            <>
              <div className="absolute inset-[18%] rounded-full border-2 border-paper/15" />
              <div className="absolute inset-[30%] rounded-full border-2 border-paper/15" />
              <div className="absolute inset-[38%] rounded-full bg-pink" />
            </>
          )}
        </div>
        <div className="absolute inset-0 grid place-items-center">{children}</div>
      </div>
    </div>
  );
}
