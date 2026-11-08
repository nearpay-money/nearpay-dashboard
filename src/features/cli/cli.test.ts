import { describe, expect, it } from "vitest";
import { countryName, loginView, normalizeUserCode } from "./logic";

describe("CLI login page rules", () => {
  it("normalizes user codes", () => {
    expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDF-GHJK");
    expect(normalizeUserCode(" BCDF GHJK ")).toBe("BCDF-GHJK");
    expect(normalizeUserCode("BCDFGHJK")).toBe("BCDF-GHJK");
    expect(normalizeUserCode("ABCD-EFGH")).toBeNull(); // vowels are not in the alphabet
    expect(normalizeUserCode("BCD-FGH")).toBeNull();
    expect(normalizeUserCode(null)).toBeNull();
    expect(normalizeUserCode("")).toBeNull();
  });
  it("derives the view; pending past expiry is expired", () => {
    expect(loginView("pending", 100, 50)).toBe("pending");
    expect(loginView("pending", 100, 100)).toBe("expired");
    expect(loginView("approved", 1, 50)).toBe("approved");
    expect(loginView("redeemed", 1, 50)).toBe("approved");
    expect(loginView("denied", 1, 50)).toBe("denied");
    expect(loginView("expired", 100, 50)).toBe("expired");
    expect(loginView("something_new", 100, 50)).toBe("expired");
  });
  it("country names", () => {
    expect(countryName("DE")).toBe("Germany");
    expect(countryName(null)).toBeNull();
    expect(countryName("T1")).toBe("T1");
  });
});
