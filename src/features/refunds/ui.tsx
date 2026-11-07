/** Small module-local view helpers: SPA links inside kit tables, dates, asset amounts. */
import { formatMoney } from "@nearpay-internal/ui";
import { type RefObject, useEffect } from "react";
import { useApp } from "../../app/context";

/**
 * Same-origin `<a href="/…">` clicks inside `ref` (kit `Table` row links, `buttonClassName` links) use
 * the History API instead of a full reload. Modified clicks (new tab) keep the browser default.
 */
export function useSpaLinks(ref: RefObject<HTMLElement | null>): void {
  const app = useApp();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      const href = a?.getAttribute("href");
      if (!a || !href?.startsWith("/") || href.startsWith("//") || a.target) return;
      e.preventDefault();
      app.navigate(href);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [ref, app]);
}

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

export const fmtDate = (unix: number | null | undefined): string => (unix ? DATE.format(unix * 1000) : "—");
export const fmtTime = (unix: number): string => TIME.format(unix * 1000);
export const isoOf = (unix: number): string => new Date(unix * 1000).toISOString();

/** Base units of an asset → `"49.00 USDC"`; unknown asset → raw base units with the asset id. */
export function assetText(amount: string, assetId: string, decimals: number | undefined, symbol: string | undefined) {
  if (decimals === undefined) return `${amount} base units`;
  return formatMoney({ amount, decimals, symbol: symbol ?? assetId.replace(/^nep\d+:/, "").slice(0, 12) });
}
