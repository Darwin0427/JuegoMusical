import { expect, test } from "@playwright/test";
import { createRoom, newPlayer } from "./helpers";

test("en celular: crear sala, jugar una ronda tocando y sin desbordes horizontales", async ({ browser }, info) => {
  const p = await newPlayer(browser, "Darwin", info.project.use);
  await createRoom(p);
  const noOverflow = () => p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(await noOverflow()).toBe(true);
  await p.page.getByRole("button", { name: "Reguetón", exact: true }).click();
  await p.page.getByLabel("Rondas").selectOption("5");
  await p.page.getByLabel("Segundos por ronda").selectOption("10");
  await p.page.getByRole("button", { name: /^Empezar con/ }).tap();
  const first = p.page.locator("button.buzzer").first();
  await expect(first).toBeEnabled({ timeout: 30_000 });
  expect(await noOverflow()).toBe(true);
  await first.tap();
  await expect(p.page.locator("button.buzzer.bg-ok")).toHaveCount(1, { timeout: 15_000 });
  expect(await noOverflow()).toBe(true);
  await p.ctx.close();
});
