// Íconos propios (trazo grueso, estilo del juego)
type P = { className?: string };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Flame = ({ className = "size-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
    <path d="M12 2c1 3.5 5 5.6 5 10.5A5 5 0 0 1 12 18a5 5 0 0 1-5-5.5c0-2 1-3.3 2-4.2.2 1.6 1 2.7 2 3.2C11 9 11.3 5.2 12 2Z" />
    <path d="M7 19.5h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const Speaker = ({ className = "size-5", muted = false }: P & { muted?: boolean }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
  </svg>
);

export const Sparkle = ({ className = "size-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
    <path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z" />
  </svg>
);

export const Crown = ({ className = "size-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z" />
  </svg>
);

export const Check = ({ className = "size-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base} strokeWidth={3.5}><path d="M5 12.5l4.5 4.5L19 7" /></svg>
);

export const Cross = ({ className = "size-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base} strokeWidth={3.5}><path d="M6 6l12 12M18 6L6 18" /></svg>
);

export const ArrowOut = ({ className = "size-3.5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}><path d="M9 5h10v10M19 5L6 18" /></svg>
);
