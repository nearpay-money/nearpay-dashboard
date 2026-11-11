import { describe, expect, it } from "vitest";
import {
  aboutDuration,
  activationClock,
  activationStatus,
  approvalNotice,
  secondsUntilActive,
} from "../../src/features/settlement/activation";

const NOW = 1_800_000_000;

describe("payout-wallet activation copy (active at once by default, owner decision 2026-11-11)", () => {
  it("derives any wait from active_at; none when active_at is now, past or missing", () => {
    expect(secondsUntilActive(NOW + 90, NOW)).toBe(90);
    expect(secondsUntilActive(NOW, NOW)).toBe(0);
    expect(secondsUntilActive(NOW - 5, NOW)).toBe(0);
    expect(secondsUntilActive(null, NOW)).toBe(0);
    expect(secondsUntilActive(undefined, NOW)).toBe(0);
  });
  it("rounds waits to friendly durations", () => {
    expect(aboutDuration(30)).toBe("less than a minute");
    expect(aboutDuration(60)).toBe("about 1 minute");
    expect(aboutDuration(89)).toBe("about 1 minute");
    expect(aboutDuration(25 * 60)).toBe("about 25 minutes");
    expect(aboutDuration(3600)).toBe("about 1 hour");
    expect(aboutDuration(3 * 3600 - 120)).toBe("about 3 hours");
    expect(aboutDuration(86_400)).toBe("about 24 hours");
    expect(aboutDuration(3 * 86_400)).toBe("about 3 days");
  });
  it("the approval notice says 'active' for the default flow, neutral 'activating' copy otherwise", () => {
    expect(approvalNotice("Main", { status: "active", active_at: NOW }, NOW)).toBe(
      "Main approved. Payout wallet active.",
    );
    expect(approvalNotice("Main", { status: "cooling_off", active_at: NOW + 7200 }, NOW)).toBe(
      "Main approved. It becomes active in about 2 hours.",
    );
    expect(approvalNotice("Main", { status: "cooling_off", active_at: NOW }, NOW)).toBe(
      "Main approved. It is activating now.",
    );
    expect(approvalNotice("Main", { status: "pending_approval", active_at: null }, NOW)).toBe("Main approved.");
    expect(approvalNotice("Main", { status: "disabled", active_at: null }, NOW)).toMatch(/didn't pass screening/);
    expect(activationStatus(NOW + 3 * 3600, NOW)).toBe("Activates in about 3 hours");
    expect(activationStatus(NOW, NOW)).toBe("Activating now");
    for (const s of [
      approvalNotice("Main", { status: "active", active_at: NOW }, NOW),
      approvalNotice("Main", { status: "cooling_off", active_at: NOW + 60 }, NOW),
      activationStatus(NOW + 60, NOW),
    ])
      expect(s).not.toMatch(/cool|hold|security/i);
  });
  it("local activation clock", () => {
    expect(activationClock(NOW)).toMatch(/^\d{1,2} \w{3} at \d{2}:\d{2}$/);
  });
});
