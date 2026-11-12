/**
 * Continue with Google in the dashboard (ADR-0026). Google and identity's callback are played by
 * intercepting the Google URL the mock API returns: the "callback" answers with the redirect identity
 * would send (signed in → /setup, refused → /signin?google_error=…, linked → /settings/account?google=linked).
 */
import { expect, signIn, test } from "../../../test/e2e/harness";
import type { MockApi } from "../../../test/e2e/mock-api";

const GOOGLE = "https://accounts.google.test/**";

/**
 * Google + identity's callback: `outcome` is the dashboard path identity redirects to (a list: one per
 * visit to Google, the last one repeats). Returns the Google URLs visited, in order.
 */
async function playGoogle(
  page: import("@playwright/test").Page,
  api: MockApi,
  outcome: string | readonly string[],
  effect?: (visit: number) => void,
): Promise<string[]> {
  const outcomes = typeof outcome === "string" ? [outcome] : outcome;
  const visited: string[] = [];
  await page.route(GOOGLE, async (r) => {
    visited.push(r.request().url());
    const i = Math.min(visited.length, outcomes.length) - 1;
    effect?.(visited.length);
    await r.fulfill({ status: 302, headers: { location: `http://localhost:4180${outcomes[i]}` } });
  });
  void api;
  return visited;
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
    await playGoogle(page, api, "/signin?google_error=email_exists&next=%2Fpayments");
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
    // the error is read once: the URL keeps next, loses google_error
    await expect(page).toHaveURL(/\/signin\?next=%2Fpayments$/);
  });

  test("sign-up email_exists: shown once, URL cleaned, a different Google account starts a new flow", async ({
    page,
    api,
  }) => {
    api.googleEnabled = true;
    const visited = await playGoogle(page, api, ["/signup?google_error=email_exists", "/setup"], (visit) => {
      if (visit === 2) {
        api.signedIn = true;
        api.signInMethod = "google";
        api.passkeys = 0;
        api.passkeySetupUntil = Math.floor(Date.now() / 1000) + 600;
      }
    });
    await page.goto("/signup");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    const callout = page.getByTestId("google-error");
    await expect(callout).toContainText("This email already has a NearPay account.");
    await expect(callout).toHaveAttribute("role", "alert");
    await expect(page).toHaveURL(/\/signup$/);
    // a reload shows no stale error
    await page.reload();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByTestId("google-error")).toHaveCount(0);
    // back to the error (as after Google again), then "Use a different Google account"
    await page.goto("/signup?google_error=email_exists");
    await expect(page.getByTestId("google-error-passkey")).toHaveText("Sign in with passkey");
    await page.getByRole("button", { name: "Use a different Google account" }).click();
    await expect(page).toHaveURL(/\/setup$/);
    expect(api.callsTo("startGoogleSignIn").map((c) => c.body)).toEqual([{ intent: "signup" }, { intent: "signup" }]);
    // every attempt is a new flow (new state); identity asks Google for the account chooser
    expect(new Set(visited).size).toBe(visited.length);
  });

  test("email_exists: Sign in with passkey opens sign-in with the passkey option focused", async ({ page, api }) => {
    api.googleEnabled = true;
    await page.goto("/signup?google_error=email_exists");
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByTestId("passkey-hint")).toContainText("connect Google in Settings");
    await expect(page.getByTestId("passkey-submit")).toBeFocused();
    await expect(page.getByTestId("google-error")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("account-name")).toHaveText(api.account.display_name);
    expect(api.callsTo("startGoogleSignIn")).toHaveLength(0);
  });

  test("sign-in: a generic Google error offers Try again, and the Google button works on every retry", async ({
    page,
    api,
  }) => {
    api.googleEnabled = true;
    await playGoogle(page, api, [
      "/signin?google_error=cancelled&next=%2Fpayments",
      "/signin?google_error=unavailable&next=%2Fpayments",
      "/signin?google_error=state_invalid&next=%2Fpayments",
    ]);
    await page.goto("/signin?next=%2Fpayments");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByTestId("google-error")).toContainText("canceled");
    await expect(page).toHaveURL(/\/signin\?next=%2Fpayments$/);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("google-error")).toContainText("couldn't be reached");
    const google = page.getByRole("button", { name: "Continue with Google" });
    await expect(google).toBeEnabled();
    await google.click();
    await expect(page.getByTestId("google-error")).toContainText("expired");
    expect(api.callsTo("startGoogleSignIn").map((c) => c.body)).toEqual([
      { intent: "signin", next: "/payments" },
      { intent: "signin", next: "/payments" },
      { intent: "signin", next: "/payments" },
    ]);
  });

  test("Back from Google: the button is not left busy", async ({ page, api }) => {
    api.googleEnabled = true;
    await page.route(GOOGLE, (r) =>
      r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Google</title><p>chooser</p>" }),
    );
    await page.goto("/signin");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/accounts\.google\.test/);
    await page.goBack();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  test("already signed in (another tab): Continue with Google shows the signed-in choices, not Google", async ({
    page,
    api,
  }) => {
    api.googleEnabled = true;
    await page.goto("/signup");
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    api.signedIn = true; // signed in elsewhere after this page loaded
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByTestId("signed-in-choices")).toBeVisible();
    expect(api.callsTo("startGoogleSignIn")).toHaveLength(0);
  });

  test("signed in, Google refused: sign-in goes on to next and says why; sign-up shows it once", async ({
    page,
    api,
  }) => {
    await signIn(page, api, "/");
    await page.goto("/signin?google_error=email_exists&next=%2Fpayments");
    await expect(page).toHaveURL(/\/payments$/);
    await expect(page.getByText("Google sign-in didn't change anything")).toBeVisible();
    await page.goto("/signup?google_error=identity_in_use");
    await expect(page.getByTestId("signed-in-choices")).toBeVisible();
    await expect(page.getByTestId("google-error")).toContainText("already connected to another NearPay user");
    await expect(page).toHaveURL(/\/signup$/);
    await page.reload();
    await expect(page.getByTestId("signed-in-choices")).toBeVisible();
    await expect(page.getByTestId("google-error")).toHaveCount(0);
  });

  test("Settings: link errors show once, the URL is cleaned, Connect Google works again", async ({ page, api }) => {
    api.googleEnabled = true;
    await playGoogle(
      page,
      api,
      ["/settings/account?google_error=identity_in_use", "/settings/account?google=linked"],
      (visit) => {
        if (visit === 2)
          api.linked = [{ object: "linked_identity", provider: "google", email: "me@gmail.example", created: 1 }];
      },
    );
    await signIn(page, api, "/settings/account");
    await page.getByRole("button", { name: "Connect Google" }).click();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page.getByTestId("sign-in-methods-notice")).toContainText("already connected to another NearPay user");
    await expect(page).toHaveURL(/\/settings\/account$/);
    await page.reload();
    await expect(page.getByRole("button", { name: "Connect Google" })).toBeVisible();
    await expect(page.getByTestId("sign-in-methods-notice")).toHaveCount(0);
    // retry: the stepped-up session is still fresh, so straight to Google, which now links
    await page.getByRole("button", { name: "Connect Google" }).click();
    await expect(page.getByTestId("sign-in-methods-notice")).toContainText("Google connected");
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(page.getByTestId("google-method")).toContainText("me@gmail.example");
  });

  test("Settings: a step-up canceled on Connect can be retried; already linked elsewhere refreshes", async ({
    page,
    api,
  }) => {
    api.googleEnabled = true;
    await signIn(page, api, "/settings/account");
    await page.getByRole("button", { name: "Connect Google" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("error-note")).toContainText("Confirmation canceled.");
    // linked from another tab meanwhile: the API answers google_already_linked
    api.linked = [{ object: "linked_identity", provider: "google", email: "me@gmail.example", created: 1 }];
    await page.getByRole("button", { name: "Connect Google" }).click();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page.getByTestId("sign-in-methods-notice")).toContainText("already connected");
    await expect(page.getByTestId("google-method")).toContainText("me@gmail.example");
    await expect(page.getByTestId("error-note")).toHaveCount(0);
  });

  test("Settings: back from Google to add a passkey says what to do, once", async ({ page, api }) => {
    api.googleEnabled = true;
    await signIn(page, api, "/settings/account?add_passkey=1");
    await expect(page.getByTestId("sign-in-methods-notice")).toContainText("Add your passkey");
    await expect(page).toHaveURL(/\/settings\/account$/);
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
