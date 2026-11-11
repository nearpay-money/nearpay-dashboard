/**
 * Same-origin API client (lld/dashboard-and-console.md §1): every call goes to `/api/<route path>`
 * with the session cookie, `NearPay-Mode`, the CSRF header on unsafe methods and an Idempotency-Key on
 * idempotent writes. A `401 step_up_required` opens the step-up dialog and replays the request once
 * with the same Idempotency-Key; a lost session (401 / CSRF mismatch) signs the user out.
 * Routes, paths and types come from `@nearpay-money/spec`. Responses are parsed with the route's response
 * schema via `safeParseTolerant` (spec 0.1.5): unknown fields and unknown open-enum values (new statuses,
 * reasons) are kept and rendered as received; anything else that breaks the contract is an
 * `invalid_response` error instead of a page rendering malformed data.
 */
import {
  type AnyRoute,
  API_VERSION,
  buildPath,
  HEADERS,
  type RouteBody,
  type RouteResponse,
  safeParseTolerant,
} from "@nearpay-money/spec";
import { ApiError } from "./errors";

export type Mode = "test" | "live";

export interface CallInput<R> {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly body?: RouteBody<R>;
}

export interface ApiClientOptions {
  readonly base: string;
  readonly fetch?: typeof fetch;
  readonly mode: () => Mode;
  readonly csrf: () => string | undefined;
  /** Shows the step-up dialog; resolves after a fresh assertion, rejects when the user cancels. */
  readonly stepUp?: () => Promise<void>;
  /** The session is gone (expired, revoked, CSRF lost). */
  readonly unauthenticated?: (e: ApiError) => void;
  readonly uuid?: () => string;
}

/** `expand[]=a` for arrays, `key=v` otherwise; `created[gte]` keys pass through. */
export function encodeQuery(query: Readonly<Record<string, unknown>> | undefined): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const i of v) sp.append(`${k}[]`, String(i));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const isUnsafe = (r: Pick<AnyRoute, "method">) => r.method !== "GET";

const SESSION_LOST = new Set(["authentication_required", "csrf_token_invalid"]);

function invalidResponse(route: AnyRoute, res: Response): ApiError {
  return new ApiError({
    status: res.status,
    type: "api_error",
    code: "invalid_response",
    message: `The API sent a response the dashboard does not understand (${route.id}).`,
    requestId: res.headers.get(HEADERS.requestId) ?? undefined,
  });
}

/** JSON body → the route's response type, tolerating unknown open-enum values. */
function parseResponse<R extends AnyRoute>(route: R, res: Response, text: string): RouteResponse<R> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalidResponse(route, res);
  }
  if (!route.response) return json as RouteResponse<R>;
  const r = safeParseTolerant(route.response, json);
  if (!r.success) throw invalidResponse(route, res);
  return r.data as RouteResponse<R>;
}

export class ApiClient {
  readonly #o: ApiClientOptions;
  constructor(o: ApiClientOptions) {
    this.#o = o;
  }

  async call<R extends AnyRoute>(route: R, input: CallInput<R> = {}): Promise<RouteResponse<R>> {
    const res = await this.#send(route, input, "application/json");
    if (res.status === 204) return undefined as RouteResponse<R>;
    const text = await res.text();
    if (!text) return undefined as RouteResponse<R>;
    return parseResponse(route, res, text);
  }

  /**
   * A route with a binary success body (spec `binaryResponse`, e.g. `getInvoicePdf`): same headers,
   * step-up replay and error mapping as `call`, but the body is returned as a Blob with the file name
   * from `Content-Disposition` (fetched with the mode header, so a live object is never asked for in
   * test mode — a plain link could not send `NearPay-Mode`).
   */
  async download<R extends AnyRoute>(
    route: R,
    input: CallInput<R> = {},
  ): Promise<{ blob: Blob; filename: string | undefined }> {
    const accept = route.binaryResponse?.contentType ?? "application/octet-stream";
    const res = await this.#send(route, input, accept);
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith(accept)) throw invalidResponse(route, res);
    return { blob: await res.blob(), filename: filenameOf(res.headers.get("content-disposition")) };
  }

  /** Request headers every stream/API read sends (mode + API version), for non-JSON readers (SSE). */
  readHeaders(): Record<string, string> {
    return { [HEADERS.mode]: this.#o.mode(), [HEADERS.apiVersion]: API_VERSION };
  }

  async #send<R extends AnyRoute>(route: R, input: CallInput<R>, accept: string): Promise<Response> {
    const o = this.#o;
    const url = `${o.base}${buildPath(route, input.params ?? {})}${encodeQuery(input.query)}`;
    const idempotencyKey = route.idempotent && isUnsafe(route) ? (o.uuid ?? (() => crypto.randomUUID()))() : undefined;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        Accept: accept,
        [HEADERS.mode]: o.mode(),
        [HEADERS.apiVersion]: API_VERSION,
      };
      let body: string | undefined;
      if (isUnsafe(route)) {
        const csrf = o.csrf();
        if (csrf) headers[HEADERS.csrf] = csrf;
        if (idempotencyKey) headers[HEADERS.idempotencyKey] = idempotencyKey;
        if (route.method !== "DELETE") {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(input.body ?? {});
        }
      }
      const res = await (o.fetch ?? fetch)(url, {
        method: route.method,
        headers,
        body,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.ok) return res;
      const err = await ApiError.fromResponse(res);
      if (err.code === "step_up_required" && o.stepUp && attempt === 0) {
        await o.stepUp();
        continue;
      }
      if ((res.status === 401 || res.status === 403) && SESSION_LOST.has(err.code)) o.unauthenticated?.(err);
      throw err;
    }
  }
}

/** `attachment; filename="INV-00012.pdf"` → `INV-00012.pdf` (path separators and quotes stripped). */
export function filenameOf(disposition: string | null): string | undefined {
  if (!disposition) return undefined;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (!m?.[1]) return undefined;
  let name = m[1];
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep as sent
  }
  const clean = [...name]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch !== "/" && ch !== "\\" && ch !== '"')
    .join("")
    .trim();
  return clean || undefined;
}
