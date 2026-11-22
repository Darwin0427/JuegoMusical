// Anillo de tiempo con un disco de vinilo que gira mientras suena la canción.
const R = 92;
const C = 2 * Math.PI * R;

export default function TimerRing({
  pct, urgent, spinning, cover, children,
}: { pct: number; urgent: boolean; spinning: boolean; cover?: string | null; children?: React.ReactNode }) {
  return (
    <div className={`relative size-52 sm:size-60 ${urgent ? "animate-urgent" : ""}`}>
      <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90" aria-hidden>
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="8" />
        <circle
          cx="100" cy="100" r={R} fill="none"
          stroke={urgent ? "#f43f5e" : "url(#ring)"}
          strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, pct)))}
          style={{ transition: "stroke-dashoffset .2s linear, stroke .3s" }}
        />
      </svg>
      <div
        className={`vinyl absolute inset-[14%] overflow-hidden rounded-full ${spinning ? "animate-spin-slow" : ""}`}
        style={{ animationPlayState: spinning ? "running" : "paused" }}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="animate-pop size-full object-cover" />
        ) : (
          <div className="absolute inset-[34%] rounded-full bg-linear-to-br from-brand to-brand-2" />
        )}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
