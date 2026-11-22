import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSfx, useVolume } from "@/lib/prefs";

afterEach(() => vi.unstubAllGlobals());

describe("preferencias", () => {
  it("volumen: 0,8 por defecto, se guarda y se limita a 0..1", () => {
    const { result } = renderHook(() => useVolume());
    expect(result.current[0]).toBe(0.8);
    act(() => result.current[1](0.3));
    expect(result.current[0]).toBe(0.3);
    act(() => result.current[1](5));
    expect(result.current[0]).toBe(1);
    localStorage.setItem("jm_volume", "basura");
    act(() => window.dispatchEvent(new Event("jm-prefs")));
    expect(result.current[0]).toBe(0.8);
  });

  it("efectos: activos por defecto y se pueden apagar", () => {
    const { result } = renderHook(() => useSfx());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem("jm_sfx")).toBe("0");
  });
});

describe("efectos de sonido", () => {
  it("no falla si el navegador no tiene AudioContext", async () => {
    vi.resetModules();
    vi.stubGlobal("AudioContext", undefined);
    const { playSfx } = await import("@/lib/sfx");
    expect(() => playSfx("correct")).not.toThrow();
  });

  it("toca 2, 3 y 2 notas para acertar, racha y fallar", async () => {
    vi.resetModules();
    const oscs: { type: string }[] = [];
    class FakeCtx {
      currentTime = 0;
      destination = {};
      resume = vi.fn();
      createOscillator() {
        const o = { type: "", frequency: { value: 0 }, connect: () => ({ connect: () => {} }), start: vi.fn(), stop: vi.fn() };
        oscs.push(o);
        return o;
      }
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: () => ({}) };
      }
    }
    vi.stubGlobal("AudioContext", FakeCtx);
    const { playSfx } = await import("@/lib/sfx");
    playSfx("correct");
    expect(oscs).toHaveLength(2);
    playSfx("streak");
    expect(oscs).toHaveLength(5);
    playSfx("wrong");
    expect(oscs).toHaveLength(7);
    expect(oscs.slice(5).every((o) => o.type === "sawtooth")).toBe(true);
  });
});
