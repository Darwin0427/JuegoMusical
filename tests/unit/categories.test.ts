import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES, findCategory, resolveCategory } from "@/lib/categories";

afterEach(() => vi.unstubAllGlobals());

const results = (list: { id: string; name: string; picture: string; extra?: string }[]) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ data: list }) }));

describe("categorías", () => {
  it("tienen slug único, nombre, búsqueda y color del tema", () => {
    expect(new Set(CATEGORIES.map((c) => c.slug)).size).toBe(CATEGORIES.length);
    for (const c of CATEGORIES) {
      expect(c.label && c.query).toBeTruthy();
      expect(c.color).toMatch(/^bg-(sun|pink|cyan|tangerine)$/);
    }
  });

  it("findCategory encuentra por slug y devuelve null si no existe", () => {
    expect(findCategory("reggaeton")?.label).toBe("Reguetón");
    expect(findCategory("no-existe")).toBeNull();
    expect(findCategory(null)).toBeNull();
  });

  it("resolveCategory elige la primera playlist con al menos 20 canciones", async () => {
    results([
      { id: "1", name: "Corta", picture: "a", extra: "8 canciones · x" },
      { id: "2", name: "Buena", picture: "b", extra: "121 canciones · y" },
    ]);
    const c = findCategory("vallenato")!;
    expect(await resolveCategory(c)).toEqual({ id: "2", name: "Vallenato", picture: "b" });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/deezer/search?type=playlist&q=${encodeURIComponent(c.query)}`);
  });

  it("si ninguna llega a 20, usa la primera; si no hay resultados, null", async () => {
    results([{ id: "1", name: "Corta", picture: "a", extra: "8 canciones" }]);
    expect((await resolveCategory(CATEGORIES[0]))?.id).toBe("1");
    results([]);
    expect(await resolveCategory(CATEGORIES[0])).toBeNull();
  });
});
