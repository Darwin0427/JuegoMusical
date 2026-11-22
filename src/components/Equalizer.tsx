"use client";

import { useEffect, useRef, type RefObject } from "react";

const BARS = 9;

// Barras que siguen el audio real; si no hay analizador, usan una animación de respaldo.
export default function Equalizer({ analyserRef, active }: { analyserRef: RefObject<AnalyserNode | null>; active: boolean }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const data = new Uint8Array(32);
    const tick = () => {
      const an = analyserRef.current;
      const live = active && an;
      bars.current.forEach((b, i) => {
        if (!b) return;
        b.dataset.fallback = active && !an ? "1" : "0";
        if (live) {
          an.getByteFrequencyData(data);
          const v = data[Math.min(data.length - 1, 1 + i * 2)] / 255;
          b.style.transform = `scaleY(${0.12 + v * 0.88})`;
        } else if (!active) {
          b.style.transform = "scaleY(0.12)";
        } else {
          b.style.removeProperty("transform");
        }
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyserRef, active]);

  return (
    <div className="eq-live flex h-10 items-end gap-1" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} ref={(el) => { bars.current[i] = el; }} style={{ animationDelay: `${(i % 5) * 0.12}s` }} />
      ))}
    </div>
  );
}
