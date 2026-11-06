/** Dates and small display helpers. */

export function formatTime(unix: number | null | undefined): string {
  if (unix === null || unix === undefined) return "—";
  return new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 16).concat(" UTC");
}

export function formatIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : formatTime(Math.floor(t / 1000));
}

/** `"in 3 h 20 min"` / `"5 min ago"`. */
export function relative(unix: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const d = unix - nowSec;
  const a = Math.abs(d);
  const text =
    a < 60
      ? `${a} s`
      : a < 3600
        ? `${Math.floor(a / 60)} min`
        : `${Math.floor(a / 3600)} h ${Math.floor((a % 3600) / 60)} min`;
  return d >= 0 ? `in ${text}` : `${text} ago`;
}

/** `abcdef…uvwxyz` for long identifiers. */
export function shorten(s: string, keep = 6): string {
  return s.length <= keep * 2 + 1 ? s : `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

export const humanize = (s: string) => s.replace(/_/g, " ");
