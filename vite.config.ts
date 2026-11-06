import { defineConfig, type Plugin } from "vite";

/**
 * Content-Security-Policy of the built index.html (ADR-0010; the static server sets frame-ancestors).
 * - scripts: same origin, Cloudflare Turnstile, and inline scripts carrying the nonce. The nonce is the
 *   placeholder NPCSPNONCE, meant to be replaced per response by the static server (nginx sub_filter
 *   with $request_id, deploy follow-up); NEAR Connect passes it to its sandboxed wallet iframes.
 * - styles: 'unsafe-inline' only because NEAR Connect's wallet popup uses inline styles.
 * Dev mode (vite serve) gets no CSP (Vite injects inline scripts there).
 */
export const CSP_NONCE_PLACEHOLDER = "NPCSPNONCE";
export const CSP = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${CSP_NONCE_PLACEHOLDER}' https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https: wss:",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function csp(): Plugin {
  return {
    name: "nearpay-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<!--CSP-->",
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="np-csp-nonce" content="${CSP_NONCE_PLACEHOLDER}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [csp()],
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // local development against the Compose stack: same-origin /api like production
    proxy: { "/api": { target: "https://dashboard.nearpay.localhost", changeOrigin: true, secure: false } },
  },
  preview: { port: 4180, strictPort: true },
});
