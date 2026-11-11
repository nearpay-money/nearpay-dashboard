/**
 * Step-up dialog: shown when an endpoint answers `401 step_up_required` (identity §6). Step-ups are passkey
 * assertions only (ADR-0026): a user without a passkey (signed up with Google) is asked to add one — right
 * here within 10 minutes of the Google sign-in, else after continuing with Google again.
 */
import { useState } from "react";
import { continueWithGoogle } from "../features/auth/google";
import { registerPasskey, stepUpWithPasskey } from "../features/auth/passkeys";
import { ApiError, StepUpCanceled } from "../lib/errors";
import { Button, ErrorNote, Modal } from "../ui/ui";
import { useApp } from "./context";

export type StepUpMode = "confirm" | "add_passkey" | "google_again";

/** What the dialog offers for a session (spec 0.5.1 `DashboardSession.sign_in`; older servers: confirm). */
export function stepUpMode(
  signIn: { passkeys: number; passkey_setup_until: number | null } | undefined,
  nowSec: number,
): StepUpMode {
  if (!signIn || signIn.passkeys > 0) return "confirm";
  return signIn.passkey_setup_until !== null && signIn.passkey_setup_until > nowSec ? "add_passkey" : "google_again";
}

export function StepUpDialog() {
  const { stepUp, api, session, setSession, location } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [forced, setForced] = useState<StepUpMode>();
  if (!stepUp) return null;
  const mode = forced ?? stepUpMode(session?.sign_in, Math.floor(Date.now() / 1000));
  const cancel = () => {
    setError(undefined);
    setForced(undefined);
    stepUp.reject(new StepUpCanceled());
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.code === "passkey_required") setForced("add_passkey");
      else if (e instanceof ApiError && e.code === "reauthentication_required") setForced("google_again");
      else setError(e);
    } finally {
      setBusy(false);
    }
  };
  const confirm = () =>
    run(async () => {
      await stepUpWithPasskey(api);
      setForced(undefined);
      stepUp.resolve();
    });
  const addPasskey = () =>
    run(async () => {
      setForced("add_passkey"); // keep this view while the new passkey confirms (the session now has a passkey)
      setSession(await registerPasskey(api, { passkeyName: "Passkey" }));
      // the new passkey confirms the original action right away
      await stepUpWithPasskey(api);
      setForced(undefined);
      stepUp.resolve();
    });
  const googleAgain = () =>
    run(async () => {
      const here = `${location.pathname}${location.search}`;
      await continueWithGoogle(api, { intent: "signin", next: here });
    });

  if (mode === "confirm")
    return (
      <Modal
        title="Confirm it's you"
        className="dash-stepup"
        onClose={cancel}
        footer={
          <>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button busy={busy} onClick={confirm}>
              Confirm with passkey
            </Button>
          </>
        }
      >
        <p>
          This action changes keys, destinations or money settings. Confirm with your passkey; the confirmation lasts 10
          minutes.
        </p>
        <ErrorNote error={error} />
      </Modal>
    );
  return (
    <Modal
      title="Add a passkey to continue"
      className="dash-stepup"
      onClose={cancel}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          {mode === "add_passkey" ? (
            <Button busy={busy} onClick={addPasskey}>
              Add a passkey
            </Button>
          ) : (
            <Button busy={busy} onClick={googleAgain}>
              Continue with Google
            </Button>
          )}
        </>
      }
    >
      <p>
        Changes to keys, payout destinations, refunds and your team are confirmed with a passkey, not with Google. Add a
        passkey on this device to continue.
      </p>
      {mode === "google_again" ? (
        <p className="np-text-secondary">
          For your security, a first passkey can be added only within 10 minutes of signing in with Google. Continue
          with Google again, then add it.
        </p>
      ) : null}
      <ErrorNote error={error} />
    </Modal>
  );
}
