import { Input } from "@nearpay-internal/ui";
import { verifyMagicLink } from "@nearpay-money/spec";
import { useEffect, useState } from "react";
import { Link, useApp } from "../../app/context";
import { AuthLayout } from "../../ui/auth";
import { Button, ErrorNote, Field, Loading } from "../../ui/ui";
import { registerPasskey } from "./passkeys";

/** `/auth/verify#token=…` (identity puts the token in the fragment so it never reaches a server log). */
export function VerifyMagicLink() {
  const app = useApp();
  const [reg, setReg] = useState<{ token: string; email: string }>();
  const [error, setError] = useState<unknown>();
  const [name, setName] = useState("");
  const [passkeyName, setPasskeyName] = useState("This device");
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once for the link in the address bar
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!token) {
      setError(new Error("This link has no token. Open the link from your email again."));
      return;
    }
    app.api
      .call(verifyMagicLink, { body: { token } })
      .then((r) => setReg({ token: r.registration_token, email: r.email }), setError);
  }, []);

  return (
    <AuthLayout>
      <h1 className="np-text-h3">Create your passkey</h1>
      {!reg && !error && <Loading what="Checking your link" />}
      {reg && (
        <form
          className="dash-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            try {
              const s = await registerPasskey(app.api, {
                registrationToken: reg.token,
                displayName: name.trim() || undefined,
                passkeyName: passkeyName.trim() || undefined,
              });
              app.setSession(s);
              app.navigate("/", { replace: true });
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            Email verified: <strong>{reg.email}</strong>. The registration expires in 5 minutes.
          </p>
          <Field label="Business name" hint="Shown to payers until you save your business details.">
            {(id) => <Input id={id} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Passkey name">
            {(id) => (
              <Input id={id} maxLength={64} value={passkeyName} onChange={(e) => setPasskeyName(e.target.value)} />
            )}
          </Field>
          <Button type="submit" busy={busy}>
            Create passkey and open dashboard
          </Button>
        </form>
      )}
      <ErrorNote error={error} />
      {error !== undefined && (
        <p>
          <Link to="/signup">Start sign-up again</Link>
        </p>
      )}
    </AuthLayout>
  );
}
