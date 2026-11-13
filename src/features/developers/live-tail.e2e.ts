/** Developers → Live tail E2E (mock-backed SSE): live events, resume with Last-Event-ID, pause/clear, mode. */
import { mkdirSync } from "node:fs";
import { expect, signIn, test } from "../../../test/e2e/harness";
import { BillingMock } from "../billing/billing.mock";

const SHOTS = process.env.NP_SHOTS ?? "test-results/shots/dashboard";
mkdirSync(SHOTS, { recursive: true });
test.use({ viewport: { width: 1440, height: 900 } });

const obj = (id: string) => ({ object: "ping", webhook_endpoint: id });

test("live tail: new events stream in, reconnects resume, pause replays, clear, mode follows the switch", async ({
  page,
  api,
}) => {
  const b = new BillingMock(api);
  await signIn(page, api, "/developers/live");
  await expect(page.getByTestId("tail-empty")).toBeVisible();
  await expect(page.getByTestId("tail-state")).toContainText(/Showing test events|Reconnecting|Connecting/);
  const e1 = b.push("test", "ping", obj("we_01jbz9k3m4n5p6q7r8s9t0aaaa"));
  const list = page.getByTestId("tail-list");
  await expect(list).toContainText("ping");
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list.getByRole("link", { name: new RegExp(String(e1.id)) })).toBeVisible();
  // later connects resume from the last event id (EventSource semantics)
  await expect
    .poll(() => api.callsTo("streamEvents").some((c) => c.headers["last-event-id"] === e1.id), { timeout: 5000 })
    .toBe(true);
  const stream = api.callsTo("streamEvents")[0];
  expect(stream?.headers["nearpay-mode"]).toBe("test");
  expect(stream?.headers.accept).toBe("text/event-stream");
  await page.getByTestId("tail-pause").click();
  await expect(page.getByTestId("tail-state")).toContainText("Paused");
  const pausedAt = api.callsTo("streamEvents").length;
  const e2 = b.push("test", "ping", obj("we_01jbz9k3m4n5p6q7r8s9t0aaab"));
  await page.waitForTimeout(800);
  expect(api.callsTo("streamEvents").length).toBe(pausedAt); // paused: no connection
  await page.getByTestId("tail-resume").click();
  await expect(list.locator("li")).toHaveCount(2);
  expect(api.callsTo("streamEvents").at(-1)?.headers["last-event-id"]).toBeDefined();
  await expect(list.getByRole("link", { name: new RegExp(String(e2.id)) })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/live-tail-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}/live-tail-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("tail-clear").click();
  await expect(page.getByTestId("tail-empty")).toBeVisible();
  // the type filter goes to the server
  await page.getByTestId("tail-type").selectOption("invoice.paid");
  await expect.poll(() => api.callsTo("streamEvents").at(-1)?.query.types).toBe("invoice.paid");
  // switching mode opens a live-mode stream
  await page.getByTestId("mode-switch").getByRole("radio", { name: "Live" }).click();
  await expect.poll(() => api.callsTo("streamEvents").at(-1)?.headers["nearpay-mode"]).toBe("live");
  await expect(page.getByTestId("tail-state")).toContainText(/live events|Connecting|Reconnecting/);
});
