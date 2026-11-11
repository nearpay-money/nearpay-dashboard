import { describe, expect, it } from "vitest";
import { ACTIVATING_TEXT, approvalNotice } from "../../src/features/settlement/activation";

describe("payout-wallet activation copy (active at once, owner decisions 2026-11-11/12)", () => {
  it("the approval notice says 'active' for the normal flow and only 'activating' otherwise", () => {
    expect(approvalNotice("Main", { status: "active" })).toBe("Main approved. Payout wallet active.");
    expect(approvalNotice("Main", { status: "cooling_off" })).toBe("Main approved. It is activating.");
    expect(approvalNotice("Main", { status: "pending_approval" })).toBe("Main approved.");
    expect(approvalNotice("Main", { status: "disabled" })).toMatch(/didn't pass screening/);
  });
  it("never speaks of a cool-off, a hold, a waiting period or a countdown", () => {
    for (const s of [
      ACTIVATING_TEXT,
      approvalNotice("Main", { status: "active" }),
      approvalNotice("Main", { status: "cooling_off" }),
    ]) {
      expect(s).not.toMatch(/cool|hold|security|wait|hour|minute|day/i);
    }
  });
});
