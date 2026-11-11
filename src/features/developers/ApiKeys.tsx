/**
 * API keys (Figma Developers → API keys): create secret / publishable / restricted keys (restricted: the
 * per-resource permission matrix from spec `KEY_SCOPES`, optional IP allow-list), edit restricted keys
 * (`updateApiKey`), roll with a grace period, revoke. Secrets are shown once. Writes need a step-up (the
 * API asks; the client replays with the same Idempotency-Key) and are blocked in live mode until live
 * mode is enabled (lld §1, L-DB-02).
 */

import { Input, OptionCard, RadioCardGroup, Select, Table, useToast } from "@nearpay-internal/ui";
import {
  type ApiKey as ApiKeySchema,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rollApiKey,
  updateApiKey,
  type z,
} from "@nearpay-money/spec";
import { useState } from "react";
import { useApp } from "../../app/context";
import { formatDate, relative } from "../../lib/format";
import { useAsync, useMutation } from "../../lib/hooks";
import { ConfirmDialog, Section, useConfirm } from "../../ui/page";
import { Button, ErrorNote, Field, Modal, Mono, SecretOnce } from "../../ui/ui";
import { describeScopes, levelsFromScopes, scopeResources, scopesFromLevels } from "./scopes";

type ApiKey = z.output<typeof ApiKeySchema>;

const GRACE: [number, string][] = [
  [0, "Immediately"],
  [3600, "In 1 hour"],
  [86_400, "In 24 hours"],
  [604_800, "In 7 days"],
];

type KeyType = "secret" | "publishable" | "restricted";

export function permissionText(k: Pick<ApiKey, "type" | "scopes">): string {
  if (k.type === "secret") return "Full access";
  if (k.type === "publishable") return "Checkout only (browser)";
  if (k.type === "restricted") return `Restricted · ${describeScopes(k.scopes)}`;
  return k.type;
}

/** Permission matrix: one radio group per resource (None / Read / Write …). */
export function ScopePicker({
  levels,
  onChange,
}: {
  levels: Record<string, string>;
  onChange(l: Record<string, string>): void;
}) {
  const resources = scopeResources();
  return (
    <fieldset className="dash-scopes" aria-describedby="dash-scopes-hint">
      <legend>Permissions</legend>
      <p id="dash-scopes-hint" className="np-text-caption np-text-secondary">
        Write includes read. Grant only what this integration needs.
      </p>
      <table className="dash-scopes__table">
        <thead>
          <tr>
            <th scope="col">Resource</th>
            <th scope="col">None</th>
            <th scope="col">Read</th>
            <th scope="col">Write</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => {
            const cur = levels[r.resource] ?? "none";
            const options = ["none", ...r.levels];
            const cells = ["none", "read", "write"];
            const single = r.levels.length === 1 && !["read", "write"].includes(r.levels[0] as string);
            return (
              <tr key={r.resource}>
                <th scope="row">{r.label}</th>
                {single ? (
                  <>
                    <td>
                      <input
                        type="radio"
                        name={`scope-${r.resource}`}
                        aria-label={`${r.label}: none`}
                        checked={cur === "none"}
                        onChange={() => onChange({ ...levels, [r.resource]: "none" })}
                      />
                    </td>
                    <td colSpan={2}>
                      <label className="dash-scopes__single">
                        <input
                          type="radio"
                          name={`scope-${r.resource}`}
                          checked={cur === r.levels[0]}
                          onChange={() => onChange({ ...levels, [r.resource]: r.levels[0] as string })}
                        />{" "}
                        {r.levels[0]}
                      </label>
                    </td>
                  </>
                ) : (
                  cells.map((c) => (
                    <td key={c}>
                      {options.includes(c) ? (
                        <input
                          type="radio"
                          name={`scope-${r.resource}`}
                          aria-label={`${r.label}: ${c}`}
                          checked={cur === c}
                          onChange={() => onChange({ ...levels, [r.resource]: c })}
                        />
                      ) : (
                        <span className="np-text-secondary" aria-hidden="true">
                          —
                        </span>
                      )}
                    </td>
                  ))
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </fieldset>
  );
}

function parseCidrs(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function KeyForm({
  initial,
  onDone,
  onClose,
}: {
  initial?: ApiKey;
  onDone(secret?: { label: string; value: string }): void;
  onClose(): void;
}) {
  const app = useApp();
  const editing = Boolean(initial);
  const [type, setType] = useState<KeyType>((initial?.type as KeyType) ?? "secret");
  const [name, setName] = useState(initial?.name ?? "");
  const [levels, setLevels] = useState<Record<string, string>>(initial ? levelsFromScopes(initial.scopes) : {});
  const [cidrs, setCidrs] = useState((initial?.ip_allowlist ?? []).join("\n"));
  const save = useMutation(async () => {
    const scopes = scopesFromLevels(levels);
    const ip = parseCidrs(cidrs);
    if (!name.trim()) throw new Error("Give the key a name.");
    if (type === "restricted" && scopes.length === 0)
      throw new Error("Choose at least one permission for a restricted key.");
    if (editing && initial) {
      const body = {
        ...(name.trim() !== initial.name ? { name: name.trim() } : {}),
        ...(initial.type === "restricted" ? { scopes } : {}),
        ip_allowlist: ip,
      };
      const parsed = (updateApiKey.body as NonNullable<typeof updateApiKey.body>).safeParse(body);
      if (!parsed.success) throw new Error("Check the IP allow-list: one IPv4 or IPv6 CIDR range per line.");
      await app.api.call(updateApiKey, { params: { id: initial.id }, body });
      onDone();
      return;
    }
    const body = {
      type,
      name: name.trim(),
      livemode: app.mode === "live",
      ...(type === "restricted" ? { scopes } : {}),
      ...(ip.length && type !== "publishable" ? { ip_allowlist: ip } : {}),
    };
    const parsed = (createApiKey.body as NonNullable<typeof createApiKey.body>).safeParse(body);
    if (!parsed.success) throw new Error("Check the IP allow-list: one IPv4 or IPv6 CIDR range per line.");
    const k = await app.api.call(createApiKey, { body });
    onDone(k.secret ? { label: `${k.name} (${k.display_prefix}…)`, value: k.secret } : undefined);
  });
  return (
    <Modal
      title={editing ? `Edit ${initial?.name}` : `Create a ${app.mode} key`}
      description={
        editing
          ? "Changes apply within 30 seconds."
          : "You'll see a new secret key only once. Keep secret keys on your server."
      }
      onClose={onClose}
      dismissible={!save.busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.busy}>
            Cancel
          </Button>
          <Button busy={save.busy} disabled={!name.trim()} onClick={() => void save.run()}>
            {editing ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <div className="np-stack">
        {!editing ? (
          <RadioCardGroup label="Key type" value={type} onChange={(v) => setType(v as KeyType)}>
            <OptionCard
              value="secret"
              title="Secret key"
              description="Full API access from your server."
              indicator="none"
            />
            <OptionCard
              value="restricted"
              title="Restricted key"
              description="Only the permissions you choose."
              indicator="none"
            />
            <OptionCard
              value="publishable"
              title="Publishable key"
              description="For checkout embeds in the browser."
              indicator="none"
            />
          </RadioCardGroup>
        ) : null}
        <Field label="Name" hint="For example: Acme checkout server.">
          {(id) => <Input id={id} maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {type === "restricted" ? <ScopePicker levels={levels} onChange={setLevels} /> : null}
        {type !== "publishable" ? (
          <Field
            label="IP allow-list (optional)"
            hint="One CIDR range per line, e.g. 203.0.113.0/24. Empty allows any address."
          >
            {(id) => (
              <textarea
                id={id}
                className="dash-textarea"
                rows={2}
                value={cidrs}
                spellCheck={false}
                onChange={(e) => setCidrs(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
}

export function ApiKeys() {
  const app = useApp();
  const toast = useToast();
  const keys = useAsync(() => app.api.call(listApiKeys, { query: { limit: 100 } }), [app.api, app.mode]);
  // `?create=secret` (from "Start accepting payments") opens the create dialog when the user may create keys
  const [form, setForm] = useState<{ edit?: ApiKey } | null>(() =>
    new URLSearchParams(app.location.search).has("create") && !app.gate(createApiKey) ? {} : null,
  );
  const [secret, setSecret] = useState<{ label: string; value: string }>();
  const [rolling, setRolling] = useState<ApiKey>();
  const [grace, setGrace] = useState(0);
  const revoking = useConfirm<ApiKey>();
  const roll = useMutation(async (k: ApiKey) => {
    const r = await app.api.call(rollApiKey, { params: { id: k.id }, body: { expire_old_in_seconds: grace } });
    setRolling(undefined);
    keys.reload();
    if (r.secret) setSecret({ label: `${r.name} (rolled)`, value: r.secret });
  });
  const revoke = useMutation(async (k: ApiKey) => {
    await app.api.call(revokeApiKey, { params: { id: k.id } });
    revoking.close();
    keys.reload();
    toast.show({ tone: "success", title: `${k.name} revoked`, body: "Requests with it now fail." });
  });
  const now = Math.floor(Date.now() / 1000);

  return (
    <Section
      title="API keys"
      level={2}
      actions={
        <Button blocked={app.gate(createApiKey)} onClick={() => setForm({})}>
          Create key
        </Button>
      }
    >
      <p className="np-text-secondary">
        Secret keys (<code>sk_{app.mode}_…</code>) stay on your server; restricted keys (<code>rk_</code>) hold only the
        permissions you choose; publishable keys (<code>pk_</code>) are for checkout embeds.
      </p>
      {secret ? <SecretOnce label={secret.label} value={secret.value} onDone={() => setSecret(undefined)} /> : null}
      {keys.error ? <ErrorNote error={keys.error} onRetry={keys.reload} /> : null}
      <div data-testid="keys-table">
        <Table
          caption="API keys"
          loading={keys.loading && !keys.data}
          rows={keys.data?.data ?? []}
          rowKey={(k) => k.id}
          empty={`No ${app.mode} keys yet. Create one to call the API from your server.`}
          columns={[
            {
              key: "name",
              header: "Key name",
              primary: true,
              cell: (k) => (
                <span className="dash-cell-stack">
                  <span>{k.name}</span>
                  <Mono>
                    {k.display_prefix}…{k.last4}
                  </Mono>
                </span>
              ),
            },
            {
              key: "perm",
              header: "Permission",
              cell: (k) => <span title={k.scopes.join(", ")}>{permissionText(k)}</span>,
            },
            { key: "created", header: "Created", cell: (k) => formatDate(k.created), hideOnNarrow: true },
            {
              key: "used",
              header: "Last used",
              cell: (k) => (k.last_used_at ? relative(k.last_used_at, now) : "Never"),
              hideOnNarrow: true,
            },
            {
              key: "expires",
              header: "Expires",
              cell: (k) => (k.expires_at ? relative(k.expires_at, now) : "—"),
              hideOnNarrow: true,
            },
            {
              key: "actions",
              header: <span className="np-sr-only">Actions</span>,
              align: "end",
              cell: (k) => (
                <div className="dash-row-actions">
                  {k.type === "restricted" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      blocked={app.gate(updateApiKey)}
                      onClick={() => setForm({ edit: k })}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <Button variant="secondary" size="sm" blocked={app.gate(rollApiKey)} onClick={() => setRolling(k)}>
                    Roll
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    blocked={app.gate(revokeApiKey)}
                    onClick={() => {
                      revoke.reset();
                      revoking.open(k);
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>
      {form ? (
        <KeyForm
          initial={form.edit}
          onClose={() => setForm(null)}
          onDone={(s) => {
            setForm(null);
            keys.reload();
            if (s) setSecret(s);
            else toast.show({ tone: "success", title: "Key updated" });
          }}
        />
      ) : null}
      {rolling ? (
        <Modal
          title={`Roll ${rolling.name}`}
          description="A new key replaces this one. Update your server before the old key stops working."
          onClose={() => setRolling(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRolling(undefined)}>
                Cancel
              </Button>
              <Button busy={roll.busy} onClick={() => void roll.run(rolling)}>
                Roll key
              </Button>
            </>
          }
        >
          <Field label="The old key stops working">
            {(id) => (
              <Select id={id} value={grace} onChange={(e) => setGrace(Number(e.target.value))}>
                {GRACE.map(([s, l]) => (
                  <option key={s} value={s}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ErrorNote error={roll.error} />
        </Modal>
      ) : null}
      <ConfirmDialog
        open={Boolean(revoking.target)}
        title={`Revoke ${revoking.target?.name ?? "key"}?`}
        description="Requests with this key fail immediately. This can't be undone."
        confirmLabel="Revoke key"
        busy={revoke.busy}
        error={revoke.error}
        onClose={revoking.close}
        onConfirm={() => revoking.target && void revoke.run(revoking.target)}
      />
    </Section>
  );
}
