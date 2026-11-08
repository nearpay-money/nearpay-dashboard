/**
 * PLACEHOLDER — `@nearpay/spec` 0.4.0 contracts used before 0.4.0 is published (step 4.3 Phase A).
 *
 * Copied from nearpay-spec `stage-4/4.1-contracts` (`src/public/mandates.ts`, `subscriptions.ts`,
 * `identity.ts`, `webhooks/events.ts`, `src/common/chains.ts`), built on the 0.3.1 helpers. This is the
 * ONLY file with spec gap types. Phase B: bump `@nearpay/spec` to 0.4.0, import every name below from
 * `@nearpay/spec` instead (same names; the `*V4` route overrides become the plain routes), delete this
 * file and drop the `NEXT_ROUTES` merge in `test/e2e/mock-api.ts`.
 */
import {
  AssetId,
  attestSettlementDestination as attestSettlementDestinationV3,
  BaseUnits,
  closedEnum,
  createdFilterShape,
  createSubscription as createSubscriptionV3,
  type ErrorCode,
  Event,
  EventEnvelopeLoose,
  getEvent as getEventV3,
  id,
  InvoiceSecretHeaders,
  inp,
  Livemode,
  listEvents as listEventsV3,
  listOf,
  listQueryShape,
  NearAccountId,
  openEnum,
  out,
  route,
  SUBSCRIPTION_ROLES,
  TxHash,
  UnixTime,
  updateSubscription as updateSubscriptionV3,
  z,
} from "@nearpay/spec";

// =============================================================================================
// NEAR transactions for the payer's / merchant's wallet (mandates.ts)
// =============================================================================================

const GasUnits = z
  .string()
  .regex(/^[1-9][0-9]{0,17}$/)
  .describe("Gas in gas units as a decimal string (1 Tgas = 10^12).");
const Yocto = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,38})$/)
  .describe("Attached deposit in yoctoNEAR as a decimal string.");

export const NearFunctionCallAction = out({
  type: z.literal("FunctionCall"),
  method_name: z.string().min(1).max(256),
  args: z.record(z.string(), z.unknown()),
  gas: GasUnits,
  deposit: Yocto,
});

export const NearTransactionRequest = out({
  signer_id: NearAccountId.nullable(),
  receiver_id: NearAccountId,
  actions: z.array(NearFunctionCallAction).min(1).max(4),
});
export type NearTransactionRequest = z.infer<typeof NearTransactionRequest>;

// =============================================================================================
// Mandate
// =============================================================================================

export const VaultReceiverKind = closedEnum(["intents_account", "near_account"], "Merchant share delivery.");

export const MandateStatus = openEnum(["active", "insufficient", "exhausted", "canceled"], "Mandate status.");
export const MandateLinkStatus = openEnum(["linked", "unlinked"], "Link status.");
export const MANDATE_UNLINKED_REASONS = [
  "subscription_not_auto_debit",
  "subscription_ended",
  "already_linked",
  "receiver_kind_mismatch",
  "receiver_not_destination",
  "token_mismatch",
  "amount_mismatch",
  "period_mismatch",
  "fee_mismatch",
  "start_too_late",
  "max_periods_too_low",
  "mode_mismatch",
] as const;
export const MandateUnlinkedReason = openEnum(MANDATE_UNLINKED_REASONS, "Why a mandate is unlinked.");

export const MandateCollection = out({
  period: z.int().min(1),
  amount: BaseUnits,
  merchant_share: BaseUnits,
  fee: BaseUnits,
  short: z.boolean(),
  invoice: id("in").nullable(),
  tx_hash: TxHash,
  receipt_id: z.string().min(1).max(64),
  collected_at: UnixTime,
});
export type MandateCollection = z.infer<typeof MandateCollection>;

export const Mandate = out({
  id: id("md"),
  object: z.literal("mandate"),
  created: UnixTime,
  livemode: Livemode,
  status: MandateStatus,
  link_status: MandateLinkStatus,
  unlinked_reason: MandateUnlinkedReason.nullable(),
  collecting: z.boolean(),
  subscription: id("sub"),
  customer: id("cus"),
  vault_contract: NearAccountId,
  onchain_id: z.int().min(0),
  payer: NearAccountId,
  token: NearAccountId,
  asset_id: AssetId,
  merchant_receiver: NearAccountId,
  receiver_kind: VaultReceiverKind,
  settlement_destination: id("sd").nullable(),
  amount_per_period: BaseUnits,
  period_secs: z.int().min(86_400),
  start_at: UnixTime,
  max_periods: z.int().min(1).nullable(),
  fee_bps: z.int().min(0).max(10_000),
  collected_periods: z.int().min(0),
  balance: BaseUnits,
  funded_periods: z.int().min(0),
  next_collect_at: UnixTime.nullable(),
  last_collection: MandateCollection.nullable(),
  collect_failures: z.int().min(0),
  canceled: out({
    by: NearAccountId,
    by_role: openEnum(["payer", "merchant_receiver"], "Role of `by`."),
    refunded: BaseUnits,
    canceled_at: UnixTime,
  }).nullable(),
  withdrawn: BaseUnits,
  ext_ref: z.string().max(64),
  sequence: z.int().min(0),
});
export type Mandate = z.infer<typeof Mandate>;

/** Default `payer_notice` billing returns (UIs may localise it without weakening it). */
export const MANDATE_FUNDING_PAYER_NOTICE =
  "Sign both transactions from your own NEAR account and pay the gas yourself. Relayer or gasless wallets, NEAR Intents balances, bridges and smart wallets cannot fund a mandate: the vault refunds such deposits. You can cancel at any time from any NEAR wallet and get the remaining balance back.";

export const MandateFundingInstructions = out({
  object: z.literal("mandate_funding_instructions"),
  livemode: Livemode,
  subscription: id("sub"),
  vault_contract: NearAccountId,
  token: NearAccountId,
  asset_id: AssetId,
  amount: BaseUnits,
  periods: z.int().min(1),
  amount_per_period: BaseUnits,
  period_secs: z.int().min(86_400),
  start_at: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,19})$/)
    .nullable(),
  fee_bps: z.int().min(0).max(10_000),
  merchant_receiver: NearAccountId,
  receiver_kind: VaultReceiverKind,
  settlement_destination: id("sd"),
  ext_ref: z.string().max(64),
  msg: z.string().max(2048),
  payer: NearAccountId.nullable(),
  storage: out({
    payer_registered: z.boolean().nullable(),
    deposit: z.string().regex(/^(0|[1-9][0-9]{0,38})$/),
  }),
  payer_notice: z.string(),
  transactions: z.array(NearTransactionRequest).min(1).max(2),
});
export type MandateFundingInstructions = z.infer<typeof MandateFundingInstructions>;

const FundingBody = {
  payer: NearAccountId.optional(),
  token: NearAccountId.optional(),
  periods: z.int().min(1).max(36).optional(),
};

const e4 = (...codes: string[]) => codes as unknown as ErrorCode[];
const FUNDING_ERRORS = e4(
  "state_conflict",
  "auto_debit_unavailable",
  "destination_not_intents_account",
  "vault_cap_exceeded",
  "account_not_live",
  "rail_unavailable",
);
const MandateParams = inp({ id: id("md") });
const WRITE = ["secret_key", "restricted_key:subscriptions.write", "session"] as const;
const READ = ["secret_key", "restricted_key:subscriptions.read", "session"] as const;

export const prepareMandate = route({
  id: "prepareMandate",
  method: "POST",
  path: "/v1/mandates/prepare",
  service: "billing",
  visibility: "public",
  summary: "Compute what a payer signs to fund an auto-debit mandate for a subscription.",
  auth: WRITE,
  roles: SUBSCRIPTION_ROLES,
  idempotent: true,
  body: inp({ subscription: id("sub"), ...FundingBody }),
  response: MandateFundingInstructions,
  status: 200,
  errors: FUNDING_ERRORS,
  stage: 4,
});

export const getMandate = route({
  id: "getMandate",
  method: "GET",
  path: "/v1/mandates/{id}",
  service: "billing",
  visibility: "public",
  summary: "Retrieve a mandate.",
  auth: READ,
  idempotent: false,
  params: MandateParams,
  response: Mandate,
  status: 200,
  errors: [],
  stage: 4,
});

export const listMandates = route({
  id: "listMandates",
  method: "GET",
  path: "/v1/mandates",
  service: "billing",
  visibility: "public",
  summary: "List mandates.",
  auth: READ,
  idempotent: false,
  query: inp({
    ...listQueryShape,
    ...createdFilterShape,
    subscription: id("sub").optional(),
    customer: id("cus").optional(),
    status: MandateStatus.optional(),
    link_status: MandateLinkStatus.optional(),
    payer: NearAccountId.optional(),
  }),
  response: listOf(Mandate, "MandateList", "A page of mandates."),
  status: 200,
  errors: [],
  stage: 4,
});

export const MandateCancelInstructions = out({
  object: z.literal("mandate_cancel_instructions"),
  mandate: id("md"),
  transaction: NearTransactionRequest,
});
export type MandateCancelInstructions = z.infer<typeof MandateCancelInstructions>;

export const prepareMandateCancel = route({
  id: "prepareMandateCancel",
  method: "POST",
  path: "/v1/mandates/{id}/prepare_cancel",
  service: "billing",
  visibility: "public",
  summary: "Get the transaction the merchant receiver signs to cancel a mandate.",
  auth: WRITE,
  roles: SUBSCRIPTION_ROLES,
  idempotent: true,
  params: MandateParams,
  response: MandateCancelInstructions,
  status: 200,
  errors: e4("state_conflict"),
  stage: 4,
});

export const MandateSimulation = out({
  object: z.literal("mandate_simulation"),
  action: openEnum(["fund", "top_up", "cancel", "withdraw"], "Simulated payer action."),
  tx_hash: TxHash,
  accepted: z.boolean(),
  rejection: z.string().nullable(),
  onchain_id: z.int().min(0).nullable(),
  logs: z.array(z.string()),
});
export type MandateSimulation = z.infer<typeof MandateSimulation>;

const TEST_HELPER_ROLES = ["owner", "admin", "developer"] as const;

export const simulateMandateFunding = route({
  id: "simulateMandateFunding",
  method: "POST",
  path: "/v1/test_helpers/mandates/fund",
  service: "billing",
  visibility: "public",
  summary: "Test mode: fund a mandate for a subscription as the simulated payer.",
  auth: WRITE,
  roles: TEST_HELPER_ROLES,
  idempotent: true,
  testModeOnly: true,
  body: inp({ subscription: id("sub"), ...FundingBody }),
  response: MandateSimulation,
  status: 200,
  errors: e4(
    "livemode_forbidden",
    "state_conflict",
    "auto_debit_unavailable",
    "destination_not_intents_account",
    "vault_cap_exceeded",
    "rail_unavailable",
  ),
  stage: 4,
});

export const simulateMandatePayerAction = route({
  id: "simulateMandatePayerAction",
  method: "POST",
  path: "/v1/test_helpers/mandates/{id}/payer_action",
  service: "billing",
  visibility: "public",
  summary: "Test mode: top up, cancel or withdraw a mandate as its payer.",
  auth: WRITE,
  roles: TEST_HELPER_ROLES,
  idempotent: true,
  testModeOnly: true,
  params: MandateParams,
  body: inp({
    action: closedEnum(["top_up", "cancel", "withdraw"], "Payer action."),
    periods: z.int().min(1).max(36).optional(),
  }),
  response: MandateSimulation,
  status: 200,
  errors: e4("livemode_forbidden"),
  stage: 4,
});

/** The hosted invoice page's payer view (checkout uses it; listed so the mock knows the path). */
export const getPublicInvoiceMandate = route({
  id: "getPublicInvoiceMandate",
  method: "GET",
  path: "/v1/invoices/{id}/public/mandate",
  service: "billing",
  visibility: "public",
  summary: "Hosted invoice page: the subscription's mandate with the payer's transactions.",
  auth: ["anonymous"],
  idempotent: false,
  params: inp({ id: id("in") }),
  headers: InvoiceSecretHeaders,
  response: out({ id: id("md"), object: z.literal("mandate") }),
  status: 200,
  errors: e4("invoice_secret_invalid"),
  stage: 4,
});

// =============================================================================================
// Additive fields and widened request bodies (invoices.ts, subscriptions.ts, identity.ts)
// =============================================================================================

export const COLLECTION_METHODS = ["send_invoice", "auto_debit"] as const;
export type CollectionMethodV4 = (typeof COLLECTION_METHODS)[number];
const CollectionMethodInput = closedEnum(COLLECTION_METHODS, "How invoices are collected.");

/** `Invoice.mandate_collection` (0.4.0): set when a vault collection paid the invoice. */
export const InvoiceMandateCollection = out({
  mandate: id("md"),
  period: z.int().min(1),
  token: AssetId,
  merchant_share: BaseUnits,
  fee: BaseUnits,
  tx_hash: TxHash,
  receipt_id: z.string().min(1).max(64),
});
export type InvoiceMandateCollection = z.infer<typeof InvoiceMandateCollection>;

/** Reads the 0.4.0 `Invoice.mandate_collection` kept by the tolerant parser (unknown fields pass). */
export function invoiceMandateCollection(inv: object): InvoiceMandateCollection | null {
  const r = InvoiceMandateCollection.safeParse((inv as { mandate_collection?: unknown }).mandate_collection);
  return r.success ? r.data : null;
}

/** Reads the 0.4.0 `Subscription.mandate` / `Invoice.mandate` (the linked mandate id), or null. */
export function linkedMandateId(o: object): string | null {
  const v = (o as { mandate?: unknown }).mandate;
  return typeof v === "string" && /^md_/.test(v) ? v : null;
}

export const createSubscriptionV4 = route({
  ...createSubscriptionV3,
  body: (createSubscriptionV3.body as NonNullable<typeof createSubscriptionV3.body>).extend({ collection_method: CollectionMethodInput.optional() }),
  errors: [...createSubscriptionV3.errors, ...e4("auto_debit_unavailable")],
  stage: 3,
});

export const updateSubscriptionV4 = route({
  ...updateSubscriptionV3,
  body: (updateSubscriptionV3.body as NonNullable<typeof updateSubscriptionV3.body>).extend({ collection_method: CollectionMethodInput.optional() }),
  errors: [...updateSubscriptionV3.errors, ...e4("auto_debit_unavailable")],
  stage: 3,
});

export const DESTINATION_SIGNING_STANDARDS = ["nep413", "eip191", "solana", "bip322"] as const;
export type SigningStandard = (typeof DESTINATION_SIGNING_STANDARDS)[number];

export const attestSettlementDestinationV4 = route({
  ...attestSettlementDestinationV3,
  body: (attestSettlementDestinationV3.body as NonNullable<typeof attestSettlementDestinationV3.body>).extend({
    standard: closedEnum(DESTINATION_SIGNING_STANDARDS, "Signing standard."),
  }),
  stage: 1,
});

// =============================================================================================
// Events (webhooks/events.ts): `mandate.*`
// =============================================================================================

export const MANDATE_WEBHOOK_TYPES = [
  "mandate.activated",
  "mandate.collected",
  "mandate.insufficient_funds",
  "mandate.canceled",
  "mandate.exhausted",
  "mandate.updated",
  "mandate.unlinked",
  "mandate.released",
] as const;

const MandateEvent = EventEnvelopeLoose.extend({
  type: z.enum(MANDATE_WEBHOOK_TYPES),
  data: out({ object: Mandate, previous_attributes: z.record(z.string(), z.unknown()).optional() }),
});
const AnyEvent = z.union([Event, MandateEvent]);
export type AnyEvent = z.infer<typeof AnyEvent>;

export const listEventsV4 = route({
  ...listEventsV3,
  response: listOf(AnyEvent, "EventList", "A page of events."),
  stage: 1,
});
export const getEventV4 = route({ ...getEventV3, response: AnyEvent, stage: 1 });

// =============================================================================================
// Chains (common/chains.ts)
// =============================================================================================

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;
export const BITCOIN_MAINNET = "bip122:000000000019d6689c085ae165831e93" as const;
/** Wire shape of a Bitcoin destination (P2WPKH / P2TR, lower-case); checksum checked in `lib/chains`. */
export const BITCOIN_DESTINATION_RE = /^bc1(q[02-9ac-hj-np-z]{38}|p[02-9ac-hj-np-z]{58})$/;
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// =============================================================================================
// Mock wiring: the routes above replace or extend the 0.3.1 route table (test mock only)
// =============================================================================================

export const NEXT_ROUTES = [
  prepareMandate,
  getMandate,
  listMandates,
  prepareMandateCancel,
  simulateMandateFunding,
  simulateMandatePayerAction,
  getPublicInvoiceMandate,
  createSubscriptionV4,
  updateSubscriptionV4,
  attestSettlementDestinationV4,
  listEventsV4,
  getEventV4,
] as const;
