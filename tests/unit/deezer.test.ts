import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRounds, getGenres, getTracks, playlistIdFromUrl, search, tidyTitle, type DzTrack, type RoundConfig } from "@/lib/deezer";

const track = (id: number, title: string, artist: string, extra: Partial<DzTrack> = {}): DzTrack => ({
  id,
  title,
  preview: `https://cdn/${id}.mp3`,
  link: `https://deezer.com/track/${id}`,
  artist: { id: id * 10, name: artist },
  album: { cover_medium: `https://img/${id}-m.jpg`, cover_big: `https://img/${id}-b.jpg` },
  ...extra,
});

// 12 canciones de 6 artistas
const POOL: DzTrack[] = Array.from({ length: 12 }, (_, i) => track(i + 1, `Canción ${i + 1}`, `Artista ${(i % 6) + 1}`));
const cfg = (c: Partial<RoundConfig> = {}): RoundConfig => ({ count: 10, target: "song", answerMode: "choice", ...c });

describe("tidyTitle", () => {
  it.each([
    ["ESTOY PUTIAO", "Estoy Putiao"],
    ["GATITAS SANDUNGUERAS", "Gatitas Sandungueras"],
    ["MONSTRUO", "Monstruo"],
    ["FERXXO 151", "Ferxxo 151"],
    ["¿QUÉ ME PASA?", "¿Qué Me Pasa?"],
    ["ROCKY II", "Rocky II"],
  ])("normaliza títulos en mayúsculas: %s", (input, out) => {
    expect(tidyTitle(input)).toBe(out);
  });

  it.each(["PPCP", "Dorado", "Te Entiendo", "Bebé Que Bien Te Ves", "A", "  Tusa  "])("respeta lo que no está todo en mayúsculas o siglas cortas: %s", (t) => {
    expect(tidyTitle(t)).toBe(t.trim());
  });
});

describe("playlistIdFromUrl", () => {
  it("extrae el ID de enlaces de Deezer con o sin idioma", () => {
    expect(playlistIdFromUrl("https://www.deezer.com/es/playlist/1234567")).toBe("1234567");
    expect(playlistIdFromUrl("https://deezer.com/playlist/99?utm=x")).toBe("99");
  });
  it("devuelve null si no es un enlace de playlist", () => {
    expect(playlistIdFromUrl("https://deezer.com/album/5")).toBeNull();
    expect(playlistIdFromUrl("reggaeton")).toBeNull();
  });
});

describe("buildRounds · adivinar la canción con opciones", () => {
  const rounds = buildRounds(POOL, cfg({ count: 5 }));

  it("arma la cantidad pedida", () => expect(rounds).toHaveLength(5));

  it("cada ronda trae 4 opciones distintas e incluye la correcta", () => {
    for (const r of rounds) {
      expect(r.options).toHaveLength(4);
      expect(new Set(r.options.map((o) => o.title)).size).toBe(4);
      expect(r.correct_index).toBeGreaterThanOrEqual(0);
      expect(r.options[r.correct_index].title).toBe(r.answer.title);
      expect(r.options[r.correct_index].artist).toBe(r.answer.artist);
    }
  });

  it("no repite canciones entre rondas", () => {
    expect(new Set(rounds.map((r) => r.preview_url)).size).toBe(rounds.length);
  });

  it("incluye portada en opciones y respuesta, y el enlace de Deezer", () => {
    for (const r of rounds) {
      expect(r.options.every((o) => o.cover.startsWith("https://img/"))).toBe(true);
      expect(r.answer.cover).toMatch(/-b\.jpg$/);
      expect(r.answer.link).toMatch(/^https:\/\/deezer\.com\/track\//);
    }
  });

  it("no pide más rondas de las canciones disponibles", () => {
    expect(buildRounds(POOL.slice(0, 6), cfg({ count: 20 }))).toHaveLength(6);
  });

  it("aplica tidyTitle a los títulos", () => {
    const r = buildRounds([track(1, "ESTOY PUTIAO", "Feid"), ...POOL.slice(0, 4)], cfg({ count: 5 }));
    const all = r.flatMap((x) => x.options.map((o) => o.title));
    expect(all).toContain("Estoy Putiao");
    expect(all).not.toContain("ESTOY PUTIAO");
  });
});

describe("buildRounds · filtros del catálogo", () => {
  it("descarta canciones sin fragmento y duplicadas (mismo título y artista)", () => {
    const pool = [
      track(1, "Tusa", "Karol G"),
      track(2, "Tusa (Remix)", "Karol G"), // mismo título normalizado
      track(3, "Sin audio", "X", { preview: "" }),
      track(4, "Provenza", "Karol G"),
      track(5, "Bichota", "Karol G"),
      track(6, "Mamiii", "Becky G"),
    ];
    const r = buildRounds(pool, cfg({ count: 10 }));
    expect(r).toHaveLength(4);
    expect(r.map((x) => x.answer.title)).not.toContain("Sin audio");
  });

  it("falla con mensaje claro si hay menos de 4 canciones utilizables", () => {
    expect(() => buildRounds(POOL.slice(0, 3), cfg())).toThrow(/muy pocas canciones/);
  });
});

describe("buildRounds · adivinar el artista", () => {
  it("las 4 opciones son artistas distintos y muestran el nombre del artista", () => {
    const r = buildRounds(POOL, cfg({ target: "artist", count: 6 }));
    for (const x of r) {
      const names = x.options.map((o) => o.title);
      expect(new Set(names).size).toBe(4);
      expect(x.options.every((o) => o.title === o.artist)).toBe(true);
      expect(names[x.correct_index]).toBe(x.answer.artist);
    }
  });

  it("reparte artistas: las primeras rondas son de artistas distintos", () => {
    const r = buildRounds(POOL, cfg({ target: "artist", count: 6 }));
    expect(new Set(r.map((x) => x.answer.artist)).size).toBe(6);
  });

  it("falla si no hay 4 artistas distintos", () => {
    const pool = [1, 2, 3, 4, 5].map((i) => track(i, `T${i}`, i < 4 ? "Feid" : "Karol G"));
    expect(() => buildRounds(pool, cfg({ target: "artist" }))).toThrow(/4 artistas distintos/);
  });

  it("escribiendo el artista no exige 4 artistas", () => {
    const pool = [1, 2, 3, 4].map((i) => track(i, `T${i}`, "Feid"));
    expect(() => buildRounds(pool, cfg({ target: "artist", answerMode: "typed" }))).not.toThrow();
  });
});

describe("buildRounds · responder escribiendo", () => {
  it("no envía opciones y marca la respuesta como -1", () => {
    const r = buildRounds(POOL, cfg({ answerMode: "typed", count: 3 }));
    for (const x of r) {
      expect(x.options).toEqual([]);
      expect(x.correct_index).toBe(-1);
      expect(x.answer.title).toBeTruthy();
    }
  });
});

describe("buildRounds · fragmento", () => {
  it("siempre empieza desde el inicio del fragmento", () => {
    for (let i = 0; i < 20; i++) expect(buildRounds(POOL, cfg({ count: 12 })).every((r) => r.start_offset === 0)).toBe(true);
  });
});

describe("Deezer API (fetch simulado)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const mockFetch = (body: unknown, ok = true, status = 200) => {
    const f = vi.fn().mockResolvedValue({ ok, status, json: async () => body });
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("getTracks pide la ruta correcta por tipo y SIN caché (los enlaces vencen)", async () => {
    const f = mockFetch({ data: [track(1, "A", "B")] });
    await getTracks("genre", "116");
    await getTracks("artist", "27");
    await getTracks("playlist", "555");
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      "https://api.deezer.com/chart/116/tracks?limit=100",
      "https://api.deezer.com/artist/27/top?limit=100",
      "https://api.deezer.com/playlist/555/tracks?limit=200",
    ]);
    for (const c of f.mock.calls) expect(c[1]).toEqual({ cache: "no-store" });
  });

  it("getTracks rechaza IDs que no son numéricos (evita inyectar rutas)", async () => {
    mockFetch({ data: [] });
    await expect(getTracks("playlist", "1/../../user")).rejects.toThrow(/ID no válido/);
  });

  it("propaga errores de Deezer (HTTP y error en el JSON)", async () => {
    mockFetch({}, false, 503);
    await expect(getTracks("genre", "1")).rejects.toThrow(/503/);
    mockFetch({ error: { message: "Quota limit exceeded" } });
    await expect(getTracks("genre", "1")).rejects.toThrow(/Quota/);
  });

  it("getGenres quita el género 'Todos' (id 0)", async () => {
    mockFetch({ data: [{ id: 0, name: "Todos", picture_medium: "" }, { id: 116, name: "Rap", picture_medium: "p" }] });
    expect(await getGenres()).toEqual([{ id: "116", name: "Rap", picture: "p" }]);
  });

  it("search de artistas y playlists devuelve el formato de la interfaz", async () => {
    const f = mockFetch({ data: [{ id: 5, name: "Karol G", picture_medium: "p", nb_fan: 3429274 }] });
    const a = await search("artist", "karol g");
    expect(f.mock.calls[0][0]).toContain("/search/artist?q=karol%20g");
    expect(a[0]).toMatchObject({ id: "5", name: "Karol G", picture: "p" });
    expect(a[0].extra).toMatch(/fans$/);

    mockFetch({ data: [{ id: 9, title: "Vallenatos", picture_medium: "p", nb_tracks: 121, user: { name: "Ana" } }] });
    const p = await search("playlist", "vallenato");
    expect(p[0]).toEqual({ id: "9", name: "Vallenatos", picture: "p", extra: "121 canciones · Ana" });
  });
});

describe("buscador de respuestas (search track)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("devuelve título limpio, portada y artista, sin duplicados", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          track(1, "CARAMELO", "Ozuna"),
          track(2, "Caramelo", "Ozuna"), // duplicado de título+artista
          track(3, "Caramelo (Remix)", "Ozuna"),
          track(4, "Caramelito", "Rauw Alejandro"),
        ],
      }),
    });
    vi.stubGlobal("fetch", f);
    const r = await search("track", "cara", 8);
    expect(f.mock.calls[0][0]).toBe("https://api.deezer.com/search/track?q=cara&limit=8");
    expect(r.map((x) => `${x.name} · ${x.extra}`)).toEqual(["Caramelo · Ozuna", "Caramelito · Rauw Alejandro"]);
    expect(r[0].picture).toBe("https://img/1-m.jpg");
  });
});
