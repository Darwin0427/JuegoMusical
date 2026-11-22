import { defineConfig, devices } from "@playwright/test";

// Pruebas de punta a punta: varios navegadores jugando contra Supabase local + Deezer real.
// En GitHub Actions: supabase start → build con NEXT_PUBLIC_E2E=1 → playwright test
export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "es-CO",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [
    { name: "computador", use: { ...devices["Desktop Chrome"] }, testIgnore: /celular\.spec\.ts/ },
    { name: "celular", use: { ...devices["Pixel 7"] }, testMatch: /celular\.spec\.ts/ },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: "npm run start -- -p 3000", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
