/** Passkey ceremonies against identity (lld/identity.md §6) with `@simplewebauthn/browser`. */
import {
  type passkeyAuthenticationOptions as AuthOptionsRoute,
  passkeyAuthenticationOptions,
  passkeyAuthenticationVerify,
  passkeyRegistrationOptions,
  passkeyRegistrationVerify,
  type RouteResponse,
  stepUpOptions,
  stepUpVerify,
} from "@nearpay-money/spec";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { ApiClient } from "../../lib/api";
import type { DashboardSession } from "../../lib/session";

type RequestOptions = RouteResponse<typeof AuthOptionsRoute>;

const asAuthOptions = (o: RequestOptions) => o as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"];

export async function signInWithPasskey(api: ApiClient, email?: string): Promise<DashboardSession> {
  const options = await api.call(passkeyAuthenticationOptions, { body: email ? { email } : {} });
  const credential = await startAuthentication({ optionsJSON: asAuthOptions(options) });
  return api.call(passkeyAuthenticationVerify, { body: { credential: credential as never } });
}

/** New user (registration token from the magic link) or an extra passkey for the signed-in user. */
export async function registerPasskey(
  api: ApiClient,
  o: { registrationToken?: string; displayName?: string; passkeyName?: string },
): Promise<DashboardSession> {
  const options = await api.call(passkeyRegistrationOptions, {
    body: o.registrationToken ? { registration_token: o.registrationToken } : {},
  });
  const credential = await startRegistration({
    optionsJSON: options as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"],
  });
  return api.call(passkeyRegistrationVerify, {
    body: {
      credential: credential as never,
      ...(o.registrationToken ? { registration_token: o.registrationToken } : {}),
      ...(o.displayName ? { display_name: o.displayName } : {}),
      ...(o.passkeyName ? { passkey_name: o.passkeyName } : {}),
    },
  });
}

/** A fresh step-up assertion (10 minutes). */
export async function stepUpWithPasskey(api: ApiClient): Promise<number> {
  const options = await api.call(stepUpOptions, { body: {} });
  const credential = await startAuthentication({ optionsJSON: asAuthOptions(options) });
  const r = await api.call(stepUpVerify, { body: { credential: credential as never } });
  return r.step_up_until;
}
