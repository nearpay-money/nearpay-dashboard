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
  // stage 4 — chains
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://solscan.io/tx/",
  "bip122:000000000019d6689c085ae165831e93": "https://mempool.space/tx/",
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
  if (chain.startsWith("solana:5eykt") && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
    return `https://solscan.io/account/${address}`;
  if (chain.startsWith("bip122:000000000019") && /^bc1[02-9ac-hj-np-z]{39,59}$/.test(address))
    return `https://mempool.space/address/${address}`;
  const tx = TX_EXPLORERS[chain];
  if (!tx || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return tx.replace(/\/tx\/$/, `/address/${address}`);
}
