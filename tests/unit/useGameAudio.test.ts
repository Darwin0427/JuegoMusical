import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameAudio } from "@/components/useGameAudio";

class FakeAudio {
  static all: FakeAudio[] = [];
  src = "";
  preload = "";
  volume = 1;
  currentTime = 0;
  paused = true;
  playImpl: () => Promise<void> = async () => {
    this.paused = false;
  };
  constructor() {
    FakeAudio.all.push(this);
  }
  load = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(() => this.playImpl());
}

beforeEach(() => {
  FakeAudio.all = [];
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => vi.unstubAllGlobals());

describe("useGameAudio", () => {
  it("carga el fragmento de la ronda y lo cambia sin crear otro elemento", () => {
    const { rerender } = renderHook(({ url }) => useGameAudio(url), { initialProps: { url: "a.mp3" } });
    expect(FakeAudio.all).toHaveLength(1);
    expect(FakeAudio.all[0].src).toBe("a.mp3");
    rerender({ url: "b.mp3" });
    expect(FakeAudio.all).toHaveLength(1);
    expect(FakeAudio.all[0].src).toBe("b.mp3");
    expect(FakeAudio.all[0].pause).toHaveBeenCalled();
    expect(FakeAudio.all[0].load).toHaveBeenCalledTimes(2);
  });

  it("al reproducir se ubica en el segundo indicado (sincronía) con el volumen guardado", async () => {
    const { result } = renderHook(() => useGameAudio("a.mp3"));
    act(() => result.current.setVolume(0.4));
    await act(async () => result.current.play(7.5));
    const a = FakeAudio.all[0];
    expect(a.currentTime).toBe(7.5);
    expect(a.volume).toBe(0.4);
    expect(a.play).toHaveBeenCalledTimes(1);
    expect(result.current.needsTap).toBe(false);
  });

  it("no se adelanta en el primer medio segundo ni pasado el segundo 29", async () => {
    const { result } = renderHook(() => useGameAudio("a.mp3"));
    await act(async () => result.current.play(0.3));
    expect(FakeAudio.all[0].currentTime).toBe(0);
    act(() => result.current.pause());
    await act(async () => result.current.play(31));
    expect(FakeAudio.all[0].currentTime).toBe(0);
  });

  it("no lanza reproducciones repetidas mientras una está pendiente", async () => {
    const { result } = renderHook(() => useGameAudio("a.mp3"));
    const a = FakeAudio.all[0];
    let resolve!: () => void;
    a.playImpl = () => new Promise<void>((r) => (resolve = r));
    act(() => {
      result.current.play(1);
      result.current.play(1.1);
      result.current.play(1.2);
    });
    expect(a.play).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });

  it("si el navegador bloquea el sonido, pide un toque (needsTap)", async () => {
    const { result } = renderHook(() => useGameAudio("a.mp3"));
    FakeAudio.all[0].playImpl = () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    await act(async () => result.current.play(2));
    expect(result.current.needsTap).toBe(true);
    FakeAudio.all[0].playImpl = async () => {};
    await act(async () => result.current.play(2));
    expect(result.current.needsTap).toBe(false);
  });

  it("otros errores de audio no muestran el botón y se registran", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useGameAudio("a.mp3"));
    FakeAudio.all[0].playImpl = () => Promise.reject(Object.assign(new Error("x"), { name: "NotSupportedError" }));
    await act(async () => result.current.play(2));
    expect(result.current.needsTap).toBe(false);
    expect(err).toHaveBeenCalled();
  });

  it("al desmontar se detiene", () => {
    const { unmount } = renderHook(() => useGameAudio("a.mp3"));
    unmount();
    expect(FakeAudio.all[0].pause).toHaveBeenCalled();
  });
});
