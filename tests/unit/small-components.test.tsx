import { act, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import PlayerList from "@/components/PlayerList";
import SoloStats from "@/components/SoloStats";
import TimerRing from "@/components/TimerRing";
import Equalizer from "@/components/Equalizer";
import { makePlayer } from "./helpers/supabase-mock";

describe("PlayerList", () => {
  const players = [
    makePlayer({ id: "p1", nickname: "Darwin", score: 900, streak: 3, answered_round: 2 }),
    makePlayer({ id: "p2", nickname: "Ana", score: 1500, joined_at: "2026-01-01T00:00:02Z" }),
    makePlayer({ id: "p3", nickname: "Sebas", score: 900, streak: 1, joined_at: "2026-01-01T00:00:03Z" }),
  ];

  it("en la sala de espera muestra el orden de llegada, anfitrión y quién eres", () => {
    render(<PlayerList players={players} hostId="p2" meId="p1" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Darwin"), expect.stringContaining("Ana"), expect.stringContaining("Sebas")]);
    expect(within(rows[0]).getByText("tú")).toBeInTheDocument();
    expect(within(rows[1]).getByTitle("Anfitrión")).toBeInTheDocument();
    expect(screen.getByText("3/12")).toBeInTheDocument();
  });

  it("en partida ordena por puntaje (empates por llegada), muestra racha ≥2 y 'listo'", () => {
    render(<PlayerList players={players} hostId="p2" meId="p1" showScore answeredRound={2} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent?.match(/Darwin|Ana|Sebas/)?.[0])).toEqual(["Ana", "Darwin", "Sebas"]);
    expect(within(rows[1]).getByTitle("3 aciertos seguidos")).toBeInTheDocument();
    expect(within(rows[2]).queryByTitle(/aciertos seguidos/)).toBeNull(); // racha 1 no se muestra
    expect(within(rows[1]).getByText("listo")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("listo")).toBeNull();
  });

  it("anima y marca cambios de puesto (▲/▼)", async () => {
    const { rerender } = render(<PlayerList players={players} hostId="p2" meId="p1" showScore />);
    await act(async () => {
      rerender(<PlayerList players={[{ ...players[0], score: 2000 }, players[1], players[2]]} hostId="p2" meId="p1" showScore />);
    });
    expect(await screen.findByText("▲1")).toBeInTheDocument();
    expect(screen.getByText("▼1")).toBeInTheDocument();
  });
});

describe("SoloStats", () => {
  it("calcula aciertos y tiempo promedio", () => {
    render(<SoloStats me={makePlayer({ streak: 2, best_streak: 4, correct_count: 3, answered_count: 4, total_ms: 10000 })} played={5} />);
    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(screen.getByText("2,5 s")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
  it("sin respuestas el promedio es —", () => {
    render(<SoloStats me={makePlayer()} played={0} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("TimerRing", () => {
  const C = 2 * Math.PI * 88;
  const progress = (c: HTMLElement) => Number(c.querySelectorAll("circle")[2].getAttribute("stroke-dashoffset"));

  it("el anillo refleja el tiempo restante y se pone rojo al final", () => {
    const { container, rerender } = render(<TimerRing pct={1} urgent={false} spinning />);
    expect(progress(container)).toBeCloseTo(0);
    rerender(<TimerRing pct={0.25} urgent spinning />);
    expect(progress(container)).toBeCloseTo(C * 0.75);
    expect(container.querySelectorAll("circle")[2].getAttribute("stroke")).toBe("var(--color-bad)");
    expect(container.querySelector(".animate-urgent")).not.toBeNull();
  });

  it("limita valores fuera de rango y muestra la portada al revelar", () => {
    const { container } = render(<TimerRing pct={7} urgent={false} spinning={false} cover="https://img/c.jpg" />);
    expect(progress(container)).toBeCloseTo(0);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://img/c.jpg");
  });
});

describe("Equalizer", () => {
  it("dibuja 9 barras; animadas solo mientras suena", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    const ref = createRef<AnalyserNode | null>() as { current: AnalyserNode | null };
    ref.current = null;
    const { container, rerender } = render(<Equalizer analyserRef={ref} active />);
    act(() => vi.advanceTimersToNextFrame());
    const bars = container.querySelectorAll("span");
    expect(bars).toHaveLength(9);
    expect(bars[0].dataset.fallback).toBe("1");
    rerender(<Equalizer analyserRef={ref} active={false} />);
    act(() => vi.advanceTimersToNextFrame());
    expect(bars[0].dataset.fallback).toBe("0");
    expect(bars[0].style.transform).toBe("scaleY(0.12)");
  });
});
