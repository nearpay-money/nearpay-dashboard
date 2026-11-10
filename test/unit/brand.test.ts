/** The favicon and app icons in public/ are the kit's brand files (design v2, Convergence), byte for byte. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const brand = join(dirname(require.resolve("@nearpay-internal/ui/package.json")), "brand");
const pub = join(__dirname, "../../public");

describe("brand files", () => {
  for (const f of [
    "favicon.svg",
    "favicon.ico",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
  ])
    it(`public/${f} equals the kit's`, () => {
      expect(readFileSync(join(pub, f)).equals(readFileSync(join(brand, f)))).toBe(true);
    });

  it("index.html sets the navy theme colour and links the icons and manifest", () => {
    const html = readFileSync(join(__dirname, "../../index.html"), "utf8");
    expect(html).toContain('<meta name="theme-color" content="#12263F" />');
    for (const href of ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/manifest.webmanifest"])
      expect(html).toContain(`href="${href}"`);
    const manifest = JSON.parse(readFileSync(join(pub, "manifest.webmanifest"), "utf8"));
    expect(manifest.theme_color).toBe("#12263F");
  });
});
