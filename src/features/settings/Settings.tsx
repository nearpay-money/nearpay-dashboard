import { updateAccount } from "@nearpay/spec";
import { useEffect, useState } from "react";
import { type Account, useApp } from "../../app/context";
import { Badge, Button, Card, ErrorNote, Field, KeyValue, Loading, Mono, Note } from "../../ui/ui";
import { registerPasskey } from "../auth/passkeys";

interface Form {
  display_name: string;
  country: string;
  fee_bearer: "payer" | "merchant";
  late_payments: boolean;
  underpay_tolerance_bps: number;
  session_ttl_default: number;
  email_receipts: boolean;
  accent_color: string;
  logo_url: string;
}

const toForm = (a: Account): Form => ({
  display_name: a.display_name,
  country: a.country ?? "",
  fee_bearer: a.fee_bearer,
  late_payments: a.settings.late_payments,
  underpay_tolerance_bps: a.settings.underpay_tolerance_bps,
  session_ttl_default: a.settings.session_ttl_default,
  email_receipts: a.settings.email_receipts,
  accent_color: a.settings.branding.accent_color ?? "",
  logo_url: a.settings.branding.logo_url ?? "",
});

/** Only changed fields are sent (money-behaviour fields need a step-up; identity asks for it). */
export function diffAccount(a: Account, f: Form) {
  const o = toForm(a);
  const body: Record<string, unknown> = {};
  const settings: Record<string, unknown> = {};
  const branding: Record<string, unknown> = {};
  if (f.display_name !== o.display_name) body.display_name = f.display_name.trim();
  if (f.country !== o.country && f.country) body.country = f.country.toUpperCase();
  if (f.fee_bearer !== o.fee_bearer) body.fee_bearer = f.fee_bearer;
  if (f.late_payments !== o.late_payments) settings.late_payments = f.late_payments;
  if (f.underpay_tolerance_bps !== o.underpay_tolerance_bps) settings.underpay_tolerance_bps = f.underpay_tolerance_bps;
  if (f.session_ttl_default !== o.session_ttl_default) settings.session_ttl_default = f.session_ttl_default;
  if (f.email_receipts !== o.email_receipts) settings.email_receipts = f.email_receipts;
  if (f.accent_color !== o.accent_color) branding.accent_color = f.accent_color || null;
  if (f.logo_url !== o.logo_url) branding.logo_url = f.logo_url || null;
  if (Object.keys(branding).length) settings.branding = branding;
  if (Object.keys(settings).length) body.settings = settings;
  return body;
}

export function Settings() {
  const app = useApp();
  const a = app.account;
  const [form, setForm] = useState<Form>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pkBusy, setPkBusy] = useState(false);
  const [pkMsg, setPkMsg] = useState<string>();
  const [pkError, setPkError] = useState<unknown>();

  useEffect(() => {
    if (a) setForm(toForm(a));
  }, [a]);

  if (!a || !form) return <Loading />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };
  const body = diffAccount(a, form);
  return (
    <div className="page">
      <h1>Settings</h1>
      <Card title="Account">
        <KeyValue
          rows={[
            ["Account", <Mono key="id">{a.id}</Mono>],
            ["Verified legal name", a.verified_legal_name ?? "— (shown after KYB)"],
            ["KYB", <Badge key="k" value={a.kyb_status} />],
            ["Live mode", a.live_enabled ? "enabled" : "not enabled"],
            ["API version", a.api_version],
            ["Your role", app.session?.role ?? "—"],
          ]}
        />
      </Card>
      <Card title="Business and checkout">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            try {
              await app.api.call(updateAccount, { body: body as never });
              setSaved(true);
              app.refreshAccount();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid-2">
            <Field label="Display name">
              {(id) => (
                <input
                  id={id}
                  maxLength={100}
                  value={form.display_name}
                  onChange={(e) => set("display_name", e.target.value)}
                />
              )}
            </Field>
            <Field label="Country (ISO code)">
              {(id) => (
                <input id={id} maxLength={2} value={form.country} onChange={(e) => set("country", e.target.value)} />
              )}
            </Field>
            <Field label="Who pays NearPay's fee" hint="Needs a passkey confirmation.">
              {(id) => (
                <select
                  id={id}
                  value={form.fee_bearer}
                  onChange={(e) => set("fee_bearer", e.target.value as Form["fee_bearer"])}
                >
                  <option value="payer">Payer (added on top)</option>
                  <option value="merchant">Merchant (deducted)</option>
                </select>
              )}
            </Field>
            <Field label="Underpayment tolerance (bps, 0–100)" hint="Needs a passkey confirmation.">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={form.underpay_tolerance_bps}
                  onChange={(e) => set("underpay_tolerance_bps", Math.trunc(Number(e.target.value)))}
                />
              )}
            </Field>
            <Field label="Default session lifetime (seconds)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={300}
                  max={86400}
                  step={60}
                  value={form.session_ttl_default}
                  onChange={(e) => set("session_ttl_default", Math.trunc(Number(e.target.value)))}
                />
              )}
            </Field>
            <Field label="Accent colour (#RRGGBB)">
              {(id) => (
                <input id={id} value={form.accent_color} onChange={(e) => set("accent_color", e.target.value)} />
              )}
            </Field>
            <Field label="Logo URL (HTTPS)">
              {(id) => (
                <input id={id} type="url" value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} />
              )}
            </Field>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={form.late_payments}
              onChange={(e) => set("late_payments", e.target.checked)}
            />{" "}
            Accept late payments (settlements after a session expired) — needs a passkey confirmation
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.email_receipts}
              onChange={(e) => set("email_receipts", e.target.checked)}
            />{" "}
            Email receipts to customers
          </label>
          <Button type="submit" busy={busy} blocked={app.gate(updateAccount)} disabled={Object.keys(body).length === 0}>
            Save changes
          </Button>
          {saved && <Note tone="ok">Saved.</Note>}
          <ErrorNote error={error} />
        </form>
      </Card>
      <Card title="Passkeys">
        <p className="muted">Add a passkey on another device so you can always sign in.</p>
        <Button
          variant="secondary"
          busy={pkBusy}
          onClick={async () => {
            setPkBusy(true);
            setPkError(undefined);
            setPkMsg(undefined);
            try {
              await registerPasskey(app.api, { passkeyName: "Additional passkey" });
              setPkMsg("Passkey added.");
            } catch (e) {
              setPkError(e);
            } finally {
              setPkBusy(false);
            }
          }}
        >
          Add a passkey
        </Button>
        {pkMsg && <Note tone="ok">{pkMsg}</Note>}
        <ErrorNote error={pkError} />
      </Card>
    </div>
  );
}
