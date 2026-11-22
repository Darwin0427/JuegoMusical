import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Margen para esperas asíncronas cuando la máquina está cargada (CI, muchas pruebas en paralelo)
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  if (typeof document !== "undefined") cleanup();
  if (typeof localStorage !== "undefined") localStorage.clear();
  vi.useRealTimers();
});
