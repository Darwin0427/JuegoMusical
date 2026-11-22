import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export type Player = { ctx: BrowserContext; page: Page; nick: string };

/** Un jugador = un navegador aparte (su propio localStorage, como otro celular) */
export async function newPlayer(browser: Browser, nick: string, options: Parameters<Browser["newContext"]>[0] = {}): Promise<Player> {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${nick}] error de página:`, e.message));
  return { ctx, page, nick };
}

export async function createRoom(p: Player, opts: { publica?: boolean } = {}) {
  await p.page.goto("/");
  await p.page.getByLabel("Tu apodo").fill(p.nick);
  if (opts.publica) await p.page.getByRole("checkbox").check();
  await p.page.getByRole("button", { name: "Crear sala" }).click();
  await p.page.waitForURL(/\/sala\/[A-Z0-9]{5}$/);
  return p.page.url().split("/").pop()!;
}

export async function joinWithCode(p: Player, code: string) {
  await p.page.goto("/");
  await p.page.getByLabel("Tu apodo").fill(p.nick);
  await p.page.getByLabel("Código de sala").fill(code);
  await p.page.getByRole("button", { name: "Entrar" }).first().click();
  await p.page.waitForURL(`**/sala/${code}`);
}

/** Entrar con el enlace o el QR: abre /sala/CODE y escribe el apodo */
export async function joinWithLink(p: Player, code: string) {
  await p.page.goto(`/sala/${code}`);
  await p.page.getByPlaceholder("Tu apodo").fill(p.nick);
  await p.page.getByRole("button", { name: "Entrar" }).click();
  await expect(p.page.getByText(/Jugadores/).first()).toBeVisible();
}

export async function setupGame(
  host: Page,
  o: { categoria?: string; genero?: boolean; adivinar?: "Canción" | "Artista"; responder?: "Opciones" | "Escribiendo"; fragmento?: "Desde el inicio" | "Parte al azar"; rondas?: string; segundos?: string },
) {
  if (o.categoria) {
    await host.getByRole("button", { name: o.categoria, exact: true }).click();
    await expect(host.getByRole("button", { name: `Empezar con ${o.categoria}` })).toBeEnabled();
  }
  if (o.adivinar) await host.getByRole("radio", { name: o.adivinar }).click();
  if (o.responder) await host.getByRole("radio", { name: o.responder }).click();
  if (o.fragmento) await host.getByRole("radio", { name: o.fragmento }).click();
  if (o.rondas) await host.getByLabel("Rondas").selectOption(o.rondas);
  if (o.segundos) await host.getByLabel("Segundos por ronda").selectOption(o.segundos);
  await host.getByRole("button", { name: /^Empezar con/ }).click();
}

export const roundNumber = async (page: Page) => Number((await page.locator("header p.display").first().innerText()).match(/Ronda\s*(\d+)/)?.[1] ?? 0);

/** Estado del audio en la página (solo compilaciones de prueba) */
export const audioState = (page: Page) =>
  page.evaluate(() => {
    const a = (window as unknown as { __jmAudio?: HTMLAudioElement }).__jmAudio;
    return a ? { paused: a.paused, time: a.currentTime, error: a.error?.code ?? null, src: a.src, volume: a.volume } : null;
  });

/** Lectura directa de la API REST de Supabase con la clave pública (como lo haría cualquiera) */
export async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await r.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: r.status, body };
}
