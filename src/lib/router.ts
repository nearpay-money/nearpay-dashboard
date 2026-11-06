/** A tiny History-API router (nginx serves index.html for every path). */

export interface Match {
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
}

export interface RouteSpec {
  readonly name: string;
  readonly pattern: string;
}

/** Matches `/payments/:id` style patterns; returns null when nothing matches. */
export function matchPath(routes: readonly RouteSpec[], pathname: string): Match | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  for (const r of routes) {
    const ps = r.pattern.split("/");
    const xs = clean.split("/");
    if (ps.length !== xs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i] as string;
      const x = xs[i] as string;
      if (p.startsWith(":")) {
        if (!x) {
          ok = false;
          break;
        }
        params[p.slice(1)] = decodeURIComponent(x);
      } else if (p !== x) {
        ok = false;
        break;
      }
    }
    if (ok) return { name: r.name, params };
  }
  return null;
}
