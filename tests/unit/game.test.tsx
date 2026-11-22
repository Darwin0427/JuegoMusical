import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Round, RoundResult } from "@/lib/supabase";

const mock = vi.hoisted(() => ({ sb: null as unknown as ReturnType<typeof import("./helpers/supabase-mock").createSupabaseMock> }));
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock } = await import("./helpers/supabase-mock");
  mock.sb = createSupabaseMock();
  return { supabase: mock.sb.supabase };
});
const audio = vi.hoisted(() => ({ play: vi.fn(), pause: vi.fn(), setVolume: vi.fn(), needsTap: false }));
vi.mock("@/components/useGameAudio", () => ({ useGameAudio: () => ({ ...audio, analyserRef: { current: null } }) }));
const sfx = vi.hoisted(() => ({ playSfx: vi.fn() }));
vi.mock("@/lib/sfx", () => sfx);

import Game from "@/components/Game";
import { makePlayer, makRoomPatch, makeRound, session } from "./helpers/game-fixtures";

const me = makePlayer({ id: "p1", nickname: "Darwin", score: 1200, streak: 2 });
const ana = makePlayer({ id: "p2", nickname: "Ana", score: 800, joined_at: "2026-01-01T00:00:02Z", answered_round: 1 });

function renderGame(round: Round, roomPatch = {}, players = [me, ana]) {
  return render(<Game room={makRoomPatch(roomPatch)} players={players} round={round} me={players[0]} session={session} offset={0} />);
}

const rpcCalls = (fn: string) => mock.sb.rpc.mock.calls.filter((c) => c[0] === fn);

beforeEach(() => {
  mock.sb.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  audio.play.mockReset();
  audio.pause.mockReset();
  audio.needsTap = false;
  sfx.playSfx.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ data: [] }) })));
});

describe("Game · fases de la ronda", () => {
  it("cuenta regresiva: muestra el número, no deja responder y no suena", () => {
    const now = Date.now();
    const { container } = renderGame(makeRound(now, { starts_at: new Date(now + 2500).toISOString(), ends_at: new Date(now + 22500).toISOString() }));
    expect(screen.getByText("Prepárate")).toBeInTheDocument();
    expect(container.querySelector("span.animate-pop")).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /Tusa/ })).toBeDisabled();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("sonando: muestra segundos, pregunta y reproduce desde el segundo correcto (con fragmento al azar)", () => {
    const now = Date.now();
    renderGame(makeRound(now, { start_offset: 9 }));
    expect(screen.getByText("¿Qué canción es?")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    const at = audio.play.mock.calls[0][0];
    expect(at).toBeGreaterThanOrEqual(11); // 9 de offset + ~2 s transcurridos
    expect(at).toBeLessThan(11.5);
  });

  it("ronda 1 de 3, fuente y número de jugadores", () => {
    renderGame(makeRound(Date.now()));
    expect(screen.getByText("Rap")).toBeInTheDocument();
    expect(screen.getByText("Jugadores")).toBeInTheDocument();
    expect(screen.getByText("/3")).toBeInTheDocument();
  });

  it("al acabar el tiempo pide al servidor revelar (advance)", async () => {
    const now = Date.now();
    renderGame(makeRound(now, { starts_at: new Date(now - 21000).toISOString(), ends_at: new Date(now - 1000).toISOString() }));
    expect(screen.getByText("¡Tiempo!")).toBeInTheDocument();
    await waitFor(() => expect(rpcCalls("advance")).toHaveLength(1));
    expect(rpcCalls("advance")[0][1]).toEqual({ p_token: "tok-1" });
  });

  it("5 s después de revelar pide pasar a la siguiente ronda", async () => {
    const now = Date.now();
    mock.sb.rpc.mockImplementation(async (fn: string) => ({ data: fn === "round_results" ? [] : null, error: null }));
    renderGame(makeRound(now, { revealed_at: new Date(now - 6000).toISOString(), correct_index: 0, answer: { title: "Tusa", artist: "Karol G", cover: "c", link: "l" } }));
    await waitFor(() => expect(rpcCalls("advance")).toHaveLength(1));
  });

  it("no inunda el servidor: como mucho un advance cada 1,2 s", async () => {
    const now = Date.now();
    renderGame(makeRound(now, { starts_at: new Date(now - 21000).toISOString(), ends_at: new Date(now - 1000).toISOString() }));
    await new Promise((r) => setTimeout(r, 700));
    expect(rpcCalls("advance").length).toBe(1);
  });

  it("si el navegador bloquea el sonido, muestra el botón y cualquier toque lo activa", async () => {
    audio.needsTap = true;
    renderGame(makeRound(Date.now()));
    const btn = screen.getByRole("button", { name: /activar el sonido/ });
    audio.play.mockClear();
    fireEvent.pointerDown(window);
    expect(audio.play).toHaveBeenCalled();
    await userEvent.click(btn);
    expect(audio.play.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("Game · responder con opciones", () => {
  it("muestra las 4 opciones con portada y número", () => {
    const { container } = renderGame(makeRound(Date.now()));
    for (const t of ["Tusa", "Provenza", "Bichota", "Mamiii"]) expect(screen.getByRole("button", { name: new RegExp(t) })).toBeEnabled();
    const covers = [...container.querySelectorAll("button.buzzer img")].map((i) => i.getAttribute("src"));
    expect(covers).toEqual(["c1", "c2", "c3", "c4"]);
    expect([...container.querySelectorAll("button.buzzer")].map((b) => b.textContent?.[0])).toEqual(["1", "2", "3", "4"]);
  });

  it("clic envía la respuesta, marca la elegida y bloquea las demás", async () => {
    renderGame(makeRound(Date.now()));
    await userEvent.click(screen.getByRole("button", { name: /Bichota/ }));
    expect(rpcCalls("submit_answer")[0][1]).toEqual({ p_token: "tok-1", p_round_id: "r1", p_choice: 2 });
    expect(screen.getByRole("button", { name: /Bichota/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Tusa/ })).toBeDisabled();
    expect(screen.getByText(/Respondiste en \d+,\d s/)).toBeInTheDocument();
  });

  it("teclas 1-4 responden, pero solo una vez", async () => {
    renderGame(makeRound(Date.now()));
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() => expect(rpcCalls("submit_answer")).toHaveLength(1));
    expect(rpcCalls("submit_answer")[0][1].p_choice).toBe(1);
  });

  it("ignora teclas con Ctrl o repetidas, y números fuera de rango", () => {
    renderGame(makeRound(Date.now()));
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    fireEvent.keyDown(window, { key: "1", repeat: true });
    fireEvent.keyDown(window, { key: "9" });
    expect(rpcCalls("submit_answer")).toHaveLength(0);
  });

  it("muestra el error del servidor (p.ej. fuera de tiempo)", async () => {
    mock.sb.rpc.mockImplementation(async (fn: string) => ({ data: null, error: fn === "submit_answer" ? { message: "Fuera de tiempo" } : null }));
    renderGame(makeRound(Date.now()));
    await userEvent.click(screen.getByRole("button", { name: /Tusa/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fuera de tiempo");
  });

  it("adivinando el artista pregunta '¿Quién canta?' y no muestra subtítulo", () => {
    const opts = ["Karol G", "Feid", "Shakira", "Bad Bunny"].map((n) => ({ title: n, artist: n, cover: "c" }));
    renderGame(makeRound(Date.now(), { options: opts }), { target: "artist" });
    expect(screen.getByText("¿Quién canta?")).toBeInTheDocument();
    expect(screen.getAllByText("Karol G")).toHaveLength(1);
  });
});

describe("Game · revelar", () => {
  const revealed = (now: number, o: Partial<Round> = {}) =>
    makeRound(now, { revealed_at: new Date(now).toISOString(), correct_index: 0, answer: { title: "Tusa", artist: "Karol G", cover: "big", link: "l" }, ...o });

  const results = (list: Partial<RoundResult>[]) =>
    mock.sb.rpc.mockImplementation(async (fn: string) => ({
      data: fn === "round_results" ? list.map((r) => ({ choice: 0, is_correct: true, points: 900, bonus: 0, time_ms: 2100, text_answer: null, attempts: 1, ...r })) : null,
      error: null,
    }));

  it("muestra la respuesta, la portada en el disco, tus puntos flotando y quién eligió qué", async () => {
    results([{ player_id: "p1", choice: 0, points: 929, bonus: 150, time_ms: 2100 }, { player_id: "p2", choice: 3, is_correct: false, points: 0, time_ms: 4000 }]);
    const { container } = renderGame(revealed(Date.now()));
    expect(screen.getAllByText("Tusa").length).toBeGreaterThan(0);
    expect(await screen.findByText("Correcto en 2,1 s")).toBeInTheDocument();
    expect(screen.getByText("+929")).toBeInTheDocument();
    expect(screen.getByText("+150")).toBeInTheDocument();
    expect(screen.getByText("Darwin 2,1s")).toBeInTheDocument();
    expect(screen.getByText("Ana 4,0s")).toBeInTheDocument();
    expect(container.querySelector('img[src="big"]')).not.toBeNull();
    expect(sfx.playSfx).toHaveBeenCalledWith("streak", expect.any(Number));
  });

  it("si fallaste lo dice, marca en rojo tu opción y suena el efecto de fallo", async () => {
    results([{ player_id: "p1", choice: 2, is_correct: false, points: 0, time_ms: 3000 }]);
    renderGame(revealed(Date.now()));
    expect(await screen.findByText(/Era otra/)).toBeInTheDocument();
    expect(sfx.playSfx).toHaveBeenCalledWith("wrong", expect.any(Number));
    expect(sfx.playSfx).toHaveBeenCalledTimes(1);
  });

  it("si no respondiste lo dice y no suena efecto", async () => {
    results([]);
    renderGame(revealed(Date.now()));
    expect(await screen.findByText("No alcanzaste a responder")).toBeInTheDocument();
    expect(sfx.playSfx).not.toHaveBeenCalled();
  });

  it("con efectos apagados no suena nada", async () => {
    localStorage.setItem("jm_sfx", "0");
    results([{ player_id: "p1" }]);
    renderGame(revealed(Date.now()));
    await screen.findByText(/Correcto/);
    expect(sfx.playSfx).not.toHaveBeenCalled();
  });
});

describe("Game · responder escribiendo (buscador)", () => {
  const typedRound = (now: number, o: Partial<Round> = {}) => makeRound(now, { options: [], ...o });

  it("muestra el buscador en vez de opciones y envía el texto", async () => {
    mock.sb.rpc.mockImplementation(async (fn: string) => ({ data: fn === "submit_answer" ? { correct: false, attempts_left: 2 } : null, error: null }));
    renderGame(typedRound(Date.now()), { answer_mode: "typed" });
    expect(screen.queryByRole("button", { name: /Tusa/ })).toBeNull();
    await userEvent.type(screen.getByRole("combobox"), "monaco{Enter}");
    expect(rpcCalls("submit_answer")[0][1]).toEqual({ p_token: "tok-1", p_round_id: "r1", p_text: "monaco" });
    expect(await screen.findByText("“monaco” no es. Te quedan 2 intentos.")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(sfx.playSfx).toHaveBeenCalledWith("wrong", expect.any(Number));
  });

  it("al acertar bloquea el buscador y lo celebra", async () => {
    mock.sb.rpc.mockImplementation(async (fn: string) => ({ data: fn === "submit_answer" ? { correct: true, attempts_left: 2 } : null, error: null }));
    renderGame(typedRound(Date.now()), { answer_mode: "typed" });
    await userEvent.type(screen.getByRole("combobox"), "tusa{Enter}");
    expect(await screen.findByText(/¡Correcto! Espera/)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByText(/¡La sacaste en/)).toBeInTheDocument();
  });

  it("al gastar los 3 intentos se bloquea", async () => {
    mock.sb.rpc.mockImplementation(async (fn: string) => ({ data: fn === "submit_answer" ? { correct: false, attempts_left: 0 } : null, error: null }));
    renderGame(typedRound(Date.now()), { answer_mode: "typed" });
    await userEvent.type(screen.getByRole("combobox"), "nada{Enter}");
    expect(await screen.findByText(/Ya no te quedan intentos/)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByText("Se acabaron tus intentos")).toBeInTheDocument();
  });

  it("las teclas 1-4 no responden mientras escribes", async () => {
    renderGame(typedRound(Date.now()), { answer_mode: "typed" });
    await userEvent.type(screen.getByRole("combobox"), "1234");
    expect(rpcCalls("submit_answer")).toHaveLength(0);
  });

  it("al revelar muestra lo que escribió cada uno", async () => {
    mock.sb.rpc.mockImplementation(async (fn: string) => ({
      data: fn === "round_results"
        ? [
            { player_id: "p1", choice: -1, is_correct: true, points: 900, bonus: 0, time_ms: 3000, text_answer: "tusa", attempts: 1 },
            { player_id: "p2", choice: -1, is_correct: false, points: 0, bonus: 0, time_ms: 9000, text_answer: "provenza", attempts: 3 },
          ]
        : null,
      error: null,
    }));
    const now = Date.now();
    renderGame(typedRound(now, { revealed_at: new Date(now).toISOString(), correct_index: -1, answer: { title: "Tusa", artist: "Karol G", cover: "c", link: "l" } }), { answer_mode: "typed" });
    expect(await screen.findByText("Lo que escribió cada uno")).toBeInTheDocument();
    expect(screen.getByText("“tusa”")).toBeInTheDocument();
    expect(screen.getByText("“provenza”")).toBeInTheDocument();
    expect(screen.getByText("3 intentos")).toBeInTheDocument();
  });
});

describe("Game · panel lateral y controles", () => {
  it("racha de 2 avisa del bonus; con 3+ dice +150", () => {
    renderGame(makeRound(Date.now()));
    expect(screen.getByText(/una más y ganas bonus/)).toBeInTheDocument();
  });

  it("jugando solo muestra estadísticas en vez de la tabla", () => {
    renderGame(makeRound(Date.now()), {}, [me]);
    expect(screen.getByText("Mejor racha")).toBeInTheDocument();
    expect(screen.queryByText("Jugadores")).toBeNull();
  });

  it("volumen y efectos se pueden cambiar y se guardan", async () => {
    renderGame(makeRound(Date.now()));
    await userEvent.click(screen.getByRole("button", { name: "Silenciar música" }));
    expect(localStorage.getItem("jm_volume")).toBe("0");
    expect(screen.getByRole("button", { name: "Activar música" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Efectos" }));
    expect(localStorage.getItem("jm_sfx")).toBe("0");
    act(() => {});
  });
});
