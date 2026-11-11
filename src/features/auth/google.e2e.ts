/**
 * Continue with Google in the dashboard (ADR-0026). Google and identity's callback are played by
 * intercepting the Google URL the mock API returns: the "callback" answers with the redirect identity
 * would send (signed in → /setup, refused → /signin?google_error=…, linked → /settings/account?google=linked).
 */
import { expect, signIn, test } from "../../../test/e2e/harness";
import type { MockApi } from "../../../test/e2e/mock-api";

const GOOGLE = "https://accounts.google.test/**";

/** Google + identity's callback: `outcome` is the dashboard path identity redirects to. */
async function playGoogle(page: import("@playwright/test").Page, api: MockApi, outcome: string, effect?: () => void) {
  await page.route(GOOGLE, async (r) => {
    effect?.();
    await r.fulfill({ status: 302, headers: { location: `http://localhost:4180${outcome}` } });
  });
  void api;
}

test.describe("Continue with Google", () => {
  test("hidden when identity has no Google client; the passkey flow is unchanged", async ({ page, api }) => {
    await page.goto("/signin");
    await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
    await expect(page.getByTestId("google-button")).toHaveCount(0);
    expect(api.callsTo("getAuthMethods").length).toBeGreaterThan(0);
    await page.goto("/signup");
    await expect(page.getByTestId("google-button")).toHaveCount(0);
  });

  test("sign-up page: Google above the email form; a new Google user lands on onboarding", async ({ page, api }) => {
    api.googleEnabled = true;
    await playGoogle(page, api, "/setup", () => {
      api.signedIn = true;
      api.signInMethod = "google";
      api.passkeys = 0;
      api.passkeySetupUntil = Math.floor(Date.now() / 1000) + 600;
      api.linked = [{ object: "linked_identity", provider: "google", email: "owner@acme.example", created: 1 }];
    });
    await page.goto("/signup");
    const google = page.getByRole("button", { name: "Continue with Google" });
    await expect(google).toBeVisible();
    const gBox = await google.boundingBox();
    const emailBox = await page.getByLabel("Work email").boundingBox();
    expect((gBox?.y ?? 0) < (emailBox?.y ?? 0)).toBe(true);
    await google.click();
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByTestId("account-name")).toHaveText(api.account.display_name);
    expect(api.callsTo("startGoogleSignIn")[0]?.body).toEqual({ intent: "signup" });
  });

  test("sign-in passes next; an existing unlinked email is explained", async ({ page, api }) => {
    api.googleEnabled = true;
    await playGoogle(page, api, "/signin?google_error=email_exists");
    await page.goto("/payments");
    await expect(page).toHaveURL(/\/signin\?next=/);
    const google = page.getByRole("button", { name: "Continue with Google" });
    const gBox = await google.boundingBox();
    const pkBox = await page.getByRole("button", { name: "Sign in with passkey" }).boundingBox();
    expect((gBox?.y ?? 0) < (pkBox?.y ?? 0)).toBe(true);
    await google.click();
    await expect(page.getByTestId("google-error")).toContainText(
      "This email already has a NearPay account. Sign in with your passkey, then connect Google in Settings.",
    );
    expect(api.callsTo("startGoogleSignIn")[0]?.body).toEqual({ intent: "signin", next: "/payments" });
  });

  test("Settings: connect needs a step-up; disconnect asks first", async ({ page, api }) => {
    api.googleEnabled = true;
    await playGoogle(page, api, "/settings/account?google=linked", () => {
      api.linked = [{ object: "linked_identity", provider: "google", email: "me@gmail.example", created: 1 }];
    });
    await signIn(page, api, "/settings/account");
    await page.getByRole("button", { name: "Connect Google" }).click();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page).toHaveURL(/google=linked/);
    await expect(page.getByTestId("sign-in-methods-notice")).toContainText("Google connected");
    await expect(page.getByTestId("google-method")).toContainText("me@gmail.example");
    expect(api.callsTo("startGoogleLink")).toHaveLength(2); // 401 step_up_required, then the replay

    await page.getByRole("button", { name: "Disconnect Google" }).click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByTestId("sign-in-methods-notice")).toContainText("Google disconnected");
    expect(api.callsTo("unlinkIdentity")).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Connect Google" })).toBeVisible();
  });

  test("a Google-only user hitting a step-up adds a passkey, which confirms the action", async ({ page, api }) => {
    api.googleEnabled = true;
    await signIn(page, api, "/developers");
    // the session turns into a fresh Google-only one (as after Continue with Google)
    api.signInMethod = "google";
    api.passkeys = 0;
    api.passkeySetupUntil = Math.floor(Date.now() / 1000) + 600;
    await page.reload();
    await page.getByRole("button", { name: "Create key" }).click();
    await page.getByLabel("Name").fill("Backend");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add a passkey to continue" })).toBeVisible();
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByTestId("secret-value")).toHaveText(/^sk_test_/);
    await expect(page.getByRole("heading", { name: "Add a passkey to continue" })).toHaveCount(0);
    expect(api.callsTo("passkeyRegistrationVerify")).toHaveLength(1);
    expect(api.callsTo("stepUpVerify")).toHaveLength(1);
    expect(api.callsTo("createApiKey")).toHaveLength(2);
  });
});
