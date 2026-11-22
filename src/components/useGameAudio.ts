"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Maneja el audio del fragmento y, si el servidor de Deezer lo permite (CORS),
// conecta un analizador para que el ecualizador se mueva con la música real.
// Si no lo permite, cae a un <audio> normal y el ecualizador usa una animación.
export function useGameAudio(url: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const connected = useRef<WeakSet<HTMLAudioElement>>(new WeakSet());
  const analyserRef = useRef<AnalyserNode | null>(null);
  const corsBroken = useRef(false);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    let a = audioRef.current;
    if (!a) {
      a = new Audio();
      a.preload = "auto";
      a.crossOrigin = "anonymous";
      audioRef.current = a;
    }
    a.pause();
    const el = a;
    el.onerror = () => {
      // El CDN no permitió CORS: usar un audio sin analizador
      if (el.crossOrigin && !corsBroken.current) {
        corsBroken.current = true;
        const b = new Audio();
        b.preload = "auto";
        b.src = url;
        b.load();
        audioRef.current = b;
        analyserRef.current = null;
      }
    };
    el.src = url;
    el.load();
  }, [url]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const connect = useCallback((a: HTMLAudioElement) => {
    if (!a.crossOrigin || connected.current.has(a)) return;
    try {
      const ctx = ctxRef.current ?? new AudioContext();
      ctxRef.current = ctx;
      ctx.resume();
      const src = ctx.createMediaElementSource(a);
      const an = ctx.createAnalyser();
      an.fftSize = 64;
      an.smoothingTimeConstant = 0.75;
      src.connect(an);
      an.connect(ctx.destination);
      connected.current.add(a);
      analyserRef.current = an;
    } catch {
      analyserRef.current = null;
    }
  }, []);

  const play = useCallback(
    (fromSeconds: number) => {
      const a = audioRef.current;
      if (!a || !a.paused) return;
      if (fromSeconds > 0 && fromSeconds < 29) {
        try {
          a.currentTime = fromSeconds;
        } catch {}
      }
      a.play()
        .then(() => {
          setNeedsTap(false);
          connect(a);
          ctxRef.current?.resume();
        })
        .catch(() => setNeedsTap(true));
    },
    [connect],
  );

  const pause = useCallback(() => audioRef.current?.pause(), []);
  const setVolume = useCallback((v: number) => {
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  return { play, pause, setVolume, needsTap, analyserRef };
}
