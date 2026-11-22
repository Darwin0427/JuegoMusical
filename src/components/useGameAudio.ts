"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Maneja el audio del fragmento con un <audio> simple que va directo al parlante.
// (Antes se pasaba por Web Audio para un ecualizador "real", pero si el CDN de Deezer
// no permite CORS o el AudioContext queda suspendido, el juego se queda en silencio.)
export function useGameAudio(url: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null); // el ecualizador usa su animación
  const volumeRef = useRef(0.8);
  const pending = useRef(false);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    let a = audioRef.current;
    if (!a) {
      a = new Audio();
      a.preload = "auto";
      audioRef.current = a;
    }
    a.pause();
    pending.current = false;
    a.volume = volumeRef.current;
    a.src = url;
    a.load();
  }, [url]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const play = useCallback((fromSeconds: number) => {
    const a = audioRef.current;
    if (!a || !a.paused || pending.current) return;
    pending.current = true;
    a.volume = volumeRef.current;
    if (fromSeconds > 0.5 && fromSeconds < 29) {
      try {
        a.currentTime = fromSeconds;
      } catch {}
    }
    a.play()
      .then(() => setNeedsTap(false))
      .finally(() => {
        pending.current = false;
      })
      .catch((e: DOMException) => {
        // NotAllowedError = el navegador exige un toque antes de sonar
        if (e?.name === "NotAllowedError") setNeedsTap(true);
        else console.error("audio", e?.name, e?.message);
      });
  }, []);

  const pause = useCallback(() => audioRef.current?.pause(), []);
  const setVolume = useCallback((v: number) => {
    volumeRef.current = v;
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  return { play, pause, setVolume, needsTap, analyserRef };
}
