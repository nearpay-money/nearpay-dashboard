/** Cloudflare Turnstile (the only third-party runtime script, ADR-0010), loaded on the sign-up page only. */
import { TURNSTILE_DUMMY_TOKEN, TURNSTILE_SITEKEY, TURNSTILE_TEST_SITEKEY } from "../../lib/config";

interface TurnstileApi {
  render(el: HTMLElement, o: { sitekey: string; callback(token: string): void; "error-callback"?(): void }): string;
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function load(timeoutMs: number): Promise<TurnstileApi | null> {
  const w = window as unknown as { turnstile?: TurnstileApi };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    const timer = setTimeout(() => resolve(w.turnstile ?? null), timeoutMs);
    s.onload = () => {
      clearTimeout(timer);
      resolve(w.turnstile ?? null);
    };
    s.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(s);
  });
}

/**
 * Renders the widget into `el` and reports the token. When the widget cannot load and the site key is
 * Cloudflare's always-pass test key (local stack, offline), the documented dummy token is used — the
 * matching test secret accepts it; a real site key never falls back.
 */
export async function mountTurnstile(
  el: HTMLElement,
  onToken: (t: string) => void,
  onError: (msg: string) => void,
  timeoutMs = 8000,
): Promise<void> {
  const api = await load(timeoutMs);
  if (!api) {
    if (TURNSTILE_SITEKEY === TURNSTILE_TEST_SITEKEY) onToken(TURNSTILE_DUMMY_TOKEN);
    else onError("The human-verification widget could not load. Check your connection and reload.");
    return;
  }
  api.render(el, {
    sitekey: TURNSTILE_SITEKEY,
    callback: onToken,
    "error-callback": () => onError("Human verification failed; reload and try again."),
  });
}
