// Categorías listas para jugar con un toque. Se resuelven buscando la playlist más relevante en Deezer.
export type Category = { slug: string; label: string; query: string; color: string };

export const CATEGORIES: Category[] = [
  { slug: "reggaeton", label: "Reguetón", query: "Reggaeton hits", color: "bg-pink" },
  { slug: "top-colombia", label: "Top Colombia", query: "Top Colombia", color: "bg-sun" },
  { slug: "rock-espanol", label: "Rock en español", query: "Rock en español", color: "bg-cyan" },
  { slug: "2000s", label: "Éxitos de los 2000", query: "Éxitos 2000", color: "bg-tangerine" },
  { slug: "90s", label: "Clásicos de los 90", query: "90s hits", color: "bg-cyan" },
  { slug: "salsa", label: "Salsa", query: "Salsa clásica", color: "bg-tangerine" },
  { slug: "vallenato", label: "Vallenato", query: "Vallenato clásico", color: "bg-sun" },
  { slug: "pop-ingles", label: "Pop en inglés", query: "Pop hits", color: "bg-pink" },
];

export const findCategory = (slug: string | null) => CATEGORIES.find((c) => c.slug === slug) ?? null;

// Busca la playlist de la categoría y devuelve la primera con suficientes canciones
export async function resolveCategory(c: Category): Promise<{ id: string; name: string; picture: string } | null> {
  const r = await fetch(`/api/deezer/search?type=playlist&q=${encodeURIComponent(c.query)}`);
  const j = await r.json();
  const list: { id: string; name: string; picture: string; extra?: string }[] = j.data ?? [];
  const good = list.find((p) => Number((p.extra ?? "").split(" ")[0]) >= 20) ?? list[0];
  return good ? { id: good.id, name: c.label, picture: good.picture } : null;
}
