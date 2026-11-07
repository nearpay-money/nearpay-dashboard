import { expect, signIn, test } from "./harness";

test.describe("auth", () => {
  test("redirects to sign-in, signs in with a passkey and keeps the session across reloads", async ({ page, api }) => {
    await signIn(page, api, "/payments");
    await expect(page).toHaveURL(/\/payments$/);
    const verify = api.callsTo("passkeyAuthenticationVerify")[0]?.body as { credential: { type: string } } | undefined;
    expect(verify?.credential.type).toBe("public-key");
    // nothing is kept in web storage: the reload recovers the session from the cookie (spec 0.1.5)
    expect(await page.evaluate(() => [sessionStorage.length, localStorage.length])).toEqual([0, 0]);
    const restores = api.callsTo("getDashboardSession").length;
    await page.reload();
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    expect(api.callsTo("getDashboardSession")).toHaveLength(restores + 1);
    await expect(page.getByTestId("account-name")).toHaveText(api.account.display_name);
    // every call carries the mode header; reads carry no CSRF
    const get = api.callsTo("listPaymentIntents").at(-1);
    expect(get?.headers["nearpay-mode"]).toBe("test");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin/);
    expect(api.callsTo("logout")[0]?.headers["x-csrf-token"]).toBe(api.csrf);
  });

  test("a new tab recovers the session and its CSRF token from the cookie", async ({ page, api }) => {
    await signIn(page, api, "/developers");
    const tab = await page.context().newPage();
    await api.install(tab);
    await tab.goto("/developers");
    await expect(tab.getByTestId("account-name")).toHaveText(api.account.display_name);
    await expect(tab).toHaveURL(/\/developers$/);
    // an unsafe request from the new tab carries the recovered CSRF token
    await tab.getByRole("button", { name: "Sign out" }).click();
    await expect(tab).toHaveURL(/\/signin/);
    expect(api.callsTo("logout").at(-1)?.headers["x-csrf-token"]).toBe(api.csrf);
    await tab.close();
  });

  test("a stale sessionStorage copy from an older build is removed, not trusted", async ({ page, api }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem(
        "np.dashboard.session",
        JSON.stringify({ object: "dashboard_session", csrf_token: "x".repeat(43), expires_at: 4_000_000_000 }),
      ),
    );
    await page.goto("/payments");
    await expect(page).toHaveURL(/\/signin/);
    expect(api.callsTo("getDashboardSession")).toHaveLength(1);
    expect(await page.evaluate(() => sessionStorage.getItem("np.dashboard.session"))).toBeNull();
  });

  test("sign-up: Turnstile token, magic link, passkey registration, new account", async ({ page, api }) => {
    await page.goto("/signup");
    await page.getByLabel("Work email").fill("owner@acme.example");
    await page.getByRole("button", { name: "Email me a sign-up link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    expect(api.callsTo("signup")[0]?.body).toEqual({
      email: "owner@acme.example",
      turnstile_token: "turnstile-test-token",
    });

    await page.goto("/auth/verify#token=magic-token-0123456789");
    await expect(page.getByText("Email verified")).toBeVisible();
    expect(page.url()).not.toContain("magic-token");
    await page.getByLabel("Business name").fill("Bean There");
    await page.getByRole("button", { name: "Create passkey and open dashboard" }).click();
    await expect(page.getByTestId("account-name")).toHaveText("Bean There");
    const reg = api.callsTo("passkeyRegistrationVerify")[0]?.body as {
      display_name: string;
      registration_token: string;
    };
    expect(reg.display_name).toBe("Bean There");
    expect(reg.registration_token.length).toBeGreaterThanOrEqual(32);
  });

  test("an expired magic link shows an error", async ({ page, api }) => {
    expect(api.signedIn).toBe(false);
    await page.goto("/auth/verify#token=wrong-token-0000000000");
    await expect(page.getByRole("alert")).toContainText("link_expired");
  });

  test("a revoked session sends the user back to sign-in", async ({ page, api }) => {
    await signIn(page, api);
    await expect(page.getByTestId("volume-chart")).toBeVisible(); // overview requests have settled
    api.signedIn = false;
    await page.getByRole("link", { name: "Payments", exact: true }).click();
    await expect(page).toHaveURL(/\/signin/);
  });
});
