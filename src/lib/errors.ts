/** API errors as the dashboard sees them (error envelope, api-conventions §6). */
import { HEADERS } from "@nearpay-money/spec";

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  readonly param: string | undefined;
  readonly requestId: string | undefined;

  constructor(o: { status: number; type: string; code: string; message: string; param?: string; requestId?: string }) {
    super(o.message);
    this.name = "ApiError";
    this.status = o.status;
    this.type = o.type;
    this.code = o.code;
    this.param = o.param;
    this.requestId = o.requestId;
  }

  static async fromResponse(res: Response): Promise<ApiError> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const e = (body as { error?: Record<string, unknown> } | undefined)?.error;
    const requestId = res.headers.get(HEADERS.requestId) ?? undefined;
    if (e && typeof e.code === "string" && typeof e.message === "string") {
      return new ApiError({
        status: res.status,
        type: typeof e.type === "string" ? e.type : "api_error",
        code: e.code,
        message: e.message,
        param: typeof e.param === "string" ? e.param : undefined,
        requestId: typeof e.request_id === "string" ? e.request_id : requestId,
      });
    }
    return new ApiError({
      status: res.status,
      type: res.status >= 500 ? "api_error" : "invalid_request_error",
      code: res.status >= 500 ? "api_error" : "http_error",
      message: `The API answered ${res.status}.`,
      requestId,
    });
  }
}

/** Thrown when the user dismisses the step-up dialog. */
export class StepUpCanceled extends Error {
  constructor() {
    super("Confirmation canceled.");
    this.name = "StepUpCanceled";
  }
}

/** Friendly copy for API error codes (the API's own message is kept as the detail). */
const FRIENDLY: Readonly<Record<string, string>> = {
  authentication_required: "Your session ended. Sign in again to continue.",
  csrf_token_invalid: "Your session ended. Sign in again to continue.",
  permission_denied: "Your role can't do this. Ask an owner or admin.",
  step_up_required: "Confirm it's you with your passkey to continue.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  idempotency_in_progress: "This request is still being processed. Try again in a moment.",
  resource_missing: "We couldn't find this. It may have been removed or belong to the other mode.",
  state_conflict: "This changed in the meantime. Refresh and try again.",
  invalid_request: "Some details aren't valid. Check the form and try again.",
  invalid_response: "We received an unexpected response. Refresh the page; if it persists, contact support.",
  api_error: "Something went wrong on our side. Try again.",
  http_error: "The request failed. Try again.",
  account_not_live: "Live mode is not enabled yet. Finish the setup checklist first.",
  approver_conflict: "Another owner or admin must approve this. You created or already approved it.",
  attestation_invalid: "The wallet signature didn't match the challenge. Sign again with the destination's wallet.",
  scope_unknown: "One of the selected permissions isn't recognised. Refresh and try again.",
  invalid_setting: "One of the settings isn't valid.",
  link_expired: "This link has expired. Request a new one.",
  // Continue with Google (spec 0.5.1, ADR-0026)
  google_signin_disabled: "Continue with Google isn't available right now. Use your passkey.",
  google_already_linked: "Your user is already connected to a Google account. Disconnect it first.",
  passkey_required: "Add a passkey first. Sensitive actions are confirmed with a passkey.",
  reauthentication_required: "Continue with Google again, then add your passkey within 10 minutes.",
  // billing (spec 0.3.0)
  currency_mismatch: "Every line must use the invoice currency. Pick prices in the same currency.",
  currency_unsupported: "NearPay can't take payments in this currency yet. Choose another currency.",
  interval_mismatch: "All prices of a subscription must bill on the same schedule (for example, monthly).",
  price_inactive: "One of the prices is archived. Choose an active price.",
  price_type_invalid: "Invoices take one-time prices; subscriptions take recurring prices.",
  tax_rate_inactive: "One of the tax rates is archived. Choose an active rate.",
  tax_rates_mixed: "A line can't mix inclusive and exclusive tax rates.",
  invoice_empty: "Add at least one line with an amount above zero.",
  customer_email_missing: "This customer has no email address. Add one on the customer page, then send again.",
  customer_deleted: "This customer was deleted. Choose another customer.",
  attempt_in_flight: "A payment for this invoice may still be settling. Try again in a few minutes.",
  destination_not_active:
    "Your settlement destination isn't active yet. Activate a destination in Settlement, then try again.",
  amount_below_destination_minimum: "The total is below the minimum your settlement destination accepts.",
  invoice_not_payable: "This invoice can't be paid right now.",
  // stage 4 (spec 0.4.0): auto-debit and Solana/Bitcoin destinations
  auto_debit_unavailable:
    "Auto-debit isn't available for this subscription's prices. It needs USD (paid in USDC or USDT) or an allowed NEAR token, within the vault's per-period cap.",
  vault_cap_exceeded:
    "That funding is above what the auto-debit vault accepts right now. Choose fewer periods and try again.",
  destination_not_intents_account:
    "Auto-debit pays collections to a NEAR Intents account. Add or activate one in Settlement, then try again.",
  rail_unavailable: "NEAR can't be reached right now. Try again in a minute.",
  address_invalid: "This address isn't valid for the selected network. Check it for typos.",
  asset_unsupported: "NearPay can't settle this token on that network yet. Choose another token.",
  challenge_expired: "The signing request expired. Start the verification again.",
};

export interface FriendlyError {
  /** Short sentence for the callout title. */
  readonly title: string;
  /** The API's message (or the error message), for the callout body. */
  readonly detail: string;
  /** "Reference req_… · code" for support, when the API sent a request id. */
  readonly reference: string | undefined;
  /** Whether retrying the same request can help (network, 5xx, rate limits, conflicts). */
  readonly retryable: boolean;
}

/** Maps any thrown value to copy for an error callout. */
export function friendlyError(e: unknown): FriendlyError {
  if (e instanceof ApiError) {
    return {
      title: FRIENDLY[e.code] ?? (e.status >= 500 ? (FRIENDLY.api_error as string) : e.message),
      detail: e.message,
      reference: e.requestId ? `Reference ${e.requestId} · ${e.code}` : e.code,
      retryable: e.status >= 500 || e.status === 429 || e.status === 409 || e.code === "invalid_response",
    };
  }
  if (e instanceof StepUpCanceled) return { title: e.message, detail: "", reference: undefined, retryable: false };
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) {
    return {
      title: "We couldn't reach NearPay. Check your connection and try again.",
      detail: e.message,
      reference: undefined,
      retryable: true,
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { title: message, detail: "", reference: undefined, retryable: false };
}

/** A short message for the UI, with the request id for support. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError)
    return e.requestId ? `${e.message} (${e.code}, ${e.requestId})` : `${e.message} (${e.code})`;
  if (e instanceof Error) return e.message;
  return String(e);
}
