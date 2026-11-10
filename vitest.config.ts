import { defineConfig } from "vitest/config";

// Unit tests run in Node against the pure modules (API client, session, money, fingerprint, wallets,
// permissions). UI flows are covered by the mock-backed Playwright suite (test/e2e).
// Coverage gate (foundations §16): ≥ 90% branches on src/lib and src/wallets.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["test/unit/**/*.test.{ts,tsx}", "src/features/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/wallets/**/*.ts"],
      exclude: ["src/lib/hooks.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { branches: 90, lines: 90 },
    },
  },
});
