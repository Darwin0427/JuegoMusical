// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const deezer = vi.hoisted(() => ({ getTracks: vi.fn(), getGenres: vi.fn(), search: vi.fn() }));
vi.mock("@/lib/deezer", async (orig) => ({ ...(await orig<typeof import("@/lib/deezer")>()), ...deezer }));

import { GET as genres } from "@/app/api/deezer/genres/route";
import { GET as searchRoute } from "@/app/api/deezer/search/route";
import { POST as start } from "@/app/api/game/start/route";

const tracks = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  title: `Canción ${i + 1}`,
  preview: `https://cdn/${i + 1}.mp3`,
  link: `https://deezer.com/track/${i + 1}`,
  artist: { id: i, name: `Artista ${(i % 6) + 1}` },
  album: { cover_medium: "m", cover_big: "b" },
}));

const post = (body: unknown) =>
  start(new Request("http://x/api/game/start", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  deezer.getTracks.mockReset().mockResolvedValue(tracks);
});

describe("GET /api/deezer/genres", () => {
  it("devuelve los géneros", async () => {
    deezer.getGenres.mockResolvedValue([{ id: "116", name: "Rap", picture: "p" }]);
    const r = await genres();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ data: [{ id: "116", name: "Rap", picture: "p" }] });
  });
  it("si Deezer falla responde 502 con el mensaje", async () => {
    deezer.getGenres.mockRejectedValue(new Error("Deezer respondió 503"));
    const r = await genres();
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/503/);
  });
});

describe("GET /api/deezer/search", () => {
  const req = (qs: string) => searchRoute(new NextRequest(`http://x/api/deezer/search?${qs}`));

  it.each(["type=user&q=a", "type=artist&q=", "type=artist&q=%20%20", "q=karol"])("rechaza parámetros no válidos: %s", async (qs) => {
    expect((await req(qs)).status).toBe(400);
  });

  it("busca artistas, playlists y canciones (8 sugerencias para el buscador)", async () => {
    deezer.search.mockResolvedValue([{ id: "1", name: "x", picture: "" }]);
    expect((await req("type=artist&q=karol")).status).toBe(200);
    expect(deezer.search).toHaveBeenLastCalledWith("artist", "karol", 12);
    await req("type=playlist&q=salsa");
    expect(deezer.search).toHaveBeenLastCalledWith("playlist", "salsa", 12);
    await req("type=track&q=cara");
    expect(deezer.search).toHaveBeenLastCalledWith("track", "cara", 8);
  });

  it("recorta búsquedas larguísimas a 80 caracteres", async () => {
    deezer.search.mockResolvedValue([]);
    await req(`type=track&q=${"a".repeat(500)}`);
    expect(deezer.search.mock.lastCall?.[1]).toHaveLength(80);
  });

  it("si Deezer falla responde 502", async () => {
    deezer.search.mockRejectedValue(new Error("caído"));
    expect((await req("type=track&q=x")).status).toBe(502);
  });
});

describe("POST /api/game/start", () => {
  const base = { token: "tok", source_type: "genre", source_id: "116", source_label: "Rap" };

  it("rechaza JSON roto y datos incompletos", async () => {
    expect((await post("{roto")).status).toBe(400);
    expect((await post({ ...base, token: undefined })).status).toBe(400);
    expect((await post({ ...base, source_id: "" })).status).toBe(400);
    expect((await post({ ...base, source_type: "user" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("no deja adivinar el artista si la música es de un solo artista", async () => {
    const r = await post({ ...base, source_type: "artist", target: "artist" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/un solo artista/);
  });

  it("arma las rondas y llama start_game con el modo por defecto (canción, opciones)", async () => {
    const r = await post({ ...base, rounds: 5, seconds: 15 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, rounds: 5 });
    expect(deezer.getTracks).toHaveBeenCalledWith("genre", "116");
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("start_game");
    expect(args).toMatchObject({ p_token: "tok", p_source_type: "genre", p_source_label: "Rap", p_round_seconds: 15, p_answer_mode: "choice", p_target: "song" });
    expect(args.p_rounds).toHaveLength(5);
    expect(args.p_rounds[0].options).toHaveLength(4);
  });

  it("modo escribir + artista: sin opciones y siempre desde el inicio", async () => {
    await post({ ...base, rounds: 3, seconds: 10, target: "artist", answer_mode: "typed", random_start: true });
    const args = rpc.mock.calls[0][1];
    expect(args).toMatchObject({ p_answer_mode: "typed", p_target: "artist" });
    expect(args.p_rounds.every((r: { options: unknown[]; correct_index: number }) => r.options.length === 0 && r.correct_index === -1)).toBe(true);
    expect(args.p_rounds.every((r: { start_offset: number }) => r.start_offset === 0)).toBe(true); // random_start ya no existe: se ignora
  });

  it("limita rondas (3-20) y segundos (10-30), y valores raros vuelven al defecto", async () => {
    await post({ ...base, rounds: 999, seconds: 999 });
    expect(rpc.mock.calls[0][1].p_rounds).toHaveLength(12); // solo hay 12 canciones
    expect(rpc.mock.calls[0][1].p_round_seconds).toBe(30);
    await post({ ...base, rounds: 1, seconds: 1 });
    expect(rpc.mock.calls[1][1].p_rounds).toHaveLength(3);
    expect(rpc.mock.calls[1][1].p_round_seconds).toBe(10);
    await post({ ...base, rounds: "abc", seconds: null, target: "zzz", answer_mode: "zzz" });
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_round_seconds: 20, p_target: "song", p_answer_mode: "choice" });
    expect(rpc.mock.calls[2][1].p_rounds).toHaveLength(10);
  });

  it("recorta el nombre de la fuente a 80 caracteres", async () => {
    await post({ ...base, source_label: "x".repeat(200) });
    expect(rpc.mock.calls[0][1].p_source_label).toHaveLength(80);
  });

  it("errores de la base (p.ej. no eres anfitrión) → 400 con el mensaje", async () => {
    rpc.mockResolvedValue({ error: { message: "Solo el anfitrión puede iniciar" } });
    const r = await post(base);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Solo el anfitrión puede iniciar");
  });

  it("errores de Deezer o música insuficiente → 502 con mensaje claro", async () => {
    deezer.getTracks.mockResolvedValue(tracks.slice(0, 2));
    const r = await post(base);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/muy pocas canciones/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
