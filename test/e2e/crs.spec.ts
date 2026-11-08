/** Spec 0.2.1 dashboard change requests absorbed in step 3.3 (integration notes "dashboard-features CRs"). */
import {
  installFeatureMock as installLinks,
  PaymentLinksMock,
} from "../../src/features/payment-links/payment-links.mock";
import { installFeatureMock as installTeam, TeamMock } from "../../src/features/team/team.mock";
import { destination, NOW } from "./fixtures";
import { expect, signIn, test } from "./harness";

const ME = "usr_01jbz9k3m4n5p6q7r8s9t0v1w2";
test.use({ viewport: { width: 1440, height: 900 } });

test("payment detail: what the payer sent and their refund address (refund_to, origin_amount)", async ({
  page,
  api,
}) => {
  const pi = api.intents.test[0] as unknown as { id: string; attempts: Record<string, unknown>[] };
  Object.assign(pi.attempts[0] as object, {
    origin_amount: "2006000",
    refund_to: "0x71c7656ec7ab88b098defb751b7401b5f6d89a42",
  });
  await signIn(page, api, `/payments/${pi.id}`);
  const stats = page.locator(".dash-stats");
  await expect(stats).toContainText("Payer sent");
  await expect(stats).toContainText("2.006 USDC");
  await expect(stats).toContainText("fee 0.006 USDC paid by the payer");
  await expect(page.getByTestId("payer-address")).toContainText("0x71c7…d89a42");
  await expect(page.getByTestId("payer-address")).toContainText("refunds return here");
});

test("payment link: internal name on create, list and detail (PaymentLink.name)", async ({ page, api }) => {
  const mock = new PaymentLinksMock();
  installLinks(api, mock);
  await signIn(page, api, "/payment-links/new");
  await page.getByTestId("link-title").fill("Acme Pro");
  await page.getByTestId("link-name").fill("Pro — launch campaign");
  await page.getByTestId("link-amount").fill("49");
  await page.getByTestId("create-link").click();
  await expect(page.getByRole("heading", { name: "Pro — launch campaign" })).toBeVisible();
  expect(api.callsTo("createPaymentLink")[0]?.body).toMatchObject({
    description: "Acme Pro",
    name: "Pro — launch campaign",
  });
  await page.goto("/payment-links");
  await expect(page.getByRole("table")).toContainText("Pro — launch campaign");
  await expect(page.getByRole("table")).toContainText("Acme Pro");
});

test("checkout appearance: theme and corner radius are saved (branding.theme / corner_radius)", async ({
  page,
  api,
}) => {
  api.role = "owner";
  await signIn(page, api, "/settings/appearance");
  await page.getByTestId("appearance-theme").selectOption("dark");
  await page.getByTestId("appearance-corner").selectOption("16");
  await page.getByTestId("save-appearance").click();
  await expect(page.getByTestId("save-appearance")).toHaveText("Saved");
  expect(api.callsTo("updateAccount").at(-1)?.body).toEqual({
    settings: { branding: { theme: "dark", corner_radius: 16 } },
  });
  await page.reload();
  await expect(page.getByTestId("appearance-theme")).toHaveValue("dark");
  await expect(page.getByTestId("appearance-corner")).toHaveValue("16");
});

test("team: member security summary; approvals explain approver tenure", async ({ page, api }) => {
  const mock = new TeamMock(ME);
  installTeam(api, mock);
  Object.assign(mock.members[1] as object, { security: { passkeys: 2, recovered_at: NOW - 3600 } });
  Object.assign(mock.members[0] as object, { security: { passkeys: 1, recovered_at: null } });
  mock.seedPending(ME);
  await signIn(page, api, "/settings/team?mode=live");
  const t = page.getByRole("table", { name: "Team members and invitations" });
  await expect(t).toContainText("1 passkey");
  await expect(t).toContainText("2 passkeys · recovered, changes locked 48 h");
});

test("settlement: who added a destination, pending expiry and expired destinations", async ({ page, api }) => {
  api.destinations.live.push(
    destination({
      livemode: true,
      label: "Treasury",
      status: "pending_approval",
      is_default: false,
      active_at: null,
      created: NOW - 86_400,
      created_by: ME,
      approval: { required: 2, approved_by: [ME], rejected_by: null },
    } as never),
    destination({
      livemode: true,
      label: "Old ops wallet",
      status: "disabled",
      is_default: false,
      disabled_reason: "expired",
    } as never),
  );
  await signIn(page, api, "/settlement?mode=live");
  const table = page.getByTestId("destinations-table");
  await expect(table).toContainText("Added by you");
  await expect(table).toContainText("1 of 2 approvals");
  await expect(page.getByTestId("approval-expiry")).toContainText("if not approved");
  await expect(page.getByTestId("expired")).toContainText("Not approved within 7 days");
  await expect(page.getByTestId("approval-rules")).toContainText("at least 7 days");
});
