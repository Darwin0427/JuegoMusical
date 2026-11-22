import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ sb: null as unknown as ReturnType<typeof import("./helpers/supabase-mock").createSupabaseMock> }));
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock } = await import("./helpers/supabase-mock");
  mock.sb = createSupabaseMock();
  return { supabase: mock.sb.supabase };
});
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async (url: string) => `data:image/png;qr=${encodeURIComponent(url)}`) } }));

import Lobby from "@/components/Lobby";
import Results from "@/components/Results";
import { makePlayer, makeRoom, session } from "./helpers/supabase-mock";

const players = [makePlayer({ id: "p1", nickname: "Darwin" }), makePlayer({ id: "p2", nickname: "Ana", joined_at: "2026-01-01T00:00:02Z" })];

// Simula Deezer y la ruta de inicio
type Handler = (url: string, init?: RequestInit) => unknown;
let routes: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mock.sb.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mock.sb.tables.rounds = [];
  routes = {
    "/api/deezer/genres": () => ({ data: [{ id: "116", name: "Rap", picture: "g" }, { id: "197", name: "Latino", picture: "g2" }] }),
    "/api/deezer/search": (url) =>
      url.includes("type=artist")
        ? { data: [{ id: "5", name: "Karol G", picture: "a", extra: "3 fans" }] }
        : { data: [{ id: "77", name: "Reggaeton Hits", picture: "p", extra: "100 canciones · x" }] },
    "/api/game/start": () => ({ ok: true }),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k))!;
    const body = routes[key](url, init) as { error?: string };
    return { ok: !body.error, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const startBody = () => JSON.parse(fetchMock.mock.calls.find((c) => c[0] === "/api/game/start")![1].body);

describe("Lobby · invitado", () => {
  it("ve quién elige la música, el código, el QR y la lista de jugadores", async () => {
    render(<Lobby room={makeRoom()} players={players} session={{ ...session, player_id: "p2" }} isHost={false} />);
    expect(screen.getByText("Darwin está eligiendo la música")).toBeInTheDocument();
    expect(screen.getAllByText("ABCDE").length).toBeGreaterThan(0);
    const qr = await screen.findByAltText("Código QR para entrar a la sala ABCDE");
    expect(qr.getAttribute("src")).toContain(encodeURIComponent(`${location.origin}/sala/ABCDE`));
    expect(screen.queryByRole("button", { name: /Empezar/ })).toBeNull();
  });

  it("copia el enlace de invitación", async () => {
    const write = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(<Lobby room={makeRoom()} players={players} session={session} isHost={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar enlace de invitación" }));
    expect(write).toHaveBeenCalledWith(`${location.origin}/sala/ABCDE`);
    expect(await screen.findByText("Enlace copiado")).toBeInTheDocument();
  });
});

describe("Lobby · anfitrión", () => {
  const renderHost = () => render(<Lobby room={makeRoom()} players={players} session={session} isHost />);

  it("no deja empezar sin elegir música", () => {
    renderHost();
    expect(screen.getByRole("button", { name: "Elige qué música suena" })).toBeDisabled();
  });

  it("por género: elige y envía la partida con las opciones por defecto", async () => {
    renderHost();
    await userEvent.click(await screen.findByRole("button", { name: /Rap/ }));
    await userEvent.click(screen.getByRole("button", { name: "Empezar con Rap" }));
    expect(startBody()).toEqual({
      token: "tok-1", source_type: "genre", source_id: "116", source_label: "Rap", rounds: 10, seconds: 20,
      target: "song", answer_mode: "choice",
    });
  });

  it("categoría lista: busca la playlist y la deja elegida", async () => {
    renderHost();
    await userEvent.click(screen.getByRole("button", { name: "Reguetón" }));
    await userEvent.click(await screen.findByRole("button", { name: "Empezar con Reguetón" }));
    expect(startBody()).toMatchObject({ source_type: "playlist", source_id: "77", source_label: "Reguetón" });
  });

  it("opciones de partida: artista + escribiendo + 5 rondas de 15 s (ya no existe la opción de fragmento)", async () => {
    renderHost();
    await userEvent.click(await screen.findByRole("button", { name: /Latino/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Artista" }));
    await userEvent.click(screen.getByRole("radio", { name: "Escribiendo" }));
    expect(screen.getByText(/tienes 3 intentos/)).toBeInTheDocument();
    expect(screen.queryByText("Fragmento")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Rondas"), "5");
    await userEvent.selectOptions(screen.getByLabelText("Segundos por ronda"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Empezar con Latino" }));
    expect(startBody()).toMatchObject({ source_id: "197", target: "artist", answer_mode: "typed", rounds: 5, seconds: 15 });
    expect(startBody()).not.toHaveProperty("random_start");
  });

  it("por artista: busca, y no permite adivinar el artista", async () => {
    renderHost();
    await userEvent.click(screen.getByRole("radio", { name: "Artista" }));
    await userEvent.click(screen.getByRole("tab", { name: /Por artista/ }));
    expect(screen.getByRole("radio", { name: "Artista" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Canción" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "Karol G" }));
    await userEvent.click(await screen.findByRole("button", { name: /3 fans/ }));
    await userEvent.click(screen.getByRole("button", { name: "Empezar con Karol G" }));
    expect(startBody()).toMatchObject({ source_type: "artist", source_id: "5", target: "song" });
  });

  it("por playlist: acepta un enlace pegado de Deezer", async () => {
    renderHost();
    await userEvent.click(screen.getByRole("tab", { name: /Por playlist/ }));
    await userEvent.type(screen.getByPlaceholderText(/pega el enlace/), "https://www.deezer.com/es/playlist/123456{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Empezar con Playlist de Deezer" }));
    expect(startBody()).toMatchObject({ source_type: "playlist", source_id: "123456" });
  });

  it("muestra el error del servidor y deja reintentar", async () => {
    routes["/api/game/start"] = () => ({ error: "Esta música tiene muy pocas canciones con fragmento disponible. Elige otra." });
    renderHost();
    await userEvent.click(await screen.findByRole("button", { name: /Rap/ }));
    await userEvent.click(screen.getByRole("button", { name: "Empezar con Rap" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/muy pocas canciones/);
    expect(screen.getByRole("button", { name: "Empezar con Rap" })).toBeEnabled();
  });

  it("si Deezer no responde los géneros, lo dice", async () => {
    routes["/api/deezer/genres"] = () => ({ error: "Deezer respondió 503" });
    renderHost();
    expect(await screen.findByText("Deezer respondió 503")).toBeInTheDocument();
  });

  it("si llegó desde una categoría del inicio (?cat=), la deja elegida y limpia la URL", async () => {
    history.replaceState(null, "", "/sala/ABCDE?cat=salsa");
    renderHost();
    expect(await screen.findByRole("button", { name: "Empezar con Salsa" })).toBeEnabled();
    expect(location.search).toBe("");
  });
});

describe("Results", () => {
  const ranking = [
    makePlayer({ id: "p1", nickname: "Darwin", score: 3610, correct_count: 4, best_streak: 3, answered_count: 5, total_ms: 14000 }),
    makePlayer({ id: "p2", nickname: "Sebas", score: 4100 }),
    makePlayer({ id: "p3", nickname: "Ana", score: 2920 }),
    makePlayer({ id: "p4", nickname: "Vale", score: 1200 }),
  ];
  const room = makeRoom({ status: "finished", total_rounds: 10, source_label: "Reguetón" });

  it("podio, ganador, tus estadísticas y el resto de la tabla", () => {
    render(<Results players={ranking} isHost session={session} room={room} />);
    expect(screen.getByRole("heading", { name: "Ganó Sebas" })).toBeInTheDocument();
    expect(screen.getByText("Darwin (tú)")).toBeInTheDocument();
    expect(screen.getByText("4/10")).toBeInTheDocument();
    expect(screen.getByText("2,8 s")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("4Vale1200");
  });

  it("si ganaste dice ¡Ganaste!; jugando solo muestra el puntaje final", () => {
    const { unmount } = render(<Results players={[{ ...ranking[0], score: 9999 }, ranking[1]]} isHost session={session} room={room} />);
    expect(screen.getByRole("heading", { name: "¡Ganaste!" })).toBeInTheDocument();
    unmount();
    render(<Results players={[ranking[0]]} isHost session={session} room={room} />);
    expect(screen.getByRole("heading", { name: "Fin de la partida" })).toBeInTheDocument();
    expect(screen.getByText("Puntaje final")).toBeInTheDocument();
  });

  it("el anfitrión puede jugar otra vez; el invitado espera", async () => {
    const { unmount } = render(<Results players={ranking} isHost session={session} room={room} />);
    await userEvent.click(screen.getByRole("button", { name: "Jugar otra vez" }));
    expect(mock.sb.rpc).toHaveBeenCalledWith("back_to_lobby", { p_token: "tok-1" });
    unmount();
    render(<Results players={ranking} isHost={false} session={session} room={room} />);
    expect(screen.queryByRole("button", { name: "Jugar otra vez" })).toBeNull();
    expect(screen.getByText(/El anfitrión decide/)).toBeInTheDocument();
  });

  it("compartir: copia un texto con puesto, puntos y enlace", async () => {
    const write = vi.fn(async () => {});
    Object.assign(navigator, { share: undefined, clipboard: { writeText: write } });
    render(<Results players={ranking} isHost session={session} room={room} />);
    await userEvent.click(screen.getByRole("button", { name: "Compartir resultado" }));
    expect(write.mock.calls[0][0]).toBe(`Quedé de 2 entre 4 con 3610 puntos en JuegoMusical (Reguetón): 4 de 10 canciones, mejor racha de 3. ¿Me ganas? ${location.origin}`);
    expect(await screen.findByText("Resultado copiado")).toBeInTheDocument();
  });

  it("compartir en celular usa el menú nativo", async () => {
    const share = vi.fn(async () => {});
    Object.assign(navigator, { share });
    render(<Results players={[ranking[0]]} isHost session={session} room={room} />);
    await userEvent.click(screen.getByRole("button", { name: "Compartir resultado" }));
    expect(share.mock.calls[0][0]).toMatchObject({ title: "JuegoMusical", url: location.origin, text: expect.stringMatching(/^Hice 3610 puntos/) });
    Object.assign(navigator, { share: undefined });
  });

  it("lista las canciones que sonaron con enlace a Deezer en pestaña nueva", async () => {
    mock.sb.tables.rounds = [
      { room_id: "room1", round_number: 2, answer: { title: "Provenza", artist: "Karol G", cover: "c2", link: "https://deezer.com/track/2" } },
      { room_id: "room1", round_number: 1, answer: { title: "Tusa", artist: "Karol G", cover: "c1", link: "https://deezer.com/track/1" } },
      { room_id: "otra", round_number: 1, answer: { title: "Ajena", artist: "X", cover: "", link: "x" } },
    ];
    render(<Results players={ranking} isHost session={session} room={room} />);
    await screen.findByText("Las canciones que sonaron");
    const links = screen.getAllByRole("link", { name: /Escuchar en Deezer/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://deezer.com/track/1", "https://deezer.com/track/2"]);
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText("Ajena")).toBeNull();
    await waitFor(() => {});
  });
});
