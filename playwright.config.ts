import { defineConfig } from "@playwright/test";

// Mock-backed E2E (brief: system Chrome, no browser downloads). The built dist/ is served by
// `vite preview`; every /api call is answered by the spec-driven mock in test/e2e/mock-api.ts.
const PORT = 4180;

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath: process.env.NP_CHROME_PATH ?? "/usr/bin/google-chrome" },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
