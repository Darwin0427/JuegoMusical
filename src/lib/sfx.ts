// Efectos cortos generados en el navegador (sin archivos de audio)
let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

export function playSfx(kind: "correct" | "wrong" | "streak", volume = 0.8) {
  try {
    ctx ??= new AudioContext();
    ctx.resume();
    const g = 0.18 * Math.max(0.05, volume);
    if (kind === "correct") {
      tone(660, 0, 0.12, "triangle", g);
      tone(880, 0.1, 0.18, "triangle", g);
    } else if (kind === "streak") {
      tone(660, 0, 0.1, "triangle", g);
      tone(880, 0.08, 0.1, "triangle", g);
      tone(1175, 0.16, 0.22, "triangle", g);
    } else {
      tone(220, 0, 0.18, "sawtooth", g * 0.6);
      tone(165, 0.12, 0.25, "sawtooth", g * 0.6);
    }
  } catch {}
}
