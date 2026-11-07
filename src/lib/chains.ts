/** Human network names for CAIP-2 chain ids ("USDC · Base" — show full token and network identity). */

const NAMES: Readonly<Record<string, string>> = {
  "near:mainnet": "NEAR",
  "near:testnet": "NEAR testnet",
  "eip155:1": "Ethereum",
  "eip155:8453": "Base",
  "eip155:42161": "Arbitrum",
  "eip155:10": "Optimism",
  "eip155:137": "Polygon",
  "eip155:56": "BNB Chain",
  "eip155:43114": "Avalanche",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "Solana",
  "bip122:000000000019d6689c085ae165831e93": "Bitcoin",
};

/** `"eip155:8453"` → `"Base"`; unknown chains are shown as their id. */
export function networkName(chain: string): string {
  return NAMES[chain] ?? (chain.startsWith("solana:") ? "Solana" : chain);
}

/** `"USDC · Base"`. */
export function tokenOnNetwork(symbol: string, chain: string): string {
  return `${symbol} · ${networkName(chain)}`;
}
