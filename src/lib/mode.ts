/** Test/live mode: in memory and in the URL (`?mode=live`); test is the default (lld/dashboard §1). */
import type { Mode } from "./api";

export function modeFromSearch(search: string): Mode {
  return new URLSearchParams(search).get("mode") === "live" ? "live" : "test";
}

/** Returns `search` with the mode applied (test = no parameter). */
export function withMode(search: string, mode: Mode): string {
  const sp = new URLSearchParams(search);
  if (mode === "live") sp.set("mode", "live");
  else sp.delete("mode");
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** A path with the current mode carried over, for links. */
export function hrefFor(path: string, mode: Mode): string {
  const [p, q = ""] = path.split("?") as [string, string?];
  return `${p}${withMode(q, mode)}`;
}
