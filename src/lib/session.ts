import { useMemo, useSyncExternalStore } from "react";

// Guarda en el navegador el token secreto de cada sala en la que entra el jugador.
export type Session = { room_id: string; code: string; player_id: string; token: string };

const KEY = "jm_sessions";
const NICK = "jm_nickname";

function read(): Record<string, Session> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getSession(code: string): Session | null {
  return read()[code.toUpperCase()] ?? null;
}

export function saveSession(s: Session) {
  try {
    const all = read();
    all[s.code.toUpperCase()] = s;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
  notifyStorage();
}

export function clearSession(code: string) {
  try {
    const all = read();
    delete all[code.toUpperCase()];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
  notifyStorage();
}

export function getNickname(): string {
  try {
    return localStorage.getItem(NICK) ?? "";
  } catch {
    return "";
  }
}

export function saveNickname(n: string) {
  try {
    localStorage.setItem(NICK, n);
  } catch {}
  notifyStorage();
}

// ── Lectura reactiva de localStorage (sin romper la hidratación) ──

const EVT = "jm-storage";
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
}
export function notifyStorage() {
  try { window.dispatchEvent(new Event(EVT)); } catch {}
}
const noop = () => () => {};

export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function useStoredNickname(): string {
  return useSyncExternalStore(subscribe, () => getNickname(), () => "");
}

export function useSession(code: string): Session | null {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try { return localStorage.getItem(KEY) ?? "{}"; } catch { return "{}"; }
    },
    () => "{}",
  );
  const key = code.toUpperCase();
  const json = useMemo(() => {
    try {
      const s = (JSON.parse(raw) as Record<string, Session>)[key];
      return s ? JSON.stringify(s) : null;
    } catch {
      return null;
    }
  }, [raw, key]);
  return useMemo(() => (json ? (JSON.parse(json) as Session) : null), [json]);
}
