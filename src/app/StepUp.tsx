/** Step-up dialog: shown when an endpoint answers `401 step_up_required` (identity §6). */
import { useState } from "react";
import { stepUpWithPasskey } from "../features/auth/passkeys";
import { StepUpCanceled } from "../lib/errors";
import { Button, ErrorNote, Modal } from "../ui/ui";
import { useApp } from "./context";

export function StepUpDialog() {
  const { stepUp, api } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  if (!stepUp) return null;
  const cancel = () => {
    setError(undefined);
    stepUp.reject(new StepUpCanceled());
  };
  return (
    <Modal
      title="Confirm it's you"
      onClose={cancel}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await stepUpWithPasskey(api);
                stepUp.resolve();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
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
}
