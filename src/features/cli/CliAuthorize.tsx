/**
 * `/cli/authorize?code=XXXX-XXXX` (lld/identity.md §6.2, §19; spec `getCliLogin`, `approveCliLogin`,
 * `denyCliLogin`): the device-authorization page `nearpay login` opens. It shows where the request came
 * from (device name, IP, country, user agent, time) so the user can recognise it, asks them to compare
 * the code with their terminal, and approves (passkey step-up, replayed by the API client) or denies.
 * Approval mints a restricted **test-mode** key for the signed-in account — never live access.
 * 404 = unknown, expired more than a day ago, or another account's request; 409 = already decided.
 */
import { approveCliLogin, type CliLoginRequest, denyCliLogin, getCliLogin, type z } from "@nearpay/spec";
import { Button, Callout, Field, Input, KeyValueList, LiveRegion, StatusBadge } from "@nearpay-internal/ui";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { ApiError, StepUpCanceled } from "../../lib/errors";
import { formatWhen, relative } from "../../lib/format";
import { useAsync, useNow } from "../../lib/hooks";
import { roleAllows } from "../../lib/permissions";
import { statusOf } from "../../lib/status";
import { AuthLayout } from "../../ui/auth";
import { ErrorNote } from "../../ui/ui";
import "../billing/billing.css";
import { countryName, loginView, normalizeUserCode } from "./logic";

export function CliAuthorize() {
  const app = useApp();
  const code = normalizeUserCode(new URLSearchParams(app.location.search).get("code"));
  if (!roleAllows(getCliLogin, app.session?.role))
    return (
      <AuthLayout>
        <h1 className="np-text-h3">Authorize NearPay CLI</h1>
        <Callout tone="neutral" title="Not available for your role">
          Only owners, admins and developers can connect the CLI. Ask one of them, or switch to an account where you
          have that role.
        </Callout>
        <Link to="/">Go to the dashboard</Link>
      </AuthLayout>
    );
  return <AuthLayout>{code ? <LoginRequest key={code} code={code} /> : <EnterCode />}</AuthLayout>;
}

function EnterCode() {
  const app = useApp();
  const [value, setValue] = useState(() => new URLSearchParams(app.location.search).get("code") ?? "");
  const [touched, setTouched] = useState(false);
  const code = normalizeUserCode(value);
  return (
    <>
      <h1 className="np-text-h3">Authorize NearPay CLI</h1>
      <p className="np-text-secondary">Enter the code shown in your terminal after running nearpay login.</p>
      <form
        className="dash-form"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (code) app.navigate(`/cli/authorize?code=${code}`, { replace: true });
        }}
      >
        <Field label="Code" error={touched && !code ? "Enter the 8-letter code, like BCDF-GHJK." : undefined}>
          <Input
            value={value}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            onChange={(e) => setValue(e.target.value)}
            data-testid="cli-code-input"
          />
        </Field>
        <Button type="submit">Continue</Button>
      </form>
    </>
  );
}

function LoginRequest({ code }: { code: string }) {
  const app = useApp();
  const req = useAsync(() => app.api.call(getCliLogin, { params: { code } }), [app.api, code]);
  const [decided, setDecided] = useState<z.output<typeof CliLoginRequest>>();
  const [busy, setBusy] = useState<"approve" | "deny">();
  const [error, setError] = useState<unknown>();
  const [announce, setAnnounce] = useState("");
  const now = useNow(1000);
  const login = decided ?? req.data;

  if (req.loading && !login)
    return (
      <p role="status" className="np-text-secondary">
        Looking up the login request…
      </p>
    );
  if (req.error instanceof ApiError && req.error.status === 404)
    return (
      <>
        <h1 className="np-text-h3">Login request not found</h1>
        <Callout tone="warning" title={`We couldn't find a pending request for ${code}`} role="alert">
          The code may be mistyped, older than 15 minutes, or started for another NearPay account. Run nearpay login
          again; if you have several accounts, sign in to the right one first.
        </Callout>
        <Link to="/cli/authorize">Enter a different code</Link>
      </>
    );
  if (req.error || !login)
    return (
      <>
        <h1 className="np-text-h3">Authorize NearPay CLI</h1>
        <ErrorNote error={req.error} onRetry={req.reload} />
      </>
    );

  const view = loginView(login.status, login.expires_at, now);
  const account = app.account?.display_name ?? app.session?.account.display_name ?? "your account";
  const decide = async (what: "approve" | "deny") => {
    setBusy(what);
    setError(undefined);
    try {
      const r = await app.api.call(what === "approve" ? approveCliLogin : denyCliLogin, { params: { code }, body: {} });
      setDecided(r);
      setAnnounce(what === "approve" ? "CLI approved. Return to your terminal." : "Request denied.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "state_conflict") {
        setDecided(undefined);
        req.reload();
      }
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };
  const s = statusOf("cli_login", view === "pending" ? "pending" : view);
  const where = [login.requested_from.ip, countryName(login.requested_from.country)].filter(Boolean).join(" · ");

  return (
    <div className="np-stack np-stack--lg" data-testid="cli-authorize">
      <LiveRegion>{announce}</LiveRegion>
      <div className="np-stack np-stack--sm">
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
        <h1 className="np-text-h3">Authorize NearPay CLI</h1>
        <p className="np-text-secondary">
          {view === "pending"
            ? `Check that this code matches the one in your terminal before you approve.`
            : view === "approved"
              ? "Approved. Return to your terminal — the CLI picks up its key automatically."
              : view === "denied"
                ? "You denied this request. The CLI gets no access."
                : "This request expired. Run nearpay login again to get a new code."}
        </p>
      </div>
      <p className="npf-cli__code" data-testid="cli-code">
        <span className="np-sr-only">Code: {code.split("").join(" ")}</span>
        <span aria-hidden="true">{code}</span>
      </p>
      <KeyValueList
        items={[
          { label: "Device", value: login.device_name },
          { label: "Requested from", value: where || "Unknown" },
          { label: "Client", value: login.requested_from.user_agent ?? "Unknown" },
          { label: "Requested", value: `${formatWhen(login.created)} (${relative(login.created, now)})` },
          ...(view === "pending" ? [{ label: "Expires", value: relative(login.expires_at, now) }] : []),
          { label: "Account", value: account },
        ]}
      />
      {error instanceof ApiError && error.code === "state_conflict" ? (
        <Callout tone="warning" title="This request was already handled" role="alert">
          It was approved, denied or expired in the meantime — nothing was changed. The current status is shown above.
        </Callout>
      ) : error instanceof StepUpCanceled ? (
        <Callout tone="neutral" title="Confirmation canceled" role="alert">
          Nothing was approved. You can try again while the request is pending.
        </Callout>
      ) : (
        <ErrorNote error={error} />
      )}
      {view === "pending" ? (
        <>
          <Callout tone="warning" title="Only approve a login you just started">
            Approving creates a restricted test-mode API key for {account}, valid for 90 days. It can read test data and
            create test payments, refunds and invoices — never live funds. If you didn't run nearpay login on{" "}
            {login.device_name} just now, deny this request.
          </Callout>
          <p className="np-text-small np-text-secondary">You'll confirm with your passkey.</p>
          <div className="npf-cli__actions">
            <Button
              variant="secondary"
              loading={busy === "deny"}
              disabled={busy !== undefined}
              onClick={() => void decide("deny")}
              data-testid="cli-deny"
            >
              Deny
            </Button>
            <Button
              loading={busy === "approve"}
              loadingText="Confirming…"
              disabled={busy !== undefined}
              onClick={() => void decide("approve")}
              data-testid="cli-approve"
            >
              Approve
            </Button>
          </div>
        </>
      ) : null}
      {view === "approved" ? (
        <p className="np-text-small np-text-secondary">
          The key is listed as “CLI · {login.device_name}” in <Link to="/developers">Developers → API keys</Link>, where
          you can revoke it at any time.
        </p>
      ) : (
        <Link to="/">Go to the dashboard</Link>
      )}
    </div>
  );
}
