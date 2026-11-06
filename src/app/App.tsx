import { useEffect } from "react";
import { AgentPaymentDetail, AgentPayments } from "../features/agent-payments/AgentPayments";
import { SignIn } from "../features/auth/SignIn";
import { SignUp } from "../features/auth/SignUp";
import { VerifyMagicLink } from "../features/auth/VerifyMagicLink";
import { Developers } from "../features/developers/Developers";
import { Home } from "../features/home/Home";
import { PaymentDetail } from "../features/payments/PaymentDetail";
import { PaymentsList } from "../features/payments/PaymentsList";
import { Settings } from "../features/settings/Settings";
import { AddDestination } from "../features/settlement/AddDestination";
import { AttestPage } from "../features/settlement/Attest";
import { Destinations } from "../features/settlement/Destinations";
import { matchPath, type RouteSpec } from "../lib/router";
import { Loading } from "../ui/ui";
import { AppProvider, Link, useApp } from "./context";
import { Shell } from "./Shell";
import { StepUpDialog } from "./StepUp";

export const ROUTES: readonly RouteSpec[] = [
  { name: "signin", pattern: "/signin" },
  { name: "signup", pattern: "/signup" },
  { name: "verify", pattern: "/auth/verify" },
  { name: "home", pattern: "/" },
  { name: "payments", pattern: "/payments" },
  { name: "payment", pattern: "/payments/:id" },
  { name: "agent-payments", pattern: "/agent-payments" },
  { name: "agent-payment", pattern: "/agent-payments/:id" },
  { name: "settlement", pattern: "/settlement" },
  { name: "settlement-new", pattern: "/settlement/new" },
  { name: "settlement-attest", pattern: "/settlement/:id/attest" },
  { name: "developers", pattern: "/developers" },
  { name: "webhooks", pattern: "/developers/webhooks" },
  { name: "webhook", pattern: "/developers/webhooks/:id" },
  { name: "events", pattern: "/developers/events" },
  { name: "event", pattern: "/developers/events/:id" },
  { name: "settings", pattern: "/settings" },
];

const PUBLIC = new Set(["signin", "signup", "verify"]);

function Page() {
  const app = useApp();
  const m = matchPath(ROUTES, app.location.pathname);
  const isPublic = m !== null && PUBLIC.has(m.name);
  // wait for the session recovery (GET /v1/auth/session) before deciding where to go
  const needsSignIn = !app.restoring && !app.session && !isPublic;
  const signedInOnAuthPage = !app.restoring && app.session && (m?.name === "signin" || m?.name === "signup");

  useEffect(() => {
    if (needsSignIn) {
      const next = `${app.location.pathname}${app.location.search}`;
      app.navigate(next === "/" ? "/signin" : `/signin?next=${encodeURIComponent(next)}`, { replace: true });
    } else if (signedInOnAuthPage) {
      app.navigate("/", { replace: true });
    }
  }, [needsSignIn, signedInOnAuthPage, app]);

  if (app.restoring && !isPublic) return <Loading what="Restoring your session" />;
  if (needsSignIn || signedInOnAuthPage) return null;
  if (m?.name === "signin") return <SignIn />;
  if (m?.name === "signup") return <SignUp />;
  if (m?.name === "verify") return <VerifyMagicLink />;

  const id = m?.params.id ?? "";
  let body: React.JSX.Element;
  switch (m?.name) {
    case "home":
      body = <Home />;
      break;
    case "payments":
      body = <PaymentsList />;
      break;
    case "payment":
      body = <PaymentDetail id={id} />;
      break;
    case "agent-payments":
      body = <AgentPayments />;
      break;
    case "agent-payment":
      body = <AgentPaymentDetail id={id} />;
      break;
    case "settlement":
      body = <Destinations />;
      break;
    case "settlement-new":
      body = <AddDestination key={app.mode} />;
      break;
    case "settlement-attest":
      body = <AttestPage id={id} />;
      break;
    case "developers":
      body = <Developers tab="keys" />;
      break;
    case "webhooks":
      body = <Developers tab="webhooks" />;
      break;
    case "webhook":
      body = <Developers tab="webhook" id={id} />;
      break;
    case "events":
      body = <Developers tab="events" />;
      break;
    case "event":
      body = <Developers tab="event" id={id} />;
      break;
    case "settings":
      body = <Settings />;
      break;
    default:
      body = (
        <div className="page">
          <h1>Not found</h1>
          <Link to="/">Go home</Link>
        </div>
      );
  }
  return <Shell>{body}</Shell>;
}

export function App() {
  return (
    <AppProvider>
      <Page />
      <StepUpDialog />
    </AppProvider>
  );
}
