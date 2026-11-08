/**
 * Billing → Tax rates (lld/billing.md §11 d1–d2; spec `billing-catalog`): manual rates as exact decimal
 * percentages (≤ 4 decimals, never floats), inclusive or exclusive. Percentage and inclusiveness are
 * immutable; labels can change, and a rate is archived (`active: false`) instead of deleted. The form
 * shows a worked example computed with the spec's `computeLineTax` (round half-up per line).
 */
import {
  computeLineTax,
  createTaxRate,
  listTaxRates,
  type TaxRate,
  taxPercentageToPpm,
  updateTaxRate,
} from "@nearpay/spec";
import {
  Button,
  Field,
  FilterBar,
  FilterPill,
  Input,
  LiveRegion,
  MenuButton,
  Modal,
  MoreIcon,
  OptionCard,
  Pager,
  RadioCardGroup,
  StatusBadge,
  Table,
  useToast,
} from "@nearpay-internal/ui";
import { useState } from "react";
import { useApp } from "../../app/context";
import { amountText, parseTaxPercentage, percentText } from "../../lib/billing";
import { formatDate } from "../../lib/format";
import { useCursorList } from "../../lib/hooks";
import { roleAllows } from "../../lib/permissions";
import { Empty } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import "../billing/billing.css";
import { BillingHub } from "../billing/Hub";
import { ActiveBadge } from "../billing/shared";

type Filter = "true" | "false" | "";

export function TaxRatesTab() {
  const app = useApp();
  const raw = new URLSearchParams(app.location.search).get("active");
  const active: Filter = raw === "false" ? "false" : raw === "all" ? "" : "true";
  const [dialog, setDialog] = useState<{ rate?: TaxRate } | undefined>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [announce, setAnnounce] = useState("");
  const toast = useToast();
  const canEdit = roleAllows(createTaxRate, app.session?.role);
  const list = useCursorList<TaxRate>(
    async (after) => {
      const r = await app.api.call(listTaxRates, {
        query: { limit: 20, ...(active ? { active } : {}), ...(after ? { starting_after: after } : {}) },
      });
      return { data: r.data as TaxRate[], has_more: r.has_more };
    },
    [app.api, app.mode, active],
    20,
  );
  const rows = list.data?.data ?? [];
  const toggle = async (t: TaxRate) => {
    setBusy(t.id);
    setError(undefined);
    try {
      await app.api.call(updateTaxRate, { params: { id: t.id }, body: { active: !t.active } });
      const msg = t.active ? `${t.display_name} archived.` : `${t.display_name} restored.`;
      setAnnounce(msg);
      toast.show({ tone: "success", title: msg });
      list.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };
  const add = canEdit ? (
    <Button onClick={() => setDialog({})} data-testid="add-tax-rate">
      Add tax rate
    </Button>
  ) : undefined;
  return (
    <BillingHub tab="tax-rates" actions={add}>
      <LiveRegion>{announce}</LiveRegion>
      <FilterBar label="Tax rate filters">
        <FilterPill
          label="Status"
          options={[
            { value: "true", label: "Active" },
            { value: "false", label: "Archived" },
            { value: "", label: "All" },
          ]}
          value={active}
          defaultValue="true"
          onChange={(v) =>
            app.navigate(`/billing/tax-rates${v === "true" ? "" : `?active=${v || "all"}`}`, { replace: true })
          }
        />
      </FilterBar>
      <ErrorNote error={error} />
      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : !list.loading && rows.length === 0 && !list.hasPrevious && active === "true" ? (
        <Empty title="No tax rates yet" action={add}>
          NearPay doesn't calculate tax for you. Add the rates you charge — for example VAT 19% — and choose them on
          invoices and subscriptions.
        </Empty>
      ) : (
        <div data-testid="tax-rate-table">
          <Table<TaxRate>
            caption="Tax rates"
            loading={list.loading && !list.data}
            rows={rows}
            rowKey={(t) => t.id}
            empty="No tax rates match this filter."
            columns={[
              { key: "n", header: "Name", primary: true, cell: (t) => t.display_name },
              {
                key: "j",
                header: "Jurisdiction",
                hideOnNarrow: true,
                cell: (t) => [t.jurisdiction, t.country].filter(Boolean).join(" · ") || "—",
              },
              { key: "r", header: "Rate", numeric: true, cell: (t) => percentText(t.percentage) },
              {
                key: "i",
                header: "Type",
                cell: (t) => <StatusBadge tone="neutral">{t.inclusive ? "Inclusive" : "Exclusive"}</StatusBadge>,
              },
              { key: "s", header: "Status", cell: (t) => <ActiveBadge active={t.active} /> },
              { key: "c", header: "Created", hideOnNarrow: true, cell: (t) => formatDate(t.created) },
              ...(canEdit
                ? [
                    {
                      key: "x",
                      header: <span className="np-sr-only">Actions</span>,
                      cell: (t: TaxRate) => (
                        <MenuButton
                          label={`Actions for ${t.display_name}`}
                          triggerLabel={`Actions for ${t.display_name} ${t.percentage}%`}
                          variant="ghost"
                          align="end"
                          disabled={busy === t.id}
                          items={[
                            { id: "edit", label: "Edit labels" },
                            { id: "toggle", label: t.active ? "Archive" : "Restore", danger: t.active },
                          ]}
                          onSelect={(id) => (id === "edit" ? setDialog({ rate: t }) : void toggle(t))}
                          data-testid="tax-rate-actions"
                        >
                          <MoreIcon size={18} />
                        </MenuButton>
                      ),
                    },
                  ]
                : []),
            ]}
            footer={
              list.hasNext || list.hasPrevious ? (
                <Pager
                  hasPrevious={list.hasPrevious}
                  hasNext={list.hasNext}
                  onPrevious={list.previous}
                  onNext={list.next}
                />
              ) : undefined
            }
          />
        </div>
      )}
      {dialog ? (
        <TaxRateDialog
          rate={dialog.rate}
          onClose={() => setDialog(undefined)}
          onSaved={(t, created) => {
            setDialog(undefined);
            const msg = created ? `${t.display_name} ${percentText(t.percentage)} added.` : `${t.display_name} saved.`;
            setAnnounce(msg);
            toast.show({ tone: "success", title: msg });
            list.reload();
          }}
        />
      ) : null}
    </BillingHub>
  );
}

const COUNTRY = /^[A-Z]{2}$/;

/** `"On $100.00: tax $8.88 · total $108.88"` for an example amount, with the spec arithmetic. */
export function taxExample(
  percentage: string,
  inclusive: boolean,
  assets: ReturnType<typeof useApp>["assets"],
): string {
  const ppm = taxPercentageToPpm(percentage);
  const base = 10_000n; // $100.00
  const [t] = computeLineTax(base, [{ id: "txr_example", rate_ppm: ppm, inclusive }]);
  const tax = t?.amount ?? 0n;
  const usd = (n: bigint) => amountText({ amount: n, currency: "usd" }, assets);
  return inclusive
    ? `A $100.00 price includes ${usd(tax)} tax (${usd(base - tax)} before tax).`
    : `On $100.00: ${usd(tax)} tax, ${usd(base + tax)} total.`;
}

function TaxRateDialog({
  rate,
  onClose,
  onSaved,
}: {
  rate?: TaxRate;
  onClose: () => void;
  onSaved: (t: TaxRate, created: boolean) => void;
}) {
  const app = useApp();
  const [name, setName] = useState(rate?.display_name ?? "");
  const [pct, setPct] = useState(rate?.percentage ?? "");
  const [inclusive, setInclusive] = useState(rate?.inclusive ?? false);
  const [jurisdiction, setJurisdiction] = useState(rate?.jurisdiction ?? "");
  const [country, setCountry] = useState(rate?.country ?? "");
  const [description, setDescription] = useState(rate?.description ?? "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const percentage = rate ? rate.percentage : parseTaxPercentage(pct);
  const errors: Partial<Record<"name" | "pct" | "country" | "jurisdiction" | "description", string>> = {};
  if (!name.trim()) errors.name = "Enter the name shown on invoices, like VAT.";
  else if (name.trim().length > 50) errors.name = "Use at most 50 characters.";
  if (!rate && percentage === null) errors.pct = "Enter a percentage from 0 to 100 with up to 4 decimals, like 8.875.";
  if (country.trim() && !COUNTRY.test(country.trim().toUpperCase()))
    errors.country = "Use a two-letter country code, like DE.";
  if (jurisdiction.trim().length > 50) errors.jurisdiction = "Use at most 50 characters.";
  if (description.trim().length > 500) errors.description = "Use at most 500 characters.";
  const shown = touched ? errors : {};
  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length || percentage === null) return;
    setBusy(true);
    setError(undefined);
    const labels = {
      display_name: name.trim(),
      ...(jurisdiction.trim() ? { jurisdiction: jurisdiction.trim() } : {}),
      ...(country.trim() ? { country: country.trim().toUpperCase() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    try {
      const t = rate
        ? await app.api.call(updateTaxRate, {
            params: { id: rate.id },
            body: {
              display_name: name.trim(),
              jurisdiction: jurisdiction.trim() || null,
              country: country.trim() ? country.trim().toUpperCase() : null,
              description: description.trim() || null,
            },
          })
        : await app.api.call(createTaxRate, { body: { ...labels, percentage, inclusive } });
      onSaved(t as TaxRate, !rate);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={rate ? `Edit ${rate.display_name}` : "Add a tax rate"}
      description={
        rate
          ? "The percentage and whether it's inclusive can't change. To charge a different rate, add a new one and archive this one."
          : "You decide the rate; NearPay applies it exactly as entered."
      }
      dismissible={!busy}
      data-testid="tax-rate-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()} data-testid="save-tax-rate">
            {rate ? "Save" : "Add tax rate"}
          </Button>
        </>
      }
    >
      <div className="np-stack">
        <Field label="Name" error={shown.name} hint="Shown on invoices.">
          <Input
            value={name}
            maxLength={50}
            placeholder="VAT"
            onChange={(e) => setName(e.target.value)}
            data-testid="tax-name"
          />
        </Field>
        <Field
          label="Percentage"
          error={shown.pct}
          hint={rate ? "Can't be changed." : "Exact, up to 4 decimals (8.875 stays 8.875)."}
        >
          <Input
            value={rate ? rate.percentage : pct}
            readOnly={Boolean(rate)}
            inputMode="decimal"
            numeric
            trailing="%"
            placeholder="19"
            onChange={(e) => setPct(e.target.value)}
            data-testid="tax-percentage"
          />
        </Field>
        <RadioCardGroup
          label="How prices treat this tax"
          name="tax-inclusive"
          value={inclusive ? "inclusive" : "exclusive"}
          onChange={(v) => !rate && setInclusive(v === "inclusive")}
        >
          <OptionCard
            value="exclusive"
            title="Exclusive"
            description="Added on top of the price."
            disabled={Boolean(rate)}
          />
          <OptionCard
            value="inclusive"
            title="Inclusive"
            description="Already included in the price."
            disabled={Boolean(rate)}
          />
        </RadioCardGroup>
        {percentage !== null ? (
          <p className="np-text-small np-text-secondary" data-testid="tax-example">
            {taxExample(percentage, inclusive, app.assets)}
          </p>
        ) : null}
        <div className="npf-billing__row-2">
          <Field label="Jurisdiction (optional)" error={shown.jurisdiction} hint="Shown on invoices, e.g. US-NY.">
            <Input value={jurisdiction} maxLength={50} onChange={(e) => setJurisdiction(e.target.value)} />
          </Field>
          <Field label="Country (optional)" error={shown.country}>
            <Input value={country} maxLength={2} placeholder="DE" onChange={(e) => setCountry(e.target.value)} />
          </Field>
        </div>
        <Field label="Internal note (optional)" error={shown.description}>
          <Input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
