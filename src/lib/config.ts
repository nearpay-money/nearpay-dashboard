/** Build-time configuration (Vite env) and the per-response CSP nonce, if the static server set one. */

/** Same-origin API prefix (`dashboard.<domain>/api` → gateway, prefix stripped). */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "/api";

/** Cloudflare Turnstile site key; default: Cloudflare's always-pass test key (local stack). */
export const TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA";
export const TURNSTILE_SITEKEY: string = import.meta.env.VITE_TURNSTILE_SITEKEY ?? TURNSTILE_TEST_SITEKEY;
/** Token Cloudflare's test secret accepts (used only with the test site key when the widget cannot load). */
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** NEAR network for wallet connections (attestations are network-independent messages). */
export const NEAR_NETWORK: "mainnet" | "testnet" =
  import.meta.env.VITE_NEAR_NETWORK === "testnet" ? "testnet" : "mainnet";

export const CSP_NONCE_PLACEHOLDER = "NPCSPNONCE";

/** The CSP nonce from `<meta name="np-csp-nonce">` (the placeholder when the server did not substitute one). */
export function cspNonce(doc: Pick<Document, "querySelector"> | undefined = globalThis.document): string | undefined {
  const v = doc?.querySelector('meta[name="np-csp-nonce"]')?.getAttribute("content") ?? undefined;
  return v && /^[A-Za-z0-9+/=]+$/.test(v) ? v : undefined;
}
