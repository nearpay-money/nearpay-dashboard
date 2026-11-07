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
  it("flags accents the checkout adjusts for contrast", () => {
    expect(accentAdjusted("#087A68")).toBe(false);
    expect(accentAdjusted("#FFFF00")).toBe(true);
  });
});
