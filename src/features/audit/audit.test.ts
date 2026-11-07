import { describe, expect, it } from "vitest";
import { actionLabel, actorLabel, csvCell, dayToUnix, filterError, filterQuery, toCsv } from "./logic";

describe("audit log", () => {
  it("escapes CSV cells and neutralises formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(null)).toBe("");
  });
  it("writes one row per event", () => {
    const csv = toCsv([
      {
        id: "aud_1",
        object: "audit_event",
        created: 0,
        account: "acct_1",
        actor: { type: "user", id: "usr_1" },
        action: "member.invited",
        target: { type: "invitation", id: "inv_1" },
        details: { role: "admin" },
      } as never,
    ]);
    expect(csv.split("\r\n")[1]).toBe(
      'aud_1,1970-01-01T00:00:00.000Z,member.invited,user,usr_1,invitation,inv_1,"{""role"":""admin""}"',
    );
  });
  it("builds queries from filters", () => {
    expect(filterQuery({ action: " a.b ", actor: "", from: "", to: "" })).toEqual({ action: "a.b" });
    const q = filterQuery({ action: "", actor: "usr_1", from: "2026-11-01", to: "2026-11-02" });
    expect((q["created[lte]"] as number) - (q["created[gte]"] as number)).toBe(2 * 86_400 - 1);
    expect(filterError({ action: "", actor: "", from: "2026-11-03", to: "2026-11-02" })).toBeDefined();
    expect(dayToUnix("nope", false)).toBeUndefined();
    expect(actionLabel("api_key.rolled")).toBe("Api key rolled");
    expect(actorLabel({ type: "user", id: "usr_1" }, new Map([["usr_1", "a@b.co"]]))).toBe("a@b.co");
    expect(actorLabel({ type: "system", id: "system" }, new Map())).toBe("NearPay (system)");
  });
});
