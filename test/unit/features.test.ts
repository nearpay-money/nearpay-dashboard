import { describe, expect, it } from "vitest";
import { AREA_CARDS, AREA_NAV, AREA_ROUTES, FEATURE_AREAS, type FeatureIndex } from "../../src/app/features";

const modules = import.meta.glob<FeatureIndex>("../../src/features/*/index.ts", { eager: true });

describe("stage 2 feature areas", () => {
  it("the core route table matches every area's exported routes and nav", () => {
    for (const area of FEATURE_AREAS) {
      const m = modules[`../../src/features/${area}/index.ts`];
      expect(m, area).toBeDefined();
      const mine = AREA_ROUTES.filter((r) => r.area === area);
      expect(
        mine.map((r) => [r.name, r.pattern, r.title, r.roles]),
        area,
      ).toEqual((m as FeatureIndex).routes.map((r) => [r.name, r.pattern, r.title, r.roles]));
      for (const r of mine) {
        const theirs = (m as FeatureIndex).routes.find((x) => x.name === r.name);
        expect(r.section, r.name).toBe(theirs?.nav);
      }
      for (const n of (m as FeatureIndex).nav) {
        if (n.group === "workspace") expect(AREA_NAV.some((x) => x.slot === n.id && x.href === n.href)).toBe(true);
        else expect(AREA_CARDS.some((c) => c.href === n.href && c.title === n.label)).toBe(true);
      }
    }
  });
});
