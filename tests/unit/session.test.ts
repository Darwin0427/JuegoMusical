import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { clearSession, getNickname, getSession, saveNickname, saveSession, useHydrated, useSession, useStoredNickname } from "@/lib/session";

const s = { room_id: "r1", code: "ABCDE", player_id: "p1", token: "t1" };

describe("sesión del jugador (localStorage)", () => {
  it("guarda, lee (sin importar mayúsculas) y borra por código de sala", () => {
    expect(getSession("ABCDE")).toBeNull();
    saveSession(s);
    expect(getSession("abcde")).toEqual(s);
    saveSession({ ...s, code: "ZZZZZ", token: "t2" });
    expect(getSession("ZZZZZ")?.token).toBe("t2");
    clearSession("abcde");
    expect(getSession("ABCDE")).toBeNull();
    expect(getSession("ZZZZZ")).not.toBeNull();
  });

  it("tolera datos corruptos en localStorage", () => {
    localStorage.setItem("jm_sessions", "{no es json");
    expect(getSession("ABCDE")).toBeNull();
    saveSession(s);
    expect(getSession("ABCDE")).toEqual(s);
  });

  it("recuerda el apodo", () => {
    expect(getNickname()).toBe("");
    saveNickname("Darwin");
    expect(getNickname()).toBe("Darwin");
  });

  it("useSession se actualiza al guardar o borrar y mantiene la misma referencia si no cambia", () => {
    const { result, rerender } = renderHook(() => useSession("ABCDE"));
    expect(result.current).toBeNull();
    act(() => saveSession(s));
    const first = result.current;
    expect(first).toEqual(s);
    rerender();
    expect(result.current).toBe(first); // estable: evita bucles en efectos
    act(() => saveSession({ ...s, code: "OTRAS" })); // otra sala no la cambia
    expect(result.current).toBe(first);
    act(() => clearSession("ABCDE"));
    expect(result.current).toBeNull();
  });

  it("useStoredNickname y useHydrated", () => {
    const nick = renderHook(() => useStoredNickname());
    act(() => saveNickname("Ana"));
    expect(nick.result.current).toBe("Ana");
    expect(renderHook(() => useHydrated()).result.current).toBe(true);
  });
});
