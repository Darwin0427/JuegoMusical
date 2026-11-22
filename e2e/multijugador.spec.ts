import { expect, test } from "@playwright/test";
import { audioState, createRoom, joinWithCode, joinWithLink, newPlayer, rest, roundNumber, setupGame, type Player } from "./helpers";

test.describe("Multijugador de punta a punta", () => {
  let players: Player[] = [];
  test.afterEach(async () => {
    for (const p of players) await p.ctx.close();
    players = [];
  });

  test("3 jugadores en navegadores distintos juegan una partida completa con opciones", async ({ browser }) => {
    const host = await newPlayer(browser, "Darwin");
    const ana = await newPlayer(browser, "Ana");
    const sebas = await newPlayer(browser, "Sebas");
    players = [host, ana, sebas];

    // Entrar: con código y con el enlace (lo mismo que hace el QR)
    const code = await createRoom(host);
    await joinWithCode(ana, code);
    await joinWithLink(sebas, code);
    for (const p of players) await expect(p.page.getByRole("heading", { name: /Jugadores 3\/12/ })).toBeVisible();
    await expect(ana.page.getByText("Darwin está eligiendo la música")).toBeVisible();
    await expect(host.page.getByAltText(`Código QR para entrar a la sala ${code}`)).toBeVisible();

    // El anfitrión elige una categoría (búsqueda real en Deezer) y arranca
    await setupGame(host.page, { categoria: "Reguetón", rondas: "5", segundos: "10" });

    // La sala y las rondas quedan en la base; los fragmentos de Deezer son válidos y frescos
    await expect(host.page.locator("button.buzzer").first()).toBeVisible({ timeout: 30_000 }); // el servidor ya armó la partida
    const room = (await rest(`rooms?code=eq.${code}&select=id,status,total_rounds`)).body as { id: string; status: string; total_rounds: number }[];
    expect(room[0]).toMatchObject({ status: "playing", total_rounds: 5 });
    const rounds = (await rest(`rounds?room_id=eq.${room[0].id}&select=preview_url,options,correct_index`)).body as { preview_url: string; options: unknown[]; correct_index: number | null }[];
    expect(rounds).toHaveLength(5);
    expect(rounds.every((r) => r.options.length === 4 && r.correct_index === null)).toBe(true); // la respuesta no se publica
    const audio = await fetch(rounds[0].preview_url);
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toMatch(/audio/);

    const answers = [
      (p: Player) => p.page.locator("button.buzzer").nth(0).click(),
      (p: Player) => p.page.keyboard.press("2"),
      (p: Player) => p.page.locator("button.buzzer").nth(2).click(),
    ];

    for (let r = 1; r <= 5; r++) {
      for (const p of players) {
        await expect.poll(() => roundNumber(p.page), { timeout: 30_000 }).toBe(r);
        await expect(p.page.locator("button.buzzer").first()).toBeEnabled({ timeout: 30_000 });
      }
      // Suena de verdad (sin errores de carga), en todos
      for (const p of players) {
        await expect.poll(async () => (await audioState(p.page))?.paused, { timeout: 10_000 }).toBe(false);
        const a = await audioState(p.page);
        expect(a?.error).toBeNull();
        expect(a?.time).toBeGreaterThan(0);
      }
      await answers[0](host);
      await answers[1](ana);
      // Sebas, que aún no responde, ve en vivo que los otros 2 ya están listos
      await expect(sebas.page.getByText("listo", { exact: true })).toHaveCount(2);
      await answers[2](sebas);
      // Todos respondieron → la ronda se cierra sola y se revela la correcta en las 3 pantallas
      for (const p of players) await expect(p.page.locator("button.buzzer.bg-ok")).toHaveCount(1, { timeout: 15_000 });
      const correct = await host.page.locator("button.buzzer.bg-ok").innerText();
      for (const p of players.slice(1)) expect(await p.page.locator("button.buzzer.bg-ok").innerText()).toBe(correct);
    }

    // Resultados: los 3 ven el mismo ganador, podio y canciones
    for (const p of players) await expect(p.page.getByRole("heading", { level: 1 })).toHaveText(/¡Ganaste!|Ganó/, { timeout: 30_000 });
    const winners = await Promise.all(players.map((p) => p.page.getByRole("heading", { level: 1 }).innerText()));
    expect(winners.filter((w) => w === "¡Ganaste!")).toHaveLength(1);
    for (const p of players) {
      await expect(p.page.getByText("Las canciones que sonaron")).toBeVisible();
      await expect(p.page.getByRole("link", { name: /Escuchar en Deezer/ })).toHaveCount(5);
    }
    await expect(ana.page.getByRole("button", { name: "Jugar otra vez" })).toHaveCount(0);

    // Puntajes en la base = suma de lo ganado; nadie con más de lo posible
    const ps = (await rest(`players?room_id=eq.${room[0].id}&select=nickname,score,answered_count`)).body as { score: number; answered_count: number }[];
    expect(ps).toHaveLength(3);
    for (const p of ps) {
      expect(p.answered_count).toBe(5);
      expect(p.score).toBeLessThanOrEqual(5 * 1000 + 3 * 150);
    }

    // Jugar otra vez: todos vuelven a la sala de espera
    await host.page.getByRole("button", { name: "Jugar otra vez" }).click();
    for (const p of players.slice(1)) await expect(p.page.getByText("Darwin está eligiendo la música")).toBeVisible();
  });

  test("tiempo real: entrar y salir se ve al instante; si el anfitrión se va, otro toma el control", async ({ browser }) => {
    const host = await newPlayer(browser, "Darwin");
    const ana = await newPlayer(browser, "Ana");
    players = [host, ana];
    const code = await createRoom(host);
    await joinWithCode(ana, code);
    await expect(host.page.getByRole("heading", { name: /Jugadores 2\/12/ })).toBeVisible();
    await host.page.getByRole("button", { name: "Salir" }).click();
    await host.page.waitForURL("**/");
    await expect(ana.page.getByRole("heading", { name: "Elige la música" })).toBeVisible({ timeout: 15_000 });
    await expect(ana.page.getByRole("heading", { name: /Jugadores 1\/12/ })).toBeVisible();
  });

  test("errores al entrar: código inexistente, apodo repetido y sala que no existe", async ({ browser }) => {
    const host = await newPlayer(browser, "Darwin");
    const otro = await newPlayer(browser, "darwin");
    players = [host, otro];
    const code = await createRoom(host);

    await otro.page.goto("/");
    await otro.page.getByLabel("Tu apodo").fill("darwin");
    await otro.page.getByLabel("Código de sala").fill("ZZZZZ");
    await otro.page.getByRole("button", { name: "Entrar" }).first().click();
    await expect(otro.page.locator("p[role=alert]")).toHaveText(/No existe una sala con ese código/); // (Next.js tiene otro role=alert invisible)

    await otro.page.getByLabel("Código de sala").fill(code);
    await otro.page.getByRole("button", { name: "Entrar" }).first().click();
    await expect(otro.page.locator("p[role=alert]")).toHaveText(/Ya hay alguien con ese apodo/);

    await otro.page.goto("/sala/ZZZZZ");
    await expect(otro.page.getByText("No existe la sala ZZZZZ")).toBeVisible();
  });

  test("salas públicas: aparecen en el inicio y se puede entrar con un clic", async ({ browser }) => {
    const host = await newPlayer(browser, "Darwin");
    const ana = await newPlayer(browser, "Ana");
    players = [host, ana];
    const code = await createRoom(host, { publica: true });
    await ana.page.goto("/");
    await expect(ana.page.getByText(code)).toBeVisible();
    await ana.page.getByLabel("Tu apodo").fill("Ana");
    await ana.page.locator("li", { hasText: code }).getByRole("button", { name: "Entrar" }).click();
    await ana.page.waitForURL(`**/sala/${code}`);
    await expect(host.page.getByRole("heading", { name: /Jugadores 2\/12/ })).toBeVisible();
  });

  test("recargar la página en plena partida te deja en tu puesto con tus puntos", async ({ browser }) => {
    const host = await newPlayer(browser, "Darwin");
    players = [host];
    await createRoom(host);
    await setupGame(host.page, { categoria: "Salsa", rondas: "5", segundos: "10" });
    await expect(host.page.locator("button.buzzer").first()).toBeEnabled({ timeout: 30_000 });
    await host.page.locator("button.buzzer").first().click();
    await expect(host.page.locator("button.buzzer.bg-ok")).toHaveCount(1, { timeout: 15_000 });
    const before = await host.page.locator("p.display.text-5xl").innerText();
    await host.page.reload();
    await expect(host.page.locator("p.display.text-5xl")).toHaveText(before);
    await expect.poll(() => roundNumber(host.page)).toBeGreaterThanOrEqual(1);
  });
});
