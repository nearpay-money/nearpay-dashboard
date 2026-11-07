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

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar day key `YYYY-MM-DD` of a unix time. */
export function dayKey(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `"Today, 10:42"` / `"Yesterday, 09:58"` / `"6 Nov, 10:21"` / `"6 Nov 2025, 10:21"` (local time). */
export function formatWhen(unix: number | null | undefined, nowSec = Math.floor(Date.now() / 1000)): string {
  if (unix === null || unix === undefined) return "—";
  const d = new Date(unix * 1000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (dayKey(unix) === dayKey(nowSec)) return `Today, ${time}`;
  if (dayKey(unix) === dayKey(nowSec - 86_400)) return `Yesterday, ${time}`;
  const now = new Date(nowSec * 1000);
  const month = d.toLocaleString("en-GB", { month: "short" });
  return d.getFullYear() === now.getFullYear()
    ? `${d.getDate()} ${month}, ${time}`
    : `${d.getDate()} ${month} ${d.getFullYear()}, ${time}`;
}

/** `"Saturday, 7 November 2026"`. */
export function formatLongDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** `"7 Nov 2026"`. */
export function formatDate(unix: number | null | undefined): string {
  if (unix === null || unix === undefined) return "—";
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** `"10:42:18"` (local). */
export function formatClock(unix: number): string {
  const d = new Date(unix * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Short display of a prefixed id: `pi_01jbz…v1w2` → `pi_…v1w2`. */
export function shortId(id: string): string {
  const i = id.indexOf("_");
  if (i < 0 || id.length - i <= 9) return id;
  return `${id.slice(0, i)}_…${id.slice(-4)}`;
}
