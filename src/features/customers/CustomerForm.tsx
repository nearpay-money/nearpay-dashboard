/** Add / edit customer dialog: name, receipt email, internal note and known wallets (≤ 20). */

import { Button, CloseIcon, Field, IconButton, Input, Modal, Select } from "@nearpay-internal/ui";
import type { Customer } from "@nearpay-money/spec";
import { useEffect, useState } from "react";
import { useCustomerCalls } from "./api";
import { CHAINS, type CustomerForm, formOf, validateCustomer, type WalletRow } from "./logic";
import { ActionError } from "./parts";

let rowSeq = 0;

export function CustomerDialog({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Undefined = add. */
  customer?: Customer;
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const calls = useCustomerCalls();
  const [form, setForm] = useState<CustomerForm>(() => formOf(customer));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (open) {
      setForm(formOf(customer));
      setTouched(false);
      setError(undefined);
    }
  }, [open, customer]);

  const errors = validateCustomer(form);
  const shown = touched ? errors : {};
  const set = (patch: Partial<CustomerForm>) => setForm((f) => ({ ...f, ...patch }));
  const setWallet = (key: string, patch: Partial<WalletRow>) =>
    set({ wallets: form.wallets.map((w) => (w.key === key ? { ...w, ...patch } : w)) });

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onSaved(customer ? await calls.update(customer.id, form) : await calls.create(form));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={false}
      title={customer ? "Edit customer" : "Add customer"}
      description="Customer records are optional — payers never need one to pay."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()} data-testid="save-customer">
            {customer ? "Save changes" : "Add customer"}
          </Button>
        </>
      }
    >
      <form
        className="np-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" error={shown.name}>
          <Input
            value={form.name}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => set({ name: e.target.value })}
            data-testid="customer-name"
          />
        </Field>
        <Field label="Receipt email" hint="Used for receipts; never shared in events." error={shown.email}>
          <Input
            type="email"
            value={form.email}
            autoComplete="off"
            onChange={(e) => set({ email: e.target.value })}
            data-testid="customer-email"
          />
        </Field>
        <Field label="Internal note" hint="Only your team sees this." error={shown.description}>
          <Input value={form.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <fieldset className="npf-customers__wallets">
          <legend className="np-field__label">Wallets</legend>
          <p className="np-text-caption np-text-secondary">
            For your records. Refunds always return to the address the payer paid from.
          </p>
          {form.wallets.map((w, i) => (
            <div className="npf-customers__wallet-row" key={w.key}>
              <Field label={`Network ${i + 1}`} hideLabel>
                <Select
                  value={w.chain}
                  options={CHAINS}
                  onChange={(e) => setWallet(w.key, { chain: e.target.value })}
                />
              </Field>
              <Field label={`Wallet address ${i + 1}`} hideLabel>
                <Input
                  value={w.address}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Address or NEAR account"
                  onChange={(e) => setWallet(w.key, { address: e.target.value })}
                />
              </Field>
              <IconButton
                label={`Remove wallet ${i + 1}`}
                icon={<CloseIcon size={16} />}
                onClick={() => set({ wallets: form.wallets.filter((x) => x.key !== w.key) })}
              />
            </div>
          ))}
          {shown.wallets && (
            <p className="np-field__error" role="alert">
              {shown.wallets}
            </p>
          )}
          {form.wallets.length < 20 && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  set({ wallets: [...form.wallets, { key: `n${++rowSeq}`, chain: "near:mainnet", address: "" }] })
                }
              >
                Add wallet
              </Button>
            </div>
          )}
        </fieldset>
        <ActionError error={error} />
      </form>
    </Modal>
  );
}
