import { expect, test } from "@playwright/test";
import { audioState, createRoom, newPlayer, rest, setupGame, type Player } from "./helpers";

let players: Player[] = [];
test.afterEach(async () => {
  for (const p of players) await p.ctx.close();
  players = [];
});

test("escribiendo con buscador: sugerencias reales de Deezer, intentos y lo que escribió cada uno", async ({ browser }) => {
  const host = await newPlayer(browser, "Darwin");
  players = [host];
  await createRoom(host);
  await setupGame(host.page, { categoria: "Pop en inglés", adivinar: "Artista", responder: "Escribiendo", rondas: "5", segundos: "30" });

  const box = host.page.locator("#guess"); // (en la sala de espera también hay listas desplegables)
  await expect(box).toBeEnabled({ timeout: 30_000 });
  await expect(host.page.getByText("¿Quién canta?").first()).toBeVisible();
  await expect(host.page.locator("button.buzzer")).toHaveCount(0); // sin opciones

  await box.fill("zzqqxxj");
  await box.press("Enter");
  await expect(host.page.getByText("“zzqqxxj” no es. Te quedan 2 intentos.")).toBeVisible();

  await box.fill("taylor");
  const option = host.page.getByRole("option").first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  const picked = (await option.locator("span.font-extrabold").innerText()).trim();
  await option.click();
  await expect(host.page.getByText(/¡Correcto!|no es\. Te quedan 1 intento\./)).toBeVisible();

  await expect(host.page.getByText("Lo que escribió cada uno")).toBeVisible({ timeout: 40_000 });
  await expect(host.page.getByText(`“${picked}”`)).toBeVisible();
});

test("fragmento al azar: el audio arranca en el segundo guardado para la ronda", async ({ browser }) => {
  const host = await newPlayer(browser, "Darwin");
  players = [host];
  const code = await createRoom(host);
  await setupGame(host.page, { categoria: "Vallenato", fragmento: "Parte al azar", rondas: "5", segundos: "10" });
  await expect(host.page.locator("button.buzzer").first()).toBeEnabled({ timeout: 30_000 });
  const room = ((await rest(`rooms?code=eq.${code}&select=id`)).body as { id: string }[])[0];
  const r = ((await rest(`rounds?room_id=eq.${room.id}&round_number=eq.1&select=start_offset,starts_at`)).body as { start_offset: number; starts_at: string }[])[0];
  expect(r.start_offset).toBeGreaterThanOrEqual(0);
  expect(r.start_offset).toBeLessThanOrEqual(19);
  await expect.poll(async () => (await audioState(host.page))?.paused, { timeout: 10_000 }).toBe(false);
  const a = (await audioState(host.page))!;
  const elapsed = (Date.now() - new Date(r.starts_at).getTime()) / 1000;
  expect(Math.abs(a.time - (r.start_offset + elapsed))).toBeLessThan(3);
});

test("adivinar el artista con opciones: 4 artistas distintos", async ({ browser }) => {
  const host = await newPlayer(browser, "Darwin");
  players = [host];
  await createRoom(host);
  await setupGame(host.page, { categoria: "Top Colombia", adivinar: "Artista", rondas: "5", segundos: "10" });
  await expect(host.page.locator("button.buzzer").first()).toBeEnabled({ timeout: 30_000 });
  const names = await host.page.locator("button.buzzer span.display.text-xl").allInnerTexts();
  expect(names).toHaveLength(4);
  expect(new Set(names).size).toBe(4);
  await expect(host.page.getByText("¿Quién canta?")).toBeVisible();
});

test("volumen y efectos se guardan entre partidas", async ({ browser }) => {
  const host = await newPlayer(browser, "Darwin");
  players = [host];
  await createRoom(host);
  await setupGame(host.page, { categoria: "Salsa", rondas: "5", segundos: "10" });
  await expect(host.page.locator("button.buzzer").first()).toBeEnabled({ timeout: 30_000 });
  await host.page.getByRole("button", { name: "Silenciar música" }).click();
  await expect.poll(async () => (await audioState(host.page))?.volume).toBe(0);
  await host.page.reload();
  await expect(host.page.getByRole("button", { name: "Activar música" })).toBeVisible();
});
