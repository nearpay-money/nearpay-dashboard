/** KYB case calls (spec 0.2.0 `compliance`: getKyb, updateKybProfile, submitKyb with step-up). */
import { getKyb, submitKyb, updateKybProfile } from "@nearpay-money/spec";
import { useApp } from "../../app/context";
import { useAsync } from "../../lib/hooks";
import { type KybCase, type KybForm, updateBody } from "./logic";

export function useKyb() {
  const app = useApp();
  return useAsync(() => app.api.call(getKyb) as Promise<KybCase>, [app.api]);
}

export function useKybCalls() {
  const { api } = useApp();
  return {
    save: (f: KybForm) => api.call(updateKybProfile, { body: updateBody(f) }) as Promise<KybCase>,
    submit: () => api.call(submitKyb, { body: { declaration: true } }) as Promise<KybCase>,
  };
}
