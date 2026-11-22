"use client";

import { useSyncExternalStore } from "react";

// Preferencias del jugador guardadas en el navegador (volumen y efectos de sonido)
const EVT = "jm-prefs";
const KEYS = { volume: "jm_volume", sfx: "jm_sfx" } as const;

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(EVT));
}

export function useVolume(): [number, (v: number) => void] {
  const raw = useSyncExternalStore(subscribe, () => read(KEYS.volume), () => null);
  const v = raw === null ? 0.8 : Math.max(0, Math.min(1, Number(raw)));
  return [Number.isFinite(v) ? v : 0.8, (n) => write(KEYS.volume, String(n))];
}

export function useSfx(): [boolean, (on: boolean) => void] {
  const raw = useSyncExternalStore(subscribe, () => read(KEYS.sfx), () => null);
  return [raw !== "0", (on) => write(KEYS.sfx, on ? "1" : "0")];
}
