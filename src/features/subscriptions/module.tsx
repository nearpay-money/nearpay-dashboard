/**
 * Subscriptions module (lld/billing.md §4, §11 d8–d9, spec `subscriptions`; Figma b02 "Subscriptions"):
 * Billing → Subscriptions tab, create, detail (cancel now / at period end, upcoming renewal, dunning).
 */
import { createSubscription, getSubscription, listSubscriptions } from "@nearpay/spec";
import { lazyPage } from "../../app/lazy";
import { defineFeature } from "../../app/registry";

const SubscriptionsTab = lazyPage(() => import("./SubscriptionList"), "SubscriptionsTab", "Loading subscriptions");
const SubscriptionDetail = lazyPage(() => import("./SubscriptionDetail"), "SubscriptionDetail", "Loading subscription");
const NewSubscription = lazyPage(() => import("./SubscriptionForm"), "NewSubscription", "Loading subscription form");

export default defineFeature({
  id: "subscriptions",
  routes: [
    {
      name: "subscriptions",
      pattern: "/billing/subscriptions",
      section: "billing",
      title: "Subscriptions",
      stage: 3,
      roles: listSubscriptions.roles,
      render: () => <SubscriptionsTab />,
    },
    {
      name: "subscription-new",
      pattern: "/billing/subscriptions/new",
      section: "billing",
      title: "New subscription",
      stage: 3,
      roles: createSubscription.roles,
      render: () => <NewSubscription />,
    },
    {
      name: "subscription",
      pattern: "/billing/subscriptions/:id",
      section: "billing",
      title: "Subscription",
      stage: 3,
      roles: getSubscription.roles,
      render: (p) => <SubscriptionDetail id={p.id ?? ""} />,
    },
  ],
});
