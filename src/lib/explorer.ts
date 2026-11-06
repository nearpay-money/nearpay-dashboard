/** Block-explorer links for evidence (spec `Evidence.explorer_url` first; else derived for known chains). */

const TX_EXPLORERS: Readonly<Record<string, string>> = {
  "near:mainnet": "https://nearblocks.io/txns/",
  "near:testnet": "https://testnet.nearblocks.io/txns/",
  "eip155:1": "https://etherscan.io/tx/",
  "eip155:8453": "https://basescan.org/tx/",
  "eip155:42161": "https://arbiscan.io/tx/",
  "eip155:10": "https://optimistic.etherscan.io/tx/",
  "eip155:137": "https://polygonscan.com/tx/",
  "eip155:56": "https://bscscan.com/tx/",
};

/** An https explorer URL for a transaction, or null (unknown chain, sandbox/simulated chains). */
export function explorerTxUrl(o: { chain: string; tx_hash: string; explorer_url?: string | null }): string | null {
  if (o.explorer_url && /^https:\/\//.test(o.explorer_url)) return o.explorer_url;
  const base = TX_EXPLORERS[o.chain];
  if (!base || !/^[A-Za-z0-9]+$/.test(o.tx_hash)) return null;
  return `${base}${o.tx_hash}`;
}

/** Explorer link for an account/address. */
export function explorerAddressUrl(chain: string, address: string): string | null {
  if (chain === "near:mainnet") return `https://nearblocks.io/address/${encodeURIComponent(address)}`;
  const tx = TX_EXPLORERS[chain];
  if (!tx || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return tx.replace(/\/tx\/$/, `/address/${address}`);
}
