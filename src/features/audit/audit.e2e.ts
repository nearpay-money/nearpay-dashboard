/** Audit log E2E (mock-backed): list, filter, CSV export download. */
import { readFileSync } from "node:fs";
import { expect, signIn, test } from "../../../test/e2e/harness";
import { AuditMock, installFeatureMock } from "./audit.mock";

const SHOTS = "/home/claude/shots/dashboard-features";
test.use({ viewport: { width: 1440, height: 900 } });

test("audit log: filter and export CSV", async ({ page, api }) => {
  installFeatureMock(api, new AuditMock("usr_01jbz9k3m4n5p6q7r8s9t0v1w2"));
  await signIn(page, api);
  await page.goto("/settings/audit");
  await expect(page.getByRole("table", { name: "Audit events" })).toContainText("Member invited");
  await page.screenshot({ path: `${SHOTS}/audit-1440.png`, fullPage: true });
  await page.getByTestId("filter-action").fill("api_key.rolled");
  await page.getByTestId("apply-filters").click();
  await expect(page.getByRole("table", { name: "Audit events" })).not.toContainText("Member invited");
  const download = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const csv = readFileSync((await (await download).path()) ?? "", "utf8");
  expect(csv.split("\r\n")[0]).toBe("id,created_utc,action,actor_type,actor_id,target_type,target_id,details");
  expect(csv).toContain("api_key.rolled");
  expect(csv).not.toContain("member.invited");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/audit-390.png`, fullPage: true });
});
