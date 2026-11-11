/**
 * Settings: the index of link cards (team, business details, checkout appearance, notifications, account —
 * cards come from the feature registry) plus the core pages Account & payments (`updateAccount`; money
 * settings need a step-up, which the API asks for) and Notifications.
 */

import { Card, Checkbox, ChevronRightIcon, Input, Select, useToast } from "@nearpay-internal/ui";
import { updateAccount } from "@nearpay-money/spec";
import { useEffect, useState } from "react";
import { type Account, Link, useApp } from "../../app/context";
import type { SettingsCard } from "../../app/registry";
import { useMutation } from "../../lib/hooks";
import { ErrorState, LoadingState, Page, Section } from "../../ui/page";
import { Badge, Button, ErrorNote, Field, KeyValue, Mono } from "../../ui/ui";
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

/** Core cards; a feature module may declare a card with the same href to replace one. */
export const CORE_CARDS: readonly SettingsCard[] = [
  {
    id: "core:team",
    title: "Team & approvals",
    description: "Invite members, set roles and approve sensitive changes.",
    href: "/settings/team",
    order: 10,
  },
  {
    id: "core:business",
    title: "Business details",
    description: "Declare your business to turn on live payments.",
    href: "/settings/business",
    order: 20,
  },
  {
    id: "core:appearance",
    title: "Checkout appearance",
    description: "Make checkout feel like part of your business.",
    href: "/settings/appearance",
    order: 30,
  },
  {
    id: "core:notifications",
    title: "Notifications",
    description: "Customer receipts and payment notifications to your server.",
    href: "/settings/notifications",
    order: 40,
  },
  {
    id: "core:account",
    title: "Account & payments",
    description: "Display name, who pays fees, late payments and passkeys.",
    href: "/settings/account",
    order: 50,
  },
];

/** Registry cards whose page exists, one per href (a feature module's card wins over the core one). */
export function settingsCards(cards: readonly SettingsCard[], hasPath: (p: string) => boolean): SettingsCard[] {
  const byHref = new Map<string, SettingsCard>();
  for (const c of cards) {
    const prev = byHref.get(c.href);
    if (!prev || (prev.id.startsWith("core:") && !c.id.startsWith("core:"))) byHref.set(c.href, c);
  }
  return [...byHref.values()]
    .filter((c) => hasPath(c.href))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
}

export function SettingsIndex() {
  const app = useApp();
  const cards = settingsCards(app.registry.settingsCards, app.registry.hasPath);
  return (
    <Page title="Settings" subtitle="Your team, business details, checkout and notifications.">
      <ul className="dash-link-cards" aria-label="Settings">
        {cards.map((c) => (
          <li key={c.href}>
            <Link to={c.href} className="dash-link-card" data-testid={`settings-card-${c.href.split("/").pop()}`}>
              <span className="dash-link-card__text">
                <span className="dash-link-card__title">{c.title}</span>
                <span className="dash-link-card__desc">{c.description}</span>
              </span>
              <ChevronRightIcon size={20} />
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}

export function AccountSettings() {
  const app = useApp();
  const toast = useToast();
  const a = app.account;
  const [form, setForm] = useState<Form>();
  const [saved, setSaved] = useState(false);
  const [pkMsg, setPkMsg] = useState<string>();

  useEffect(() => {
    if (a) setForm(toForm(a));
  }, [a]);

  const body = a && form ? diffAccount(a, form) : {};
  const save = useMutation(async () => {
    await app.api.call(updateAccount, { body: body as never });
    setSaved(true);
    app.refreshAccount();
    toast.show({ tone: "success", title: "Settings saved" });
  });
  const passkey = useMutation(async () => {
    await registerPasskey(app.api, { passkeyName: "Additional passkey" });
    setPkMsg("Passkey added.");
  });

  if (!a && app.accountError)
    return <ErrorState title="Account & payments" error={app.accountError} onRetry={app.refreshAccount} />;
  if (!a || !form) return <LoadingState what="Loading settings" />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };
  const brandingHere = !app.registry.hasPath("/settings/appearance");
  return (
    <Page
      title="Account & payments"
      subtitle="How your account and checkout behave."
      back={{ label: "Settings", to: "/settings" }}
      width="narrow"
    >
      <Section title="Account" level={3}>
        <KeyValue
          rows={[
            ["Account ID", <Mono key="id">{a.id}</Mono>],
            [
              "Legal name",
              a.verified_legal_name
                ? `${a.verified_legal_name} · Self-declared business details`
                : "Shown once you save your business details",
            ],
            ["Business details", <Badge key="k" kind="kyb" value={a.kyb_status} />],
            ["Live mode", a.live_enabled ? "Enabled" : "Not enabled"],
            ["API version", a.api_version],
            ["Your role", app.session?.role ? app.session.role.replace(/^./, (c) => c.toUpperCase()) : "—"],
          ]}
        />
      </Section>
      <Section title="Business and checkout" level={3}>
        <form
          className="dash-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run();
          }}
        >
          <div className="dash-form-grid">
            <Field label="Display name">
              {(id) => (
                <Input
                  id={id}
                  maxLength={100}
                  value={form.display_name}
                  onChange={(e) => set("display_name", e.target.value)}
                />
              )}
            </Field>
            <Field label="Country (ISO code)">
              {(id) => (
                <Input id={id} maxLength={2} value={form.country} onChange={(e) => set("country", e.target.value)} />
              )}
            </Field>
            <Field label="Who pays NearPay's fee" hint="Needs a passkey confirmation.">
              {(id) => (
                <Select
                  id={id}
                  value={form.fee_bearer}
                  onChange={(e) => set("fee_bearer", e.target.value as Form["fee_bearer"])}
                >
                  <option value="payer">Payer (added on top)</option>
                  <option value="merchant">Merchant (deducted)</option>
                </Select>
              )}
            </Field>
            <Field label="Underpayment tolerance (bps, 0–100)" hint="Needs a passkey confirmation.">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  numeric
                  value={form.underpay_tolerance_bps}
                  onChange={(e) => set("underpay_tolerance_bps", Math.trunc(Number(e.target.value)))}
                />
              )}
            </Field>
            <Field label="Default session lifetime (seconds)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={300}
                  max={86400}
                  step={60}
                  numeric
                  value={form.session_ttl_default}
                  onChange={(e) => set("session_ttl_default", Math.trunc(Number(e.target.value)))}
                />
              )}
            </Field>
            {brandingHere ? (
              <>
                <Field label="Accent colour (#RRGGBB)">
                  {(id) => (
                    <Input id={id} value={form.accent_color} onChange={(e) => set("accent_color", e.target.value)} />
                  )}
                </Field>
                <Field label="Logo URL (HTTPS)">
                  {(id) => (
                    <Input id={id} type="url" value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} />
                  )}
                </Field>
              </>
            ) : null}
          </div>
          <Checkbox
            label="Accept late payments (settlements after a session expired) — needs a passkey confirmation"
            checked={form.late_payments}
            onChange={(e) => set("late_payments", e.target.checked)}
          />
          <div className="np-row">
            <Button
              type="submit"
              busy={save.busy}
              blocked={app.gate(updateAccount)}
              disabled={Object.keys(body).length === 0}
            >
              Save changes
            </Button>
            <span role="status" className="np-text-secondary">
              {saved ? "Saved." : ""}
            </span>
          </div>
          <ErrorNote error={save.error} />
        </form>
      </Section>
      <Section title="Passkeys" level={3}>
        <p className="np-text-secondary">Add a passkey on another device so you can always sign in.</p>
        <div className="np-row">
          <Button variant="secondary" busy={passkey.busy} onClick={() => void passkey.run()}>
            Add a passkey
          </Button>
          <span role="status" className="np-text-secondary">
            {pkMsg ?? ""}
          </span>
        </div>
        <ErrorNote error={passkey.error} />
      </Section>
    </Page>
  );
}

export function NotificationSettings() {
  const app = useApp();
  const toast = useToast();
  const a = app.account;
  const save = useMutation(async (on: boolean) => {
    await app.api.call(updateAccount, { body: { settings: { email_receipts: on } } });
    app.refreshAccount();
    toast.show({ tone: "success", title: on ? "Customer receipts on" : "Customer receipts off" });
  });
  if (!a && app.accountError)
    return <ErrorState title="Notifications" error={app.accountError} onRetry={app.refreshAccount} />;
  if (!a) return <LoadingState what="Loading notification settings" />;
  return (
    <Page
      title="Notifications"
      subtitle="Who hears about payments, and how."
      back={{ label: "Settings", to: "/settings" }}
      width="narrow"
    >
      <Card as="section" aria-label="Customer receipts">
        <div className="np-stack">
          <Checkbox
            label="Email receipts to customers"
            description="When a payer leaves an email at checkout, NearPay emails a receipt after settlement is verified."
            checked={a.settings.email_receipts}
            disabled={save.busy || Boolean(app.gate(updateAccount))}
            onChange={(e) => void save.run(e.target.checked)}
          />
          <ErrorNote error={save.error} />
        </div>
      </Card>
      <Card as="section" aria-label="Payment notifications to your server">
        <div className="np-stack">
          <p className="np-text-h4">Payment notifications to your server</p>
          <p className="np-text-secondary">
            Signed webhook events tell your systems when payments, refunds and destinations change.
          </p>
          <p>
            <Link to="/developers/webhooks">Manage webhook endpoints</Link>
          </p>
        </div>
      </Card>
      <p className="np-text-caption np-text-secondary">
        Every owner is notified when a settlement destination is added.
      </p>
    </Page>
  );
}
