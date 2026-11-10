/**
 * Onboarding checklist (Figma "Let's get you ready to accept payments"): 01 account, 02 settlement
 * destination, 03 business details (self-declared, ADR-0020; live as soon as they are saved, no NearPay
 * review — ADR-0024; the form is the KYB page at `/settings/business`), 04 test payment; side card with
 * the live-mode requirements.
 */
import { buttonClassName, Card, CardTitle, StatusBadge, type StepItem, Steps } from "@nearpay-internal/ui";
import { useState } from "react";
import { useApp } from "../../app/context";
import { hrefFor } from "../../lib/mode";
import { statusOf } from "../../lib/status";
import { Page } from "../../ui/page";

export const BUSINESS_DETAILS_PATH = "/settings/business";

function LinkButton({ href, label, primary }: { href: string; label: string; primary: boolean }) {
  return (
    <a
      href={href}
      className={buttonClassName({ variant: primary ? "primary" : "secondary", size: "md" }, "dash-step-action")}
    >
      <span>{label}</span>
    </a>
  );
}

export function Checklist({ hasTestPayment }: { hasTestPayment: boolean }) {
  const app = useApp();
  const req = app.requirements;
  const missing = new Set(req?.missing ?? []);
  const kyb = app.account?.kyb_status ?? "not_started";
  const destDone = Boolean(req) && !missing.has("destination");
  const kybDone = Boolean(req) && !missing.has("kyb");
  const name = app.account?.display_name ?? app.session?.account.display_name ?? "Your account";
  const done = [true, destDone, kybDone, hasTestPayment];
  const current = done.indexOf(false);
  const status = (i: number): StepItem["status"] => (done[i] ? "complete" : i === current ? "current" : "upcoming");
  const kybState = statusOf("kyb", kyb);
  const kybAction =
    kyb === "pending"
      ? "View details"
      : kyb === "needs_info"
        ? "Update details"
        : kyb === "rejected"
          ? "View details"
          : "Start";
  const items: StepItem[] = [
    { id: "account", title: "Create your account", description: `${name} · Passkey secured`, status: "complete" },
    {
      id: "destination",
      title: "Choose where you receive payments",
      description: "Pick a token, network and wallet you control.",
      status: status(1),
      action: (
        <LinkButton
          href={hrefFor("/settlement/new", "live")}
          label={current === 1 ? "Continue" : "Add destination"}
          primary={current === 1}
        />
      ),
    },
    {
      id: "business",
      title: "Add your business details",
      description: (
        <>
          Required to accept live payments. Live as soon as you save them.{" "}
          {kyb !== "not_started" && !kybDone ? <StatusBadge tone={kybState.tone}>{kybState.label}</StatusBadge> : null}
        </>
      ),
      status: status(2),
      action: <LinkButton href={app.href(BUSINESS_DETAILS_PATH)} label={kybAction} primary={current === 2} />,
    },
    {
      id: "test-payment",
      title: "Make a test payment",
      description: "See the full checkout and settlement experience.",
      status: status(3),
      action: <LinkButton href={hrefFor("/developers/start", "test")} label="Try it" primary={current === 3} />,
    },
  ];
  return (
    <div data-testid="requirements">
      <Steps items={items} label="Steps to accept payments" />
    </div>
  );
}

export function LiveStatusCard() {
  const app = useApp();
  const req = app.requirements;
  const [open, setOpen] = useState(false);
  if (!req) return null;
  const missing = new Set(req.missing);
  if (req.live_enabled) {
    return (
      <Card as="aside" className="dash-side-card" aria-label="Live payments">
        <div className="np-stack">
          <StatusBadge tone="success">Live</StatusBadge>
          <CardTitle>Live payments are active</CardTitle>
          <p className="np-text-secondary">
            You're live — you can accept real payments. Your business details are saved and a live destination is
            active.
          </p>
        </div>
      </Card>
    );
  }
  const kyb = statusOf("kyb", app.account?.kyb_status ?? "not_started");
  return (
    <Card as="aside" className="dash-side-card" aria-label="Live payments">
      <div className="np-stack">
        <StatusBadge tone="warning">Pending</StatusBadge>
        <CardTitle>Live payments are not active yet</CardTitle>
        <p className="np-text-secondary">
          Add your business details and activate a settlement destination. A new destination may take effect after a
          short security hold.
        </p>
        <button
          type="button"
          className={buttonClassName({ variant: "secondary", fullWidth: true })}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span>{open ? "Hide requirements" : "View requirements"}</span>
        </button>
        {open ? (
          <ul className="dash-requirements" aria-label="Live mode requirements">
            <li>
              <span>Business details saved</span>
              <StatusBadge tone={missing.has("kyb") ? kyb.tone : "success"}>
                {missing.has("kyb") ? kyb.label : "Done"}
              </StatusBadge>
            </li>
            <li>
              <span>An active live settlement destination</span>
              <StatusBadge tone={missing.has("destination") ? "warning" : "success"}>
                {missing.has("destination") ? "Missing" : "Done"}
              </StatusBadge>
            </li>
            {missing.has("account_status") ? (
              <li>
                <span>Account in good standing — contact support</span>
                <StatusBadge tone="danger">Blocked</StatusBadge>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

/** `/setup` and the first-run Overview. */
export function Setup({ hasTestPayment = false }: { hasTestPayment?: boolean }) {
  return (
    <Page
      title="Let’s get you ready to accept payments."
      subtitle="Try a payment first. Activate live payments when your business is ready."
    >
      <div className="dash-detail">
        <Checklist hasTestPayment={hasTestPayment} />
        <LiveStatusCard />
      </div>
    </Page>
  );
}
