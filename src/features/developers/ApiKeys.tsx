import { createApiKey, listApiKeys, revokeApiKey, rollApiKey } from "@nearpay/spec";
import { useState } from "react";
import { useApp } from "../../app/context";
import { formatTime } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, Mono, SecretOnce } from "../../ui/ui";

const GRACE: [number, string][] = [
  [0, "immediately"],
  [3600, "in 1 hour"],
  [86_400, "in 24 hours"],
  [604_800, "in 7 days"],
];

export function ApiKeys() {
  const app = useApp();
  const keys = useAsync(() => app.api.call(listApiKeys, { query: { limit: 100 } }), [app.api, app.mode]);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<"secret" | "publishable">("secret");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<{ label: string; value: string }>();
  const [rolling, setRolling] = useState<string>();
  const [grace, setGrace] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      keys.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Card
      title="API keys"
      actions={
        <Button blocked={app.gate(createApiKey)} onClick={() => setCreating(true)}>
          Create key
        </Button>
      }
    >
      <p className="muted">
        Secret keys (<code>sk_{app.mode}_…</code>) stay on your server; publishable keys (<code>pk_</code>) are for
        checkout embeds. Keys are shown once.
      </p>
      <ErrorNote error={error} />
      {secret && <SecretOnce label={secret.label} value={secret.value} />}
      {keys.loading && <Loading />}
      <ErrorNote error={keys.error} />
      {keys.data &&
        (keys.data.data.length ? (
          <table className="table" data-testid="keys-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Type</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.data.data.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <Mono>
                      {k.display_prefix}…{k.last4}
                    </Mono>
                  </td>
                  <td>
                    <Badge value={k.type} tone="info" />
                  </td>
                  <td>{formatTime(k.created)}</td>
                  <td>{formatTime(k.last_used_at)}</td>
                  <td>{formatTime(k.expires_at)}</td>
                  <td className="row-actions">
                    <Button variant="secondary" blocked={app.gate(rollApiKey)} onClick={() => setRolling(k.id)}>
                      Roll
                    </Button>
                    <Button
                      variant="danger"
                      busy={busy === `revoke-${k.id}`}
                      blocked={app.gate(revokeApiKey)}
                      onClick={() => {
                        if (!window.confirm(`Revoke ${k.name}? Requests with it fail immediately.`)) return;
                        void run(`revoke-${k.id}`, async () => {
                          await app.api.call(revokeApiKey, { params: { id: k.id } });
                        });
                      }}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No {app.mode} keys yet.</Empty>
        ))}
      {creating && (
        <Modal
          title={`Create a ${app.mode} key`}
          onClose={() => setCreating(false)}
          footer={
            <Button
              busy={busy === "create"}
              disabled={!name.trim()}
              onClick={() =>
                void run("create", async () => {
                  const k = await app.api.call(createApiKey, {
                    body: { type, name: name.trim(), livemode: app.mode === "live" },
                  });
                  setCreating(false);
                  setName("");
                  if (k.secret) setSecret({ label: `${k.name} (${k.display_prefix}…)`, value: k.secret });
                })
              }
            >
              Create
            </Button>
          }
        >
          <Field label="Type">
            {(id) => (
              <select id={id} value={type} onChange={(e) => setType(e.target.value as "secret" | "publishable")}>
                <option value="secret">Secret (server)</option>
                <option value="publishable">Publishable (browser)</option>
              </select>
            )}
          </Field>
          <Field label="Name">
            {(id) => <input id={id} maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <ErrorNote error={error} />
        </Modal>
      )}
      {rolling && (
        <Modal
          title="Roll key"
          onClose={() => setRolling(undefined)}
          footer={
            <Button
              busy={busy === "roll"}
              onClick={() =>
                void run("roll", async () => {
                  const k = await app.api.call(rollApiKey, {
                    params: { id: rolling },
                    body: { expire_old_in_seconds: grace },
                  });
                  setRolling(undefined);
                  if (k.secret) setSecret({ label: `${k.name} (rolled)`, value: k.secret });
                })
              }
            >
              Roll key
            </Button>
          }
        >
          <Field label="The old key stops working">
            {(id) => (
              <select id={id} value={grace} onChange={(e) => setGrace(Number(e.target.value))}>
                {GRACE.map(([s, l]) => (
                  <option key={s} value={s}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <ErrorNote error={error} />
        </Modal>
      )}
    </Card>
  );
}
