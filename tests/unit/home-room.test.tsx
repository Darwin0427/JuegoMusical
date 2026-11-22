import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ sb: null as unknown as ReturnType<typeof import("./helpers/supabase-mock").createSupabaseMock>, push: vi.fn() }));
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock } = await import("./helpers/supabase-mock");
  mock.sb = createSupabaseMock();
  return { supabase: mock.sb.supabase };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,x") } }));
vi.mock("@/components/useGameAudio", () => ({ useGameAudio: () => ({ play: vi.fn(), pause: vi.fn(), setVolume: vi.fn(), needsTap: false, analyserRef: { current: null } }) }));

import Home from "@/app/page";
import RoomClient from "@/components/RoomClient";
import { getSession, saveSession } from "@/lib/session";
import { makePlayer, makeRoom, makeRound } from "./helpers/supabase-mock";

const created = { room_id: "room1", code: "XYZ12", player_id: "p1", token: "tok-new" };

beforeEach(() => {
  mock.push.mockReset();
  mock.sb.rpc.mockReset().mockImplementation(async (fn: string) => {
    if (fn === "list_public_rooms") return { data: [{ code: "PUB01", host: "Ana", players: 3, created_at: "x" }], error: null };
    if (fn === "create_room" || fn === "join_room") return { data: created, error: null };
    if (fn === "server_now") return { data: new Date().toISOString(), error: null };
    return { data: null, error: null };
  });
  mock.sb.tables.rooms = [];
  mock.sb.tables.players = [];
  mock.sb.tables.rounds = [];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })));
});

const rpcCall = (fn: string) => mock.sb.rpc.mock.calls.find((c) => c[0] === fn);

describe("Inicio", () => {
  it("pide el apodo antes de crear o entrar", async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole("button", { name: "Crear sala" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe tu apodo primero");
    expect(rpcCall("create_room")).toBeUndefined();
  });

  it("crea sala (pública), guarda la sesión y el apodo, y entra", async () => {
    render(<Home />);
    await userEvent.type(screen.getByLabelText("Tu apodo"), "  Darwin ");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Crear sala" }));
    expect(rpcCall("create_room")![1]).toEqual({ p_nickname: "Darwin", p_is_public: true });
    expect(getSession("XYZ12")).toEqual(created);
    expect(localStorage.getItem("jm_nickname")).toBe("Darwin");
    expect(mock.push).toHaveBeenCalledWith("/sala/XYZ12");
  });

  it("una categoría crea la sala con esa música elegida", async () => {
    render(<Home />);
    await userEvent.type(screen.getByLabelText("Tu apodo"), "Darwin");
    await userEvent.click(screen.getByRole("button", { name: "Vallenato" }));
    expect(mock.push).toHaveBeenCalledWith("/sala/XYZ12?cat=vallenato");
  });

  it("entrar con código: valida 5 caracteres, pasa a mayúsculas y entra", async () => {
    render(<Home />);
    await userEvent.type(screen.getByLabelText("Tu apodo"), "Ana");
    const code = screen.getByLabelText("Código de sala");
    const entrar = () => screen.getAllByRole("button", { name: "Entrar" })[0]; // el del formulario (las salas públicas también tienen "Entrar")
    await userEvent.type(code, "ab1");
    await userEvent.click(entrar());
    expect(screen.getByRole("alert")).toHaveTextContent("El código tiene 5 caracteres");
    await userEvent.type(code, "2c");
    expect(code).toHaveValue("AB12C");
    await userEvent.click(entrar());
    expect(rpcCall("join_room")![1]).toEqual({ p_code: "AB12C", p_nickname: "Ana" });
  });

  it("muestra errores del servidor (sala llena, apodo repetido, código inexistente)", async () => {
    mock.sb.rpc.mockImplementation(async (fn: string) =>
      fn === "join_room" ? { data: null, error: { message: "Ya hay alguien con ese apodo en la sala" } } : { data: [], error: null },
    );
    render(<Home />);
    await userEvent.type(screen.getByLabelText("Tu apodo"), "Ana");
    await userEvent.type(screen.getByLabelText("Código de sala"), "AB12C{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya hay alguien con ese apodo");
    expect(mock.push).not.toHaveBeenCalled();
  });

  it("lista salas públicas y permite entrar a una", async () => {
    render(<Home />);
    expect(await screen.findByText("PUB01")).toBeInTheDocument();
    expect(screen.getByText("Sala de Ana, 3 jugadores")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Tu apodo"), "Sebas");
    const entrar = screen.getAllByRole("button", { name: "Entrar" });
    await userEvent.click(entrar[entrar.length - 1]);
    expect(rpcCall("join_room")![1]).toEqual({ p_code: "PUB01", p_nickname: "Sebas" });
  });

  it("sin salas públicas lo explica", async () => {
    mock.sb.rpc.mockImplementation(async () => ({ data: [], error: null }));
    render(<Home />);
    expect(await screen.findByText(/No hay salas públicas abiertas/)).toBeInTheDocument();
  });

  it("recuerda el apodo de la vez anterior", () => {
    localStorage.setItem("jm_nickname", "Darwin");
    render(<Home />);
    expect(screen.getByLabelText("Tu apodo")).toHaveValue("Darwin");
  });
});

describe("Sala (RoomClient)", () => {
  const seed = (room = makeRoom(), players = [makePlayer()], rounds: unknown[] = []) => {
    mock.sb.tables.rooms = [room as never];
    mock.sb.tables.players = players as never[];
    mock.sb.tables.rounds = rounds as never[];
  };

  it("si la sala no existe lo dice", async () => {
    render(<RoomClient code="NOPE1" />);
    expect(await screen.findByText("No existe la sala NOPE1")).toBeInTheDocument();
  });

  it("sin sesión pide apodo y al entrar se une con join_room", async () => {
    seed();
    render(<RoomClient code="ABCDE" />);
    expect(await screen.findByText("Sala ABCDE")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Tu apodo"), "Ana");
    mock.sb.tables.players.push(makePlayer({ id: "p1" }) as never);
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(rpcCall("join_room")![1]).toEqual({ p_code: "ABCDE", p_nickname: "Ana" });
  });

  it("con sesión muestra la sala de espera y se suscribe a cambios en tiempo real", async () => {
    seed();
    saveSession({ room_id: "room1", code: "ABCDE", player_id: "p1", token: "tok-1" });
    render(<RoomClient code="ABCDE" />);
    expect(await screen.findByText("Elige la música")).toBeInTheDocument();
    expect(mock.sb.supabase.channel).toHaveBeenCalledWith("sala-room1");
  });

  it("cuando el anfitrión inicia, Realtime lleva a todos a la ronda", async () => {
    seed();
    saveSession({ room_id: "room1", code: "ABCDE", player_id: "p1", token: "tok-1" });
    render(<RoomClient code="ABCDE" />);
    await screen.findByText("Elige la música");
    mock.sb.tables.rooms = [makeRoom({ status: "playing", current_round: 1 }) as never];
    mock.sb.tables.rounds = [makeRound(Date.now()) as never];
    await act(async () => mock.sb.emitChange());
    expect(await screen.findByText("¿Qué canción es?")).toBeInTheDocument();
    mock.sb.tables.rooms = [makeRoom({ status: "finished", current_round: 3 }) as never];
    await act(async () => mock.sb.emitChange());
    expect(await screen.findByRole("heading", { name: "Fin de la partida" })).toBeInTheDocument();
  });

  it("si te sacaron de la sala (ya no estás en jugadores), borra la sesión y pide apodo", async () => {
    seed(makeRoom(), [makePlayer({ id: "otro", nickname: "Ana" })]);
    saveSession({ room_id: "room1", code: "ABCDE", player_id: "p1", token: "tok-1" });
    render(<RoomClient code="ABCDE" />);
    expect(await screen.findByText("Sala ABCDE")).toBeInTheDocument();
    expect(getSession("ABCDE")).toBeNull();
  });

  it("Salir llama leave_room, borra la sesión y vuelve al inicio", async () => {
    seed();
    saveSession({ room_id: "room1", code: "ABCDE", player_id: "p1", token: "tok-1" });
    render(<RoomClient code="ABCDE" />);
    await screen.findByText("Elige la música");
    await userEvent.click(screen.getByRole("button", { name: "Salir" }));
    expect(rpcCall("leave_room")![1]).toEqual({ p_token: "tok-1" });
    expect(getSession("ABCDE")).toBeNull();
    expect(mock.push).toHaveBeenCalledWith("/");
  });

  it("sincroniza el reloj con el servidor", async () => {
    seed();
    render(<RoomClient code="ABCDE" />);
    await waitFor(() => expect(rpcCall("server_now")).toBeDefined());
  });
});
