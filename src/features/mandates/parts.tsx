/** Small shared pieces of the auto-debit pages: status badge, token amounts, NEAR explorer links. */

import type { Mandate } from "@nearpay/spec";
import { CopyText, StatusBadge } from "@nearpay-internal/ui";
import { useCallback } from "react";
import { useApp } from "../../app/context";
import { explorerAddressUrl, explorerTxUrl } from "../../lib/explorer";
import { shorten } from "../../lib/format";
import { statusOf } from "../../lib/status";
import { mandateStatusValue, tokenAmount } from "./logic";

export function MandateStatus({ mandate }: { mandate: Pick<Mandate, "status" | "link_status"> }) {
  const s = statusOf("mandate", mandateStatusValue(mandate));
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

/** `(asset_id, base units) → "12.5 USDC"` with decimals from `GET /v1/assets` (exact). */
export function useToken() {
  const app = useApp();
  return useCallback(
    (assetId: string, amount: string) => {
      const a = app.assets.get(assetId);
      return tokenAmount(amount, a?.symbol, a?.decimals);
    },
    [app.assets],
  );
}

/** Live mandates are on NEAR mainnet; test mandates live on the sandbox vault stand-in (no explorer). */
const nearChain = (livemode: boolean) => (livemode ? "near:mainnet" : "sandbox");

export function NearTx({ hash, livemode, label }: { hash: string; livemode: boolean; label?: string }) {
  const url = explorerTxUrl({ chain: nearChain(livemode), tx_hash: hash });
  if (!url)
    return (
      <span className="npf-mandates__account" title={hash}>
        {label ?? shorten(hash, 8)} <span className="np-text-caption np-text-secondary">(sandbox)</span>
      </span>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="np-link" title={hash}>
      {label ?? shorten(hash, 8)}
      <span className="np-sr-only"> (opens NEAR explorer)</span>
    </a>
  );
}

export function NearAccount({ account, livemode }: { account: string; livemode: boolean }) {
  const url = livemode ? explorerAddressUrl("near:mainnet", account) : null;
  return (
    <span className="npf-mandates__inline">
      <CopyText value={account} label={`Copy ${account}`} mono className="npf-mandates__account" />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener" className="np-link np-text-small">
          View<span className="np-sr-only"> {account} on the NEAR explorer</span>
        </a>
      ) : null}
    </span>
  );
}
