/** CLI login approval rules (lld/identity.md §6.2, §19; spec `cli`). */
import { CliUserCode } from "@nearpay/spec";

/** Typed or linked code → `XXXX-XXXX` (upper case, dash inserted), or null when it can't be a user code. */
export function normalizeUserCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (raw.length !== 8) return null;
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return CliUserCode.safeParse(code).success ? code : null;
}

export type LoginView = "pending" | "approved" | "denied" | "expired";

/** The page state for a login: pending past its expiry is expired (the server agrees, §19). */
export function loginView(status: string, expiresAt: number, now: number): LoginView {
  if (status === "approved" || status === "redeemed") return "approved";
  if (status === "denied") return "denied";
  if (status === "expired" || expiresAt <= now) return "expired";
  return status === "pending" ? "pending" : "expired";
}

/** Country code → name (`DE` → `Germany`); unknown or missing codes are shown as given. */
export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
