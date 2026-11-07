/**
 * Checkout appearance (Figma b04): display name, accent colour, theme and corner style with a live
 * preview themed by the ui `ThemeRoot` / `applyAppearance` (CSSOM only, CSP-safe). Saved to the account
 * (`updateAccount`: `display_name`, `settings.branding.accent_color`). Theme and corner style have no
 * account setting in spec 0.2.0, so they are preview-only and labelled as such.
 */
import { updateAccount } from "@nearpay/spec";
import { Button, Callout, Card, Field, Input, LiveRegion, PageHeader, Select, ThemeRoot } from "@nearpay-internal/ui";
import { useEffect, useState } from "react";
import { useApp } from "../../app/context";
import { roleAllows } from "../../lib/permissions";
import {
  accentAdjusted,
  accentName,
  CORNERS,
  DEFAULT_ACCENT,
  normalizeHex,
  PRESETS,
  THEMES,
  updateBody,
  validate,
} from "./logic";
import { ActionError, PageSkeleton, RoleNotice } from "./parts";
import "./appearance.css";

const HEADER = <PageHeader title="Checkout appearance" subtitle="Make checkout feel like part of your business." />;

export function Appearance() {
  const app = useApp();
  if (!roleAllows(updateAccount, app.session?.role))
    return (
      <div className="np-stack np-stack--lg">
        {HEADER}
        <RoleNotice>Only owners and admins can change checkout appearance.</RoleNotice>
      </div>
    );
  if (!app.account) return <PageSkeleton label="Loading checkout appearance" />;
  return <AppearanceForm key={app.account.id} />;
}

function AppearanceForm() {
  const app = useApp();
  const account = app.account;
  const saved = {
    display_name: account?.display_name ?? "",
    accent_color: account?.settings.branding.accent_color ?? null,
  };
  const [displayName, setDisplayName] = useState(saved.display_name);
  const [accent, setAccent] = useState(saved.accent_color ?? DEFAULT_ACCENT);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [corner, setCorner] = useState("8");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [announce, setAnnounce] = useState("");

  // pick up a refreshed account (e.g. after save) without clobbering edits in progress
  useEffect(() => {
    if (!touched) {
      setDisplayName(saved.display_name);
      setAccent(saved.accent_color ?? DEFAULT_ACCENT);
    }
  }, [saved.display_name, saved.accent_color, touched]);

  const errors = validate({ displayName, accent });
  const shown = touched ? errors : {};
  const hex = normalizeHex(accent);
  const body = updateBody({ displayName, accent }, saved);
  const merchant = account?.verified_legal_name ?? (displayName.trim() || "Your business");

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length || !body || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await app.api.call(updateAccount, { body });
      app.refreshAccount();
      setTouched(false);
      setAnnounce("Checkout appearance saved.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="np-stack np-stack--lg">
      <LiveRegion>{announce}</LiveRegion>
      {HEADER}
      <div className="npf-appearance__layout">
        <Card>
          <form
            className="np-stack np-stack--lg"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field
              label="Display name"
              hint={
                account?.verified_legal_name
                  ? `Checkout shows your reviewed legal name, ${account.verified_legal_name}. The display name is used in the dashboard and emails.`
                  : "Shown at checkout until NearPay has reviewed your business details; then customers see your approved legal name."
              }
              error={shown.displayName}
              required
            >
              <Input
                value={displayName}
                maxLength={100}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setTouched(true);
                }}
                data-testid="appearance-name"
              />
            </Field>
            <Field
              label="Accent colour"
              hint={
                hex && accentAdjusted(hex)
                  ? `${accentName(hex)} · ${hex}. Checkout uses a slightly adjusted shade so text stays readable.`
                  : hex
                    ? `${accentName(hex)} · ${hex}`
                    : undefined
              }
              error={shown.accent}
            >
              <div className="npf-appearance__accent">
                <Input
                  value={accent}
                  maxLength={7}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => {
                    setAccent(e.target.value);
                    setTouched(true);
                  }}
                  data-testid="appearance-accent"
                />
                <input
                  type="color"
                  className="npf-appearance__picker"
                  aria-label="Pick an accent colour"
                  value={(hex ?? DEFAULT_ACCENT).toLowerCase()}
                  onChange={(e) => {
                    setAccent(e.target.value.toUpperCase());
                    setTouched(true);
                  }}
                />
              </div>
            </Field>
            <fieldset className="npf-appearance__presets">
              <legend className="np-sr-only">Preset accent colours</legend>
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`npf-appearance__swatch npf-appearance__swatch--${p.value.slice(1).toLowerCase()}`}
                  aria-label={`${p.label} ${p.value}`}
                  aria-pressed={hex === p.value}
                  onClick={() => {
                    setAccent(p.value);
                    setTouched(true);
                  }}
                />
              ))}
            </fieldset>
            <Field label="Theme" hint="Preview only for now — saving this setting isn't available yet.">
              <Select value={theme} options={THEMES} onChange={(e) => setTheme(e.target.value as typeof theme)} />
            </Field>
            <Field label="Corner style" hint="Preview only for now — saving this setting isn't available yet.">
              <Select value={corner} options={CORNERS} onChange={(e) => setCorner(e.target.value)} />
            </Field>
            <Button
              type="submit"
              fullWidth
              loading={busy}
              loadingText="Saving…"
              disabled={!body}
              data-testid="save-appearance"
            >
              {body ? "Save appearance" : "Saved"}
            </Button>
            <ActionError error={error} />
          </form>
        </Card>
        <Card className="npf-appearance__preview-card" aria-labelledby="npf-appearance-preview">
          <p className="npf-appearance__eyebrow" id="npf-appearance-preview">
            Live preview
          </p>
          <ThemeRoot
            theme={theme}
            accent={hex ?? DEFAULT_ACCENT}
            radius={Number(corner)}
            className="npf-appearance__preview"
            data-testid="appearance-preview"
          >
            <p className="np-sr-only">Checkout for {merchant} with the chosen colour, theme and corners.</p>
            <div className="np-stack" aria-hidden="true" inert>
              <p className="np-text-h3">{merchant}</p>
              <p className="np-money np-money--hero">$49.00</p>
              <Button fullWidth tabIndex={-1}>
                Connect wallet
              </Button>
              <Button fullWidth variant="secondary" tabIndex={-1}>
                Send from another wallet
              </Button>
              <p className="np-text-caption np-text-secondary">Secured by NearPay</p>
            </div>
          </ThemeRoot>
        </Card>
      </div>
      {account?.settings.branding.logo_url === null && (
        <Callout tone="neutral" title="Your checkout uses an initial for your logo">
          Customers see the first letter of your business name.
        </Callout>
      )}
    </div>
  );
}
