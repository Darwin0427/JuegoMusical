// Acceso a la API pública de Deezer (solo desde el servidor: Deezer no permite CORS).
const API = "https://api.deezer.com";

export type SourceType = "genre" | "playlist" | "artist";

export type DzTrack = {
  id: number;
  title: string;
  title_short?: string;
  preview: string;
  link: string;
  artist: { id: number; name: string };
  album?: { cover_medium?: string; cover_big?: string };
};

// revalidate = null -> sin caché (obligatorio para canciones: los enlaces de fragmentos vencen a los 15 min)
async function dz<T>(path: string, revalidate: number | null = 3600): Promise<T> {
  const res = await fetch(`${API}${path}`, revalidate === null ? { cache: "no-store" } : { next: { revalidate } });
  if (!res.ok) throw new Error(`Deezer respondió ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message ?? "Error de Deezer");
  return json as T;
}

export async function getGenres() {
  const r = await dz<{ data: { id: number; name: string; picture_medium: string }[] }>("/genre", 86400);
  return r.data
    .filter((g) => g.id !== 0)
    .map((g) => ({ id: String(g.id), name: g.name, picture: g.picture_medium }));
}

export async function search(type: "artist" | "playlist", q: string) {
  const path = `/search/${type}?q=${encodeURIComponent(q)}&limit=12`;
  if (type === "artist") {
    const r = await dz<{ data: { id: number; name: string; picture_medium: string; nb_fan: number }[] }>(path, 600);
    return r.data.map((a) => ({ id: String(a.id), name: a.name, picture: a.picture_medium, extra: `${a.nb_fan.toLocaleString("es-CO")} fans` }));
  }
  const r = await dz<{ data: { id: number; title: string; picture_medium: string; nb_tracks: number; user?: { name: string } }[] }>(path, 600);
  return r.data.map((p) => ({ id: String(p.id), name: p.title, picture: p.picture_medium, extra: `${p.nb_tracks} canciones · ${p.user?.name ?? ""}` }));
}

// Trae las canciones de la fuente. Siempre frescas: los enlaces de los fragmentos vencen a los ~15 min.
export async function getTracks(type: SourceType, id: string): Promise<DzTrack[]> {
  if (!/^\d+$/.test(id)) throw new Error("ID no válido");
  let path: string;
  if (type === "genre") path = `/chart/${id}/tracks?limit=100`;
  else if (type === "artist") path = `/artist/${id}/top?limit=100`;
  else path = `/playlist/${id}/tracks?limit=200`;
  const r = await dz<{ data: DzTrack[] }>(path, null);
  return r.data ?? [];
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\s*[\(\[].*?[\)\]]/g, "").replace(/\s+-\s+.*$/, "").trim();

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

// "ESTOY PUTIAO" -> "Estoy Putiao". Se respetan siglas cortas de una palabra (PPCP) y números romanos.
export function tidyTitle(raw: string): string {
  const t = raw.trim();
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2 || letters !== letters.toUpperCase()) return t;
  const words = t.split(/\s+/);
  if (words.length === 1 && letters.length <= 4) return t;
  return words
    .map((w) => {
      if (/^[IVX]+$/.test(w) || /^\d/.test(w)) return w;
      const lower = w.toLocaleLowerCase("es");
      const i = lower.search(/\p{L}/u);
      return i < 0 ? lower : lower.slice(0, i) + lower.charAt(i).toLocaleUpperCase("es") + lower.slice(i + 1);
    })
    .join(" ");
}

export type BuiltRound = {
  preview_url: string;
  options: { title: string; artist: string }[];
  correct_index: number;
  answer: { title: string; artist: string; cover: string; link: string };
};

// Arma las rondas: una canción correcta + 3 opciones falsas de la misma fuente.
export function buildRounds(tracks: DzTrack[], count: number): BuiltRound[] {
  const seen = new Set<string>();
  const pool = tracks.filter((t) => {
    if (!t.preview) return false;
    const k = norm(t.title_short || t.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (pool.length < 4) throw new Error("Esta fuente no tiene suficientes canciones con fragmento (mínimo 4).");

  const picked = shuffle(pool).slice(0, Math.min(count, pool.length));
  return picked.map((t) => {
    const fakes = shuffle(pool.filter((x) => x.id !== t.id)).slice(0, 3);
    const options = shuffle([t, ...fakes]);
    return {
      preview_url: t.preview,
      options: options.map((o) => ({ title: tidyTitle(o.title_short || o.title), artist: o.artist.name })),
      correct_index: options.findIndex((o) => o.id === t.id),
      answer: {
        title: tidyTitle(t.title_short || t.title),
        artist: t.artist.name,
        cover: t.album?.cover_big ?? t.album?.cover_medium ?? "",
        link: t.link,
      },
    };
  });
}

// Acepta un enlace de playlist de Deezer y devuelve su ID
export function playlistIdFromUrl(input: string): string | null {
  const m = input.match(/deezer\.com\/(?:[a-z]{2}\/)?playlist\/(\d+)/i);
  return m ? m[1] : null;
}
