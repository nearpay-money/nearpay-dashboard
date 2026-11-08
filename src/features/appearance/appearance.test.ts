import { describe, expect, it } from "vitest";
import { accentAdjusted, normalizeHex, updateBody, validate } from "./logic";

describe("appearance", () => {
  it("normalises colours", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("087a68")).toBe("#087A68");
    expect(normalizeHex("#12345")).toBeUndefined();
  });
  it("validates and sends only changes", () => {
    expect(validate({ displayName: "", accent: "x" })).toEqual({
      displayName: "Enter the name customers see.",
      accent: "Enter a colour like #087A68.",
    });
    const cur = { display_name: "Acme", accent_color: null };
    expect(updateBody({ displayName: "Acme", accent: "#087a68" }, cur)).toBeNull();
    expect(updateBody({ displayName: "Acme Studio", accent: "#1D4ED8" }, cur)).toEqual({
      display_name: "Acme Studio",
      settings: { branding: { accent_color: "#1D4ED8" } },
    });
  });
  it("saves theme and corner radius only when they change (spec 0.2.1)", () => {
    const cur = { display_name: "Acme", accent_color: null, theme: "auto", corner_radius: 8 };
    expect(updateBody({ displayName: "Acme", accent: "#087A68", theme: "auto", corner: "8" }, cur)).toBeNull();
    expect(updateBody({ displayName: "Acme", accent: "#087A68", theme: "dark", corner: "16" }, cur)).toEqual({
      settings: { branding: { theme: "dark", corner_radius: 16 } },
    });
    expect(
      updateBody(
        { displayName: "Acme", accent: "#087A68", theme: "light" },
        { display_name: "Acme", accent_color: null },
      ),
    ).toEqual({
      settings: { branding: { theme: "light" } },
    });
  });
  it("flags accents the checkout adjusts for contrast", () => {
    expect(accentAdjusted("#087A68")).toBe(false);
    expect(accentAdjusted("#FFFF00")).toBe(true);
  });
});
