import { describe, expect, it } from "vitest";
import {
  aboutDuration,
  activationClock,
  activationNotice,
  activationStatus,
  SECURITY_HOLD_COPY,
  secondsUntilActive,
} from "../../src/features/settlement/cooloff";

const NOW = 1_800_000_000;

describe("settlement cool-off copy (configurable cool-off, no hard-coded duration)", () => {
  it("derives the wait from active_at; none when active_at is now, past or missing", () => {
    expect(secondsUntilActive(NOW + 90, NOW)).toBe(90);
    expect(secondsUntilActive(NOW, NOW)).toBe(0); // NP_COOLOFF_SECONDS=0: active_at = approval time
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
  it("status line and approval notice switch to 'now' wording with no cool-off", () => {
    expect(activationStatus(NOW + 3 * 3600, NOW)).toBe("Activates in about 3 hours");
    expect(activationStatus(NOW, NOW)).toBe("Activating now");
    expect(activationNotice("Main", NOW + 7200, NOW)).toBe("Main approved. It becomes active in about 2 hours.");
    expect(activationNotice("Main", NOW, NOW)).toBe("Main approved. It is activating now.");
    expect(activationNotice("Main", null)).toBe("Main approved. It is activating now.");
  });
  it("local activation clock and generic copy carry no number", () => {
    expect(activationClock(NOW)).toMatch(/^\d{1,2} \w{3} at \d{2}:\d{2}$/);
    expect(SECURITY_HOLD_COPY).not.toMatch(/\d/);
  });
});
