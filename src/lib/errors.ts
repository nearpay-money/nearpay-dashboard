/** API errors as the dashboard sees them (error envelope, api-conventions §6). */
import { HEADERS } from "@nearpay/spec";

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

/** A short message for the UI, with the request id for support. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError)
    return e.requestId ? `${e.message} (${e.code}, ${e.requestId})` : `${e.message} (${e.code})`;
  if (e instanceof Error) return e.message;
  return String(e);
}
