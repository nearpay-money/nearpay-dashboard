/** Spec-valid fixtures for the mock API (each is parsed by its `@nearpay/spec` schema). */
import {
  Account,
  AgentPayment,
  API_VERSION,
  ApiKey,
  BalanceTransaction,
  CheckoutSession,
  Event,
  PaymentIntent,
  SettlementDestination,
  WebhookDelivery,
  WebhookEndpoint,
  type z,
} from "@nearpay/spec";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
let seq = 0;
/** A valid TypeID-style id `<prefix>_01jbz9k3m4n5p6q7r8s9t0` + 4 base32 chars. */
export function newId<P extends string>(prefix: P): `${P}_${string}` {
  let n = ++seq;
  let tail = "";
  for (let i = 0; i < 4; i++) {
    tail = ALPHA[n % 32] + tail;
    n = Math.floor(n / 32);
  }
  return `${prefix}_01jbz9k3m4n5p6q7r8s9t0${tail}` as `${P}_${string}`;
}

export const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const NOW = Math.floor(Date.now() / 1000);
export const USDT_NEAR = "nep141:usdt.tether-token.near";
export const SOL_SOLANA = "nep141:sol.omft.near";
export const BTC_BITCOIN = "nep141:btc.omft.near";

export const ASSETS = {
  object: "list" as const,
  has_more: false as const,
  url: "/v1/assets" as const,
  data: [
    {
      asset_id: USDC_NEAR,
      object: "asset" as const,
      chain: "near:mainnet",
      symbol: "USDC",
      decimals: 6,
      family: "USDC",
      is_usd_stable: true,
    },
    {
      asset_id: USDC_BASE,
      object: "asset" as const,
      chain: "eip155:8453",
      symbol: "USDC",
      decimals: 6,
      family: "USDC",
      is_usd_stable: true,
    },
    // stage 4: auto-debit (USDT on NEAR) and Solana / Bitcoin settlement
    {
      asset_id: USDT_NEAR,
      object: "asset" as const,
      chain: "near:mainnet",
      symbol: "USDT",
      decimals: 6,
      family: "USDT",
      is_usd_stable: true,
    },
    {
      asset_id: SOL_SOLANA,
      object: "asset" as const,
      chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      symbol: "SOL",
      decimals: 9,
      family: "SOL",
      is_usd_stable: false,
    },
    {
      asset_id: BTC_BITCOIN,
      object: "asset" as const,
      chain: "bip122:000000000019d6689c085ae165831e93",
      symbol: "BTC",
      decimals: 8,
      family: "BTC",
      is_usd_stable: false,
    },
  ],
};

export type AccountT = z.output<typeof Account>;
export function account(over: Partial<AccountT> = {}): AccountT {
  return Account.parse({
    id: "acct_01jbz9k3m4n5p6q7r8s9t0v1w2",
    object: "account",
    created: NOW - 86_400,
    display_name: "Acme Coffee",
    verified_legal_name: null,
    country: "DE",
    status: "active",
    kyb_status: "not_started",
    live_enabled: false,
    fee_bearer: "payer",
    api_version: API_VERSION,
    settings: {
      late_payments: false,
      underpay_tolerance_bps: 0,
      session_ttl_default: 3600,
      email_receipts: true,
      branding: { accent_color: null, logo_url: null },
    },
    ...over,
  });
}

export type DestinationT = z.output<typeof SettlementDestination>;
export function destination(over: Partial<DestinationT> = {}): DestinationT {
  return SettlementDestination.parse({
    id: newId("sd"),
    object: "settlement_destination",
    created: NOW - 3600,
    livemode: false,
    asset_id: USDC_NEAR,
    type: "intents_account",
    chain: "near:mainnet",
    address: "acme.near",
    label: "Main USDC",
    status: "active",
    verification: "test",
    fingerprint: "YZMN-R81Z-BR",
    is_default: true,
    active_at: NOW - 3600,
    min_payment_amount: { amount: 100, currency: "usd" },
    per_payment_cap: null,
    disabled_reason: null,
    ...over,
  });
}

export type ApiKeyT = z.output<typeof ApiKey>;
export function apiKey(over: Partial<ApiKeyT> = {}): ApiKeyT {
  return ApiKey.parse({
    id: newId("key"),
    object: "api_key",
    created: NOW - 600,
    livemode: false,
    type: "secret",
    name: "Server",
    display_prefix: "sk_test_",
    last4: "a1b2",
    scopes: [],
    ip_allowlist: [],
    expires_at: null,
    last_used_at: null,
    ...over,
  });
}

export const secretFor = (type: "secret" | "publishable" | "restricted", live: boolean) =>
  `${type === "secret" ? "sk" : type === "restricted" ? "rk" : "pk"}_${live ? "live" : "test"}_${"A1b2C3d4".repeat(6)}`;

export type EndpointT = z.output<typeof WebhookEndpoint>;
export function endpoint(over: Partial<EndpointT> = {}): EndpointT {
  return WebhookEndpoint.parse({
    id: newId("we"),
    object: "webhook_endpoint",
    created: NOW - 300,
    livemode: false,
    url: "https://acme.example/webhooks",
    enabled_events: ["payment_intent.succeeded"],
    api_version: API_VERSION,
    description: null,
    status: "enabled",
    disabled_reason: null,
    ...over,
  });
}

export type DeliveryT = z.output<typeof WebhookDelivery>;
export function delivery(endpointId: string, over: Partial<DeliveryT> = {}): DeliveryT {
  return WebhookDelivery.parse({
    id: newId("whd"),
    object: "webhook_delivery",
    created: NOW - 120,
    livemode: false,
    webhook_endpoint: endpointId,
    event: newId("evt"),
    event_type: "payment_intent.succeeded",
    status: "succeeded",
    attempts: 1,
    last_status_code: 200,
    last_error: null,
    next_attempt_at: null,
    succeeded_at: NOW - 119,
    ...over,
  });
}

export type IntentT = z.output<typeof PaymentIntent>;
export function intent(over: Partial<IntentT> = {}): IntentT {
  const id = newId("pi");
  return PaymentIntent.parse({
    id,
    object: "payment_intent",
    created: NOW - 1200,
    livemode: false,
    status: "succeeded",
    amount: 200,
    currency: "usd",
    asset_id: null,
    description: "Flat white",
    source: "checkout",
    checkout_session: newId("cs"),
    destination: {
      settlement_destination: newId("sd"),
      asset_id: USDC_NEAR,
      type: "intents_account",
      chain: "near:mainnet",
      address: "merchant.near",
    },
    fee: { bearer: "payer", total_bps: 30 },
    settlement_asset_id: USDC_NEAR,
    amount_settled: "2000017",
    amount_refunded: "0",
    succeeded_at: NOW - 1100,
    late: false,
    canceled_at: null,
    cancellation_reason: null,
    review_reason: null,
    attempts: [
      {
        id: newId("pa"),
        object: "payment_attempt",
        created: NOW - 1180,
        status: "succeeded",
        method: "route_quote",
        origin_asset_id: USDC_BASE,
        origin_chain: "eip155:8453",
        settlement_amount: "2000017",
        settled_amount: "2000017",
        deadline: NOW - 600,
        is_overpayment: false,
        failure_code: null,
        evidence: {
          chain: "near:mainnet",
          tx_hash: "8xQ3mTn2LkPq7Rv9sW4yZb6cDfGhJk",
          block_ref: "223270700",
          recipient: "merchant.near",
          asset_id: USDC_NEAR,
          amount: "2000017",
          finality: "final",
          tier: "A",
          source: "indexer",
          observed_at: new Date((NOW - 1100) * 1000).toISOString(),
          explorer_url: null,
        },
      },
      {
        id: newId("pa"),
        object: "payment_attempt",
        created: NOW - 1190,
        status: "expired_unpaid",
        method: "route_quote",
        origin_asset_id: USDC_BASE,
        origin_chain: "eip155:8453",
        settlement_amount: "2000009",
        settled_amount: null,
        deadline: NOW - 700,
        is_overpayment: false,
        failure_code: "deposit_timeout",
        evidence: null,
      },
    ],
    overpayments: [],
    sequence: 5,
    metadata: { order_id: "42" },
    ...over,
  });
}

export function session(piId: string, csId: string) {
  return CheckoutSession.parse({
    id: csId,
    object: "checkout_session",
    created: NOW - 1250,
    livemode: false,
    status: "complete",
    url: null,
    client_secret: null,
    expires_at: NOW + 2000,
    payment_intent: piId,
    amount: 200,
    currency: "usd",
    asset_id: null,
    settlement_destination: newId("sd"),
    ui_mode: "hosted",
    success_url: "https://acme.example/thanks",
    cancel_url: null,
    description: "Flat white",
    allowed_origins: [],
    late_payments: false,
    locale: null,
    completed_at: NOW - 1100,
    late: false,
    metadata: {},
  });
}

export function statementLine(pi: IntentT) {
  const a = pi.attempts[0];
  return BalanceTransaction.parse({
    id: newId("txn"),
    object: "balance_transaction",
    created: NOW - 1100,
    livemode: false,
    type: "payment",
    payment_intent: pi.id,
    refund: null,
    gross: { amount: 200, currency: "usd" },
    settled: { amount: "2000017", asset_id: USDC_NEAR, decimals: 6, display: "2.000017 USDC (NEAR)" },
    fee: { bps: 30, amount_estimated: "6000", asset_id: USDC_NEAR },
    evidence: a?.evidence,
  });
}

export function agentPayment(over: Partial<z.output<typeof AgentPayment>> = {}) {
  return AgentPayment.parse({
    id: newId("ap"),
    object: "agent_payment",
    created: NOW - 400,
    livemode: false,
    kind: "x402",
    status: "settled",
    payer: "agent.near",
    pay_to: "merchant.near",
    asset_id: USDC_NEAR,
    amount: "10000",
    fee_amount: "30",
    binding: "np1:AQDxa2L6a5d8egVC7YP85UgtUCYp3cUotS6S3EsGcF7h",
    resource_url: "https://acme.example/premium",
    checkout_session: null,
    tx_hash: "5gHq2ZtXy8Wv3Rk",
    block_height: 223270701,
    error_reason: null,
    settled_at: NOW - 398,
    ...over,
  });
}

export function pingEvent(endpointId: string, id = newId("evt")) {
  return Event.parse({
    id,
    object: "event",
    type: "ping",
    api_version: API_VERSION,
    created: NOW - 10,
    livemode: false,
    data: { object: { object: "ping", webhook_endpoint: endpointId } },
    request: { id: null, idempotency_key: null },
  });
}

export function intentEvent(pi: IntentT) {
  return Event.parse({
    id: newId("evt"),
    object: "event",
    type: "payment_intent.succeeded",
    api_version: API_VERSION,
    created: NOW - 1100,
    livemode: false,
    data: { object: pi, previous_attributes: { status: "processing" } },
    request: { id: null, idempotency_key: null },
  });
}
