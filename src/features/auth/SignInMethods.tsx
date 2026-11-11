/**
 * Settings → Account & payments → "Sign-in methods" (ADR-0026): passkeys and the linked Google account.
 *
 * - Connect Google: a stepped-up session starts a link flow (`startGoogleLink`); the API asks for the step-up
 *   and the client replays after it; Google comes back to `/settings/account?google=linked|google_error=…`.
 * - Disconnect: step-up, and only while the user keeps a passkey (`unlinkIdentity`; the API refuses otherwise).
 * - Add a passkey: a passkey user confirms with a step-up first; a Google-only user may add the first passkey
 *   within 10 minutes of a Google sign-in (`DashboardSession.sign_in.passkey_setup_until`), else continues
 *   with Google again.
 */
import {
  getDashboardSession,
  type LinkedIdentity as LinkedSchema,
  listLinkedIdentities,
  unlinkIdentity,
  type z,
} from "@nearpay-money/spec";
import { useEffect, useState } from "react";
import { useApp } from "../../app/context";
import { ApiError } from "../../lib/errors";
import { useAsync, useMutation } from "../../lib/hooks";
import { Section } from "../../ui/page";
import { Button, ErrorNote, Modal, Note } from "../../ui/ui";
import {
  connectGoogle,
  continueWithGoogle,
  GoogleButton,
  GoogleG,
  googleErrorMessage,
  googleErrorOf,
  useAuthMethods,
} from "./google";
import { registerPasskey } from "./passkeys";

export type LinkedIdentity = z.output<typeof LinkedSchema>;

/** Where a Google-only user returns after signing in with Google again to add a passkey. */
export const ADD_PASSKEY_PATH = "/settings/account?add_passkey=1";

export interface SignInMethodsViewProps {
  /** Dashboard passkeys of the user; undefined on servers before spec 0.5.1. */
  readonly passkeys: number | undefined;
  readonly googleEnabled: boolean;
  /** The linked Google identity, null = none, undefined = loading. */
  readonly google: LinkedIdentity | null | undefined;
  /** A Google-only user may add a first passkey until then (unix seconds). */
  readonly passkeySetupUntil: number | null;
  readonly nowSec: number;
  readonly notice?: { readonly tone: "ok" | "error"; readonly text: string } | null;
  readonly needsGoogleAgain?: boolean;
  readonly busy?: { readonly passkey?: boolean; readonly connect?: boolean; readonly disconnect?: boolean };
  onAddPasskey(): void;
  onConnect(): void;
  onDisconnect(): void;
  onGoogleAgain(): void;
}

/** Presentational part (rendered by the page and by component tests). */
export function SignInMethodsView(p: SignInMethodsViewProps) {
  const googleOnly = p.passkeys === 0;
  const canAddFirst = googleOnly && p.passkeySetupUntil !== null && p.passkeySetupUntil > p.nowSec;
  const passkeyText =
    p.passkeys === undefined
      ? "Add a passkey on another device so you can always sign in."
      : googleOnly
        ? "You sign in with Google. Add a passkey to confirm sensitive actions like payout destinations, refunds and API keys."
        : `${p.passkeys} ${p.passkeys === 1 ? "passkey" : "passkeys"}. Add one on another device so you can always sign in.`;
  return (
    <div className="np-stack" data-testid="sign-in-methods">
      {p.notice ? (
        <div data-testid="sign-in-methods-notice">
          <Note tone={p.notice.tone}>{p.notice.text}</Note>
        </div>
      ) : null}
      <div className="np-stack">
        <p className="np-text-h4">Passkeys</p>
        <p className="np-text-secondary">{passkeyText}</p>
        <div className="np-row">
          {googleOnly && !canAddFirst ? (
            <Button variant="secondary" onClick={p.onGoogleAgain}>
              Continue with Google to add a passkey
            </Button>
          ) : (
            <Button variant="secondary" busy={p.busy?.passkey} onClick={p.onAddPasskey}>
              Add a passkey
            </Button>
          )}
        </div>
        {p.needsGoogleAgain ? (
          <Note tone="warn">
            For your security, a first passkey can be added only within 10 minutes of signing in with Google. Continue
            with Google again, then add it.
          </Note>
        ) : null}
      </div>
      {p.googleEnabled || p.google ? (
        <div className="np-stack" data-testid="google-method">
          <p className="np-text-h4">Google</p>
          {p.google === undefined ? (
            <p className="np-text-secondary">Loading…</p>
          ) : p.google ? (
            <>
              <p className="np-row">
                <GoogleG size={16} />
                <span>
                  Connected to <strong>{p.google.email}</strong>. Continue with Google signs you in.
                </span>
              </p>
              <div className="np-row">
                <Button variant="secondary" busy={p.busy?.disconnect} disabled={googleOnly} onClick={p.onDisconnect}>
                  Disconnect Google
                </Button>
              </div>
              {googleOnly ? (
                <p className="np-text-caption np-text-secondary">
                  Add a passkey before disconnecting Google, so you can still sign in.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="np-text-secondary">
                Connect your Google account to sign in with one click. Sensitive actions still need your passkey.
              </p>
              <div>
                <GoogleButton label="Connect Google" busy={p.busy?.connect} onClick={p.onConnect} />
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The notice for `?google=linked` / `?google_error=` on the settings page. */
export function settingsNotice(search: string): SignInMethodsViewProps["notice"] {
  if (new URLSearchParams(search).get("google") === "linked")
    return { tone: "ok", text: "Google connected. You can now continue with Google to sign in." };
  const e = googleErrorMessage(googleErrorOf(search));
  return e ? { tone: "error", text: e } : null;
}

export function SignInMethods() {
  const app = useApp();
  const methods = useAuthMethods(app.api);
  const s = app.session;
  const linked = useAsync(() => app.api.call(listLinkedIdentities), [app.api]);
  const [confirm, setConfirm] = useState(false);
  const [needsGoogleAgain, setNeedsGoogleAgain] = useState(false);
  const [notice, setNotice] = useState(() => settingsNotice(app.location.search));
  useEffect(() => setNotice(settingsNotice(app.location.search)), [app.location.search]);

  const refreshSession = async () => {
    try {
      app.setSession(await app.api.call(getDashboardSession));
    } catch {
      // the next page load restores it
    }
  };
  const passkey = useMutation(async () => {
    try {
      const next = await registerPasskey(app.api, { passkeyName: "Additional passkey" });
      app.setSession(next);
      setNeedsGoogleAgain(false);
      setNotice({ tone: "ok", text: "Passkey added." });
    } catch (e) {
      if (e instanceof ApiError && e.code === "reauthentication_required") {
        setNeedsGoogleAgain(true);
        return;
      }
      throw e;
    }
  });
  const connect = useMutation(() => connectGoogle(app.api));
  const disconnect = useMutation(async () => {
    await app.api.call(unlinkIdentity, { params: { provider: "google" } });
    setConfirm(false);
    linked.reload();
    await refreshSession();
    setNotice({ tone: "ok", text: "Google disconnected. Sign in with your passkey." });
  });
  const googleAgain = () => void continueWithGoogle(app.api, { intent: "signin", next: ADD_PASSKEY_PATH });

  const google = linked.data
    ? (linked.data.data.find((l) => l.provider === "google") ?? null)
    : linked.error
      ? null
      : undefined;
  return (
    <Section title="Sign-in methods" level={3}>
      <SignInMethodsView
        passkeys={s?.sign_in?.passkeys}
        googleEnabled={methods?.google === true}
        google={google}
        passkeySetupUntil={s?.sign_in?.passkey_setup_until ?? null}
        nowSec={Math.floor(Date.now() / 1000)}
        notice={notice}
        needsGoogleAgain={needsGoogleAgain}
        busy={{ passkey: passkey.busy, connect: connect.busy, disconnect: disconnect.busy }}
        onAddPasskey={() => void passkey.run()}
        onConnect={() => void connect.run()}
        onDisconnect={() => setConfirm(true)}
        onGoogleAgain={googleAgain}
      />
      <ErrorNote error={passkey.error ?? connect.error ?? (confirm ? undefined : disconnect.error)} />
      {confirm ? (
        <Modal
          title="Disconnect Google?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button busy={disconnect.busy} onClick={() => void disconnect.run()}>
                Disconnect
              </Button>
            </>
          }
        >
          <p>
            You will sign in with your passkey only. Other sessions that were signed in with Google end. You can connect
            Google again later.
          </p>
          <ErrorNote error={disconnect.error} />
        </Modal>
      ) : null}
    </Section>
  );
}
