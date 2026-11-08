/**
 * Checkout appearance logic: the account's checkout branding (`settings.branding.accent_color`, `theme`,
 * `corner_radius` — the last two since spec 0.2.1 — and `display_name`; spec `updateAccount`). Accents are
 * adjusted by the ui `deriveAccent` to keep WCAG AA.
 */
import { deriveAccent } from "@nearpay-internal/ui";

export const DEFAULT_ACCENT = "#087A68";

export const PRESETS = [
  { value: "#087A68", label: "NearPay teal" },
  { value: "#1D4ED8", label: "Blue" },
  { value: "#6D28D9", label: "Violet" },
  { value: "#BE123C", label: "Rose" },
  { value: "#B45309", label: "Amber" },
  { value: "#111827", label: "Graphite" },
] as const;

export const THEMES = [
  { value: "auto", label: "Match customer device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export const CORNERS = [
  { value: "0", label: "Square · 0 px" },
  { value: "4", label: "Subtle · 4 px" },
  { value: "8", label: "Rounded · 8 px" },
  { value: "16", label: "Soft · 16 px" },
] as const;

/** `#abc` / `abc` / `#AABBCC` → `#AABBCC`; undefined when invalid. */
export function normalizeHex(input: string): string | undefined {
  const s = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) return `#${[...s].map((c) => c + c).join("")}`.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`.toUpperCase();
  return undefined;
}

export const accentName = (hex: string): string => PRESETS.find((p) => p.value === hex)?.label ?? "Custom";

/** Whether the checkout adjusts the accent for contrast (fill, or accent text and links, light theme). */
export function accentAdjusted(hex: string): boolean {
  const t = deriveAccent(hex, "light");
  const h = hex.toLowerCase();
  return t["--np-color-accent"].toLowerCase() !== h || t["--np-color-accent-text"].toLowerCase() !== h;
}

export type Theme = "auto" | "light" | "dark";

export interface AppearanceForm {
  readonly displayName: string;
  readonly accent: string;
  readonly theme?: Theme;
  /** Corner radius in px as a string (`"8"`). */
  readonly corner?: string;
}

export interface SavedAppearance {
  readonly display_name: string;
  readonly accent_color: string | null;
  readonly theme?: string;
  readonly corner_radius?: number;
}

export type BrandingPatch = { accent_color?: string; theme?: Theme; corner_radius?: number };

export function validate(f: AppearanceForm): { displayName?: string; accent?: string } {
  const e: { displayName?: string; accent?: string } = {};
  const n = f.displayName.trim();
  if (!n) e.displayName = "Enter the name customers see.";
  else if (n.length > 100) e.displayName = "Use at most 100 characters.";
  if (!normalizeHex(f.accent)) e.accent = "Enter a colour like #087A68.";
  return e;
}

/** `updateAccount` body with only what changed (no step-up: branding is not a money setting). */
export function updateBody(
  f: AppearanceForm,
  current: SavedAppearance,
): { display_name?: string; settings?: { branding: BrandingPatch } } | null {
  const body: { display_name?: string; settings?: { branding: BrandingPatch } } = {};
  const branding: BrandingPatch = {};
  const name = f.displayName.trim();
  const hex = normalizeHex(f.accent);
  if (name && name !== current.display_name) body.display_name = name;
  if (hex && hex.toUpperCase() !== (current.accent_color ?? DEFAULT_ACCENT).toUpperCase()) branding.accent_color = hex;
  if (f.theme && f.theme !== (current.theme ?? "auto")) branding.theme = f.theme;
  if (f.corner !== undefined && Number(f.corner) !== (current.corner_radius ?? 8))
    branding.corner_radius = Number(f.corner);
  if (Object.keys(branding).length) body.settings = { branding };
  return Object.keys(body).length ? body : null;
}
