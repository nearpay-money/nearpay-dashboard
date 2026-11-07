/**
 * Audit log logic (identity §12, spec `AuditEvent`): filter → query, action labels, and the client-side
 * CSV export (RFC 4180 quoting; cells that a spreadsheet would run as a formula are prefixed with `'`).
 */
import type { AuditEvent as AuditEventSchema, z } from "@nearpay/spec";

export type AuditEvent = z.output<typeof AuditEventSchema>;

export interface AuditFilter {
  readonly action: string;
  readonly actor: string;
  /** `YYYY-MM-DD` (local day) or "". */
  readonly from: string;
  readonly to: string;
}

export const EMPTY_FILTER: AuditFilter = { action: "", actor: "", from: "", to: "" };

/** Local calendar day → unix seconds (start of day, or end of day for `to`). */
export function dayToUnix(day: string, end: boolean): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0);
  return Number.isNaN(d.getTime()) ? undefined : Math.floor(d.getTime() / 1000);
}

export function filterError(f: AuditFilter): string | undefined {
  const a = dayToUnix(f.from, false);
  const b = dayToUnix(f.to, true);
  if (a !== undefined && b !== undefined && a > b) return "The start date is after the end date.";
  if (f.action.length > 100) return "Actions are at most 100 characters.";
  if (f.actor.length > 64) return "Actor ids are at most 64 characters.";
  return undefined;
}

export function filterQuery(f: AuditFilter): Record<string, string | number> {
  const q: Record<string, string | number> = {};
  if (f.action.trim()) q.action = f.action.trim();
  if (f.actor.trim()) q.actor = f.actor.trim();
  const a = dayToUnix(f.from, false);
  const b = dayToUnix(f.to, true);
  if (a !== undefined) q["created[gte]"] = a;
  if (b !== undefined) q["created[lte]"] = b;
  return q;
}

/** `destination.created` → `Destination created`. */
export function actionLabel(action: string): string {
  const s = action.replace(/[._]/g, " ").trim();
  return s ? s[0]?.toUpperCase() + s.slice(1) : action;
}

export function actorLabel(a: AuditEvent["actor"], emails: ReadonlyMap<string, string>): string {
  switch (a.type) {
    case "user":
      return emails.get(a.id) ?? a.id;
    case "api_key":
      return `API key ${a.id}`;
    case "operator":
      return "NearPay operations";
    case "service":
      return `NearPay (${a.id})`;
    case "system":
      return "NearPay (system)";
    default:
      return `${a.type} ${a.id}`;
  }
}

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = [
  "id",
  "created_utc",
  "action",
  "actor_type",
  "actor_id",
  "target_type",
  "target_id",
  "details",
];

export function toCsv(events: readonly AuditEvent[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const e of events) {
    lines.push(
      [
        e.id,
        new Date(e.created * 1000).toISOString(),
        e.action,
        e.actor.type,
        e.actor.id,
        e.target?.type ?? "",
        e.target?.id ?? "",
        Object.keys(e.details).length ? e.details : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Most rows one export walks (100 per page). */
export const EXPORT_LIMIT = 10_000;
