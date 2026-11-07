/**
 * Client-side CSV export (payments list, audit log). RFC 4180 quoting; cells that a spreadsheet would
 * evaluate as a formula (`=`, `+`, `-`, `@`, tab, CR) are prefixed with `'` (CSV injection, OWASP).
 * Amounts are passed in already formatted as exact decimal strings (INV-5) — never as floats.
 */

export type CsvCell = string | number | bigint | boolean | null | undefined;

const FORMULA = /^[=+\-@\t\r]/;

/** One CSV cell. Numbers/bigints are written as is (no formula guard needed for digits). */
export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = FORMULA.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row + rows, CRLF line endings. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [header, ...rows]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}

/** Triggers a download of `csv` as `filename` (UTF-8 with BOM so spreadsheets detect the encoding). */
export function downloadCsv(filename: string, csv: string, doc: Document = document): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
