/**
 * Business details (`/settings/business`; lld/dashboard-and-console.md §1 "KYB"; ADR-0020 decision 3,
 * ADR-0024 open onboarding): the owner declares minimum business details, saves drafts and saves them
 * as final (declaration checkbox, step-up) — live mode turns on at once, no NearPay review. Statuses:
 * not submitted, submitted (manual review only), needs more info (with `requested_info`), live
 * (approved), not accepted (rejected). Admins see the details read-only. Never "verified"/"reviewed".
 */

import {
  Button,
  Callout,
  Card,
  CardTitle,
  Checkbox,
  Field,
  Input,
  KeyValueList,
  LiveRegion,
  PageHeader,
  Select,
  StatusBadge,
} from "@nearpay-internal/ui";
import { submitKyb, updateKybProfile } from "@nearpay-money/spec";
import { type ReactNode, useMemo, useState } from "react";
import { useApp } from "../../app/context";
import { roleAllows } from "../../lib/permissions";
import { useKyb, useKybCalls } from "./api";
import {
  BUSINESS_TYPES,
  countryOptions,
  type Errors,
  formatErrors,
  formOf,
  type KybCase,
  type KybField,
  type KybForm,
  labelOf,
  statusInfo,
  submitErrors,
  VOLUME_BANDS,
} from "./logic";
import { ActionError, ErrorState, PageSkeleton } from "./parts";
import { fmtDate } from "./ui";
import "./kyb.css";

const HEADER = (
  <PageHeader
    title="Business details"
    subtitle="Declare your business to accept live payments. Live mode turns on as soon as you save complete details."
  />
);

export function BusinessDetails() {
  const kyb = useKyb();
  if (kyb.loading && !kyb.data) return <PageSkeleton label="Loading business details" />;
  if (kyb.error || !kyb.data)
    return (
      <div className="np-stack np-stack--lg">
        {HEADER}
        <ErrorState error={kyb.error} onRetry={kyb.reload} title="We couldn't load your business details" />
      </div>
    );
  return <KybView initial={kyb.data} />;
}

function KybView({ initial }: { initial: KybCase }) {
  const app = useApp();
  const calls = useKybCalls();
  const [kase, setKase] = useState(initial);
  const [form, setForm] = useState<KybForm>(() => formOf(initial.profile));
  const [shownErrors, setShownErrors] = useState<Errors>({});
  const [declared, setDeclared] = useState(false);
  const [declErr, setDeclErr] = useState<string>();
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [error, setError] = useState<unknown>();
  const [announce, setAnnounce] = useState("");
  const countries = useMemo(() => countryOptions(), []);
  const isOwner = roleAllows(updateKybProfile, app.session?.role);
  const editable = (kase.editable ?? (kase.status === "not_started" || kase.status === "needs_info")) && isOwner;
  const info = statusInfo(kase);

  const set = (k: KybField, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (shownErrors[k]) setShownErrors((e) => ({ ...e, [k]: undefined }));
  };

  const save = async () => {
    const e = formatErrors(form);
    setShownErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setBusy("save");
    setError(undefined);
    try {
      const next = await calls.save(form);
      setKase(next);
      setAnnounce("Draft saved.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    const e = submitErrors(form);
    setShownErrors(e);
    setDeclErr(declared ? undefined : "Confirm the declaration to submit.");
    if (Object.values(e).some(Boolean) || !declared) {
      setAnnounce("Some details are missing. Check the highlighted fields.");
      return;
    }
    setBusy("submit");
    setError(undefined);
    try {
      await calls.save(form);
      const next = await calls.submit();
      setKase(next);
      setForm(formOf(next.profile));
      setAnnounce(
        next.status === "approved" ? "You're live — you can accept real payments." : "Business details submitted.",
      );
      app.refreshAccount();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const err = (k: KybField) => shownErrors[k];
  const field = (k: KybField, label: string, control: ReactNode, opts: { hint?: string; required?: boolean } = {}) => (
    <Field label={label} hint={opts.hint} error={err(k)} required={opts.required}>
      {control}
    </Field>
  );
  const text = (k: KybField, extra: Record<string, unknown> = {}) => (
    <Input value={form[k]} onChange={(e) => set(k, e.target.value)} data-testid={`kyb-${k}`} {...extra} />
  );
  const select = (k: KybField, options: readonly { value: string; label: string }[], placeholder: string) => (
    <Select
      value={form[k]}
      placeholder={placeholder}
      options={options}
      onChange={(e) => set(k, e.target.value)}
      data-testid={`kyb-${k}`}
    />
  );

  return (
    <div className="np-stack np-stack--lg">
      <LiveRegion>{announce}</LiveRegion>
      {HEADER}
      {info ? (
        <Callout tone={info.tone} title={info.title} data-testid="kyb-status" live>
          <p>
            <StatusBadge>{info.badge}</StatusBadge>
          </p>
          <p>{info.body}</p>
          {kase.status === "needs_info" && kase.requested_info && (
            <blockquote className="npf-kyb__requested" data-testid="kyb-requested-info">
              {kase.requested_info}
            </blockquote>
          )}
          {kase.submitted_at ? (
            <p className="np-text-caption">
              Submitted {fmtDate(kase.submitted_at)}
              {kase.decided_at ? ` · Decided ${fmtDate(kase.decided_at)}` : ""}
            </p>
          ) : null}
        </Callout>
      ) : null}

      {!isOwner && kase.status !== "approved" && (
        <Callout tone="neutral" title="Only owners can change business details">
          You can view what was declared. Ask an owner to update or submit the details.
        </Callout>
      )}

      {editable ? (
        <form
          className="npf-kyb__form np-stack np-stack--lg"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Card as="section" aria-labelledby="npf-kyb-business">
            <div className="np-stack">
              <CardTitle as="h2">
                <span id="npf-kyb-business">Business</span>
              </CardTitle>
              {field(
                "legal_name",
                "Registered legal name",
                text("legal_name", { maxLength: 200, autoComplete: "organization" }),
                { required: true, hint: "Exactly as registered. For a sole proprietor, the owner's full name." },
              )}
              <div className="npf-kyb__grid">
                {field(
                  "country_of_incorporation",
                  "Country of incorporation",
                  select("country_of_incorporation", countries, "Choose a country"),
                  { required: true },
                )}
                {field("business_type", "Business type", select("business_type", BUSINESS_TYPES, "Choose a type"), {
                  required: true,
                })}
              </div>
              {field("registration_number", "Registration number", text("registration_number", { maxLength: 64 }), {
                hint: "Optional. Company or trade register number, or your tax ID.",
              })}
              {field("website", "Website", text("website", { inputMode: "url", autoComplete: "url" }), {
                hint: "Optional. Your public website or store front (https).",
              })}
              {field(
                "expected_monthly_volume",
                "Expected monthly volume",
                select("expected_monthly_volume", VOLUME_BANDS, "Choose a range"),
                { required: true },
              )}
            </div>
          </Card>
          <Card as="section" aria-labelledby="npf-kyb-address">
            <div className="np-stack">
              <CardTitle as="h2">
                <span id="npf-kyb-address">Registered address</span>
              </CardTitle>
              {field("line1", "Street address", text("line1", { maxLength: 200, autoComplete: "address-line1" }), {
                required: true,
              })}
              {field("line2", "Address line 2", text("line2", { maxLength: 200, autoComplete: "address-line2" }))}
              <div className="npf-kyb__grid">
                {field("city", "City", text("city", { maxLength: 100, autoComplete: "address-level2" }), {
                  required: true,
                })}
                {field(
                  "postal_code",
                  "Postal code",
                  text("postal_code", { maxLength: 20, autoComplete: "postal-code" }),
                )}
              </div>
              <div className="npf-kyb__grid">
                {field("region", "State or region", text("region", { maxLength: 100, autoComplete: "address-level1" }))}
                {field("address_country", "Country", select("address_country", countries, "Choose a country"), {
                  required: true,
                })}
              </div>
            </div>
          </Card>
          <Card as="section" aria-labelledby="npf-kyb-rep">
            <div className="np-stack">
              <CardTitle as="h2">
                <span id="npf-kyb-rep">Representative</span>
              </CardTitle>
              <p className="np-text-secondary">The person declaring these details on behalf of the business.</p>
              <div className="npf-kyb__grid">
                {field("rep_name", "Full name", text("rep_name", { maxLength: 200, autoComplete: "name" }), {
                  required: true,
                })}
                {field("rep_title", "Role", text("rep_title", { maxLength: 100, placeholder: "Director" }), {
                  required: true,
                })}
              </div>
            </div>
          </Card>
          <Checkbox
            label="I declare that these business details are true and complete."
            description="No documents are needed. Live payments turn on as soon as you save."
            checked={declared}
            onChange={(e) => {
              setDeclared(e.target.checked);
              if (e.target.checked) setDeclErr(undefined);
            }}
            aria-invalid={declErr ? true : undefined}
            data-testid="kyb-declaration"
          />
          {declErr && (
            <p className="np-field__error" role="alert">
              {declErr}
            </p>
          )}
          <div className="npf-kyb__actions">
            <Button
              type="submit"
              loading={busy === "submit"}
              loadingText="Saving…"
              disabled={busy !== null || Boolean(app.gate(submitKyb))}
              data-testid="kyb-submit"
            >
              Save and go live
            </Button>
            <Button
              variant="secondary"
              loading={busy === "save"}
              disabled={busy !== null}
              onClick={() => void save()}
              data-testid="kyb-save"
            >
              Save draft
            </Button>
          </div>
          <p className="np-text-caption np-text-secondary">You'll confirm with your passkey.</p>
          <ActionError error={error} />
        </form>
      ) : (
        <ReadOnly kase={kase} countries={countries} />
      )}
    </div>
  );
}

function ReadOnly({ kase, countries }: { kase: KybCase; countries: readonly { value: string; label: string }[] }) {
  const p = kase.profile;
  if (!p?.legal_name) return <p className="np-text-secondary">No business details declared yet.</p>;
  const a = p.business_address;
  return (
    <Card>
      <div className="np-stack">
        <CardTitle as="h2">Declared details</CardTitle>
        <KeyValueList
          layout="stacked"
          items={[
            { label: "Registered legal name", value: p.legal_name },
            { label: "Country of incorporation", value: labelOf(countries, p.country_of_incorporation) },
            { label: "Registration number", value: p.registration_number ?? "Not provided" },
            { label: "Business type", value: labelOf(BUSINESS_TYPES, p.business_type) },
            { label: "Website", value: p.website ?? "—" },
            {
              label: "Registered address",
              value: a
                ? [
                    a.line1,
                    a.line2,
                    [a.postal_code, a.city].filter(Boolean).join(" "),
                    a.region,
                    labelOf(countries, a.country),
                  ]
                    .filter(Boolean)
                    .join(", ")
                : "—",
            },
            {
              label: "Representative",
              value: p.representative ? `${p.representative.name}, ${p.representative.title}` : "—",
            },
            { label: "Expected monthly volume", value: labelOf(VOLUME_BANDS, p.expected_monthly_volume) },
          ]}
        />
      </div>
    </Card>
  );
}
