/** Team & approvals E2E (mock-backed): invite (step-up), last-owner guard, approval with approver_conflict. */
import { expect, signIn, test } from "../../../test/e2e/harness";
import { installFeatureMock, TeamMock } from "./team.mock";

const SHOTS = "test-results/shots/dashboard-features";
test.use({ viewport: { width: 1440, height: 900 } });
const ME = "usr_01jbz9k3m4n5p6q7r8s9t0v1w2";

test("team: invite with step-up, approvals and approver conflict", async ({ page, api }) => {
  const mock = new TeamMock(ME);
  installFeatureMock(api, mock);
  mock.seedPending(ME);
  await signIn(page, api);
  await page.goto("/settings/team");
  await expect(page.getByRole("table", { name: "Team members and invitations" })).toContainText("riya@acme.example");
  await page.getByTestId("invite-member").click();
  await page.getByTestId("invite-email").fill("new@acme.example");
  await page.getByTestId("invite-role").selectOption("developer");
  await page.getByTestId("send-invite").click();
  await page.getByRole("button", { name: "Confirm with passkey" }).click();
  await expect(page.getByRole("table", { name: "Team members and invitations" })).toContainText("new@acme.example");
  expect(api.callsTo("createInvitation").at(-1)?.body).toEqual({ email: "new@acme.example", role: "developer" });

  await page.goto("/settings/team?mode=live");
  await expect(page.getByRole("table", { name: "Changes awaiting approval" })).toContainText("Treasury");
  await page.screenshot({ path: `${SHOTS}/team-1440.png`, fullPage: true });
  await page.getByTestId("review-approval").click();
  await expect(page.getByText("You already approved this change")).toBeVisible();
  await expect(page.getByTestId("approve-destination")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/team-390.png`, fullPage: true });
});
