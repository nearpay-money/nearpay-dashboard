/**
 * Human network names for CAIP-2 chain ids ("USDC · Base" — show full token and network identity), and
 * Stage 4 client-side address/signature shape checks for Solana and Bitcoin destinations (identity §20;
 * spec 0.4.0 `chains-solana-bitcoin.json#addresses`). The server re-validates everything; these checks
 * only explain problems before a request is sent. Kit gap: kit 0.4.0 `chains` brings the same helpers
 * (`btc address-type`, base58) — switch then.
 */
import { BITCOIN_MAINNET, SOLANA_MAINNET } from "./spec-next";

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
  [SOLANA_MAINNET]: "Solana",
  [BITCOIN_MAINNET]: "Bitcoin",
};

/** `"eip155:8453"` → `"Base"`; unknown chains are shown as their id. */
export function networkName(chain: string): string {
  return NAMES[chain] ?? (chain.startsWith("solana:") ? "Solana" : chain.startsWith("bip122:") ? "Bitcoin" : chain);
}

/** `"USDC · Base"`. */
export function tokenOnNetwork(symbol: string, chain: string): string {
  return `${symbol} · ${networkName(chain)}`;
}

export type ChainFamily = "near" | "evm" | "solana" | "bitcoin" | "other";

export function chainFamily(chain: string): ChainFamily {
  if (chain.startsWith("near:")) return "near";
  if (chain.startsWith("eip155:")) return "evm";
  if (chain.startsWith("solana:")) return "solana";
  if (chain.startsWith("bip122:")) return "bitcoin";
  return "other";
}

// ---------------------------------------------------------------------------------------------
// base58 / base64
// ---------------------------------------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet) → bytes, or null for any character outside the alphabet. */
export function base58Decode(s: string): Uint8Array | null {
  if (!s) return null;
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Strict standard base64 → bytes, or null. */
export function base64Decode(s: string): Uint8Array | null {
  const t = s.trim();
  if (!t || t.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  try {
    return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

// ---------------------------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------------------------

const P = 2n ** 255n - 19n;
const modp = (a: bigint) => ((a % P) + P) % P;
function powp(b: bigint, e: bigint): bigint {
  let r = 1n;
  let x = modp(b);
  let k = e;
  while (k > 0n) {
    if (k & 1n) r = (r * x) % P;
    x = (x * x) % P;
    k >>= 1n;
  }
  return r;
}
const D = modp(-121665n * powp(121666n, P - 2n));

/** Whether 32 bytes are a valid compressed ed25519 point (i.e. a key that can sign). */
export function isOnCurve(key: Uint8Array): boolean {
  if (key.length !== 32) return false;
  const b = Uint8Array.from(key);
  const sign = (b[31] as number) >> 7;
  b[31] = (b[31] as number) & 0x7f;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i] as number);
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = modp(y2 - 1n);
  const v = modp(D * y2 + 1n);
  const x2 = (u * powp(v, P - 2n)) % P;
  if (x2 === 0n) return sign === 0;
  return powp(x2, (P - 1n) / 2n) === 1n;
}

export type SolanaAddressCheck = { ok: true; normalized: string; onCurve: boolean } | { ok: false; error: string };

/** Solana address: base58 decoding to exactly 32 bytes; `onCurve` false = program-derived (cannot sign). */
export function checkSolanaAddress(input: string): SolanaAddressCheck {
  const s = input;
  if (!s || s !== s.trim()) return { ok: false, error: "Enter the address without spaces." };
  const bytes = base58Decode(s);
  if (!bytes) return { ok: false, error: "A Solana address uses base58 characters only (no 0, O, I or l)." };
  if (bytes.length !== 32) return { ok: false, error: "This isn't a Solana address: it must decode to 32 bytes." };
  return { ok: true, normalized: s, onCurve: isOnCurve(bytes) };
}

/** `standard: solana` signature: base58 of 64 bytes (not base64, not hex). */
export function checkSolanaSignature(sig: string): string | null {
  const t = sig.trim();
  const bytes = base58Decode(t);
  if (!bytes) return "Paste the signature in base58 (wallets show it as letters and digits, no + / =).";
  if (bytes.length !== 64) return "A Solana signature is 64 bytes; this one has a different length.";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Bitcoin
// ---------------------------------------------------------------------------------------------

const BECH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i] as number;
  }
  return chk >>> 0;
}
const hrpExpand = (hrp: string) => [
  ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
  0,
  ...[...hrp].map((c) => c.charCodeAt(0) & 31),
];

function convertBits(data: number[], from: number, to: number): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) return null;
  return out;
}

export type BitcoinAddressType = "p2wpkh" | "p2tr" | "p2wsh" | "p2pkh" | "p2sh" | "segwit_other";

export type BitcoinAddressCheck =
  | { ok: true; normalized: string; type: BitcoinAddressType; destinationAllowed: boolean }
  | { ok: false; error: string };

const WHY_SEGWIT =
  "Use a native SegWit (bc1q…) or Taproot (bc1p…) address: only those can prove ownership with a BIP-322 signature.";

/**
 * Bitcoin mainnet address (bech32 v0 / bech32m v1+, HRP `bc`, single case; legacy base58 1…/3… recognised
 * by shape). Destinations accept P2WPKH and P2TR only (`destinationAllowed`), lower-cased.
 */
export function checkBitcoinAddress(input: string): BitcoinAddressCheck {
  const s = input;
  if (!s || s !== s.trim()) return { ok: false, error: "Enter the address without spaces." };
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)) {
    const bytes = base58Decode(s);
    if (bytes?.length === 25 && (bytes[0] === 0 || bytes[0] === 5)) {
      return { ok: true, normalized: s, type: bytes[0] === 0 ? "p2pkh" : "p2sh", destinationAllowed: false };
    }
    return { ok: false, error: "This isn't a valid Bitcoin address." };
  }
  if (s !== s.toLowerCase() && s !== s.toUpperCase())
    return { ok: false, error: "Bitcoin addresses are all lower-case (or all upper-case). Check for typos." };
  const a = s.toLowerCase();
  if (a.startsWith("tb1") || a.startsWith("bcrt1"))
    return { ok: false, error: "This is a testnet address. Settlement destinations use Bitcoin mainnet (bc1…)." };
  if (!a.startsWith("bc1")) return { ok: false, error: "This isn't a Bitcoin mainnet address." };
  const data: number[] = [];
  for (const ch of a.slice(3)) {
    const v = BECH.indexOf(ch);
    if (v < 0) return { ok: false, error: "This address has a character that bech32 doesn't use." };
    data.push(v);
  }
  if (data.length < 7) return { ok: false, error: "This address is too short." };
  const chk = polymod([...hrpExpand("bc"), ...data]);
  const version = data[0] as number;
  const want = version === 0 ? 1 : 0x2bc830a3;
  if (chk !== want) return { ok: false, error: "The address checksum doesn't match. Check it for typos." };
  const program = convertBits(data.slice(1, -6), 5, 8);
  if (!program || program.length < 2 || program.length > 40 || version > 16)
    return { ok: false, error: "This isn't a valid Bitcoin address." };
  let type: BitcoinAddressType = "segwit_other";
  if (version === 0 && program.length === 20) type = "p2wpkh";
  else if (version === 0 && program.length === 32) type = "p2wsh";
  else if (version === 0) return { ok: false, error: "This isn't a valid Bitcoin address." };
  else if (version === 1 && program.length === 32) type = "p2tr";
  return { ok: true, normalized: a, type, destinationAllowed: type === "p2wpkh" || type === "p2tr" };
}

/** Why a valid Bitcoin address can't be a destination (copy shown under the field). */
export function bitcoinTypeRefusal(type: BitcoinAddressType): string {
  const name =
    type === "p2pkh"
      ? "Legacy (1…) addresses"
      : type === "p2sh"
        ? "P2SH (3…) addresses, including nested SegWit,"
        : type === "p2wsh"
          ? "Multisig and script (P2WSH) addresses"
          : "This address type";
  return `${name} can't prove ownership with BIP-322 "simple". ${WHY_SEGWIT}`;
}

/**
 * `standard: bip322` signature shape: base64 of a witness stack — P2WPKH: 2 items (DER signature + 0x01,
 * 33-byte key); P2TR: 1 item (64 or 65 bytes). The full / legacy formats are refused by the server.
 */
export function checkBip322Signature(sig: string, type: BitcoinAddressType): string | null {
  const bytes = base64Decode(sig);
  if (!bytes) return "Paste the signature as base64 (letters, digits, + and /, often ending in =).";
  const items: number[] = [];
  let i = 1;
  const count = bytes[0] ?? 0;
  for (let k = 0; k < count; k++) {
    const len = bytes[i];
    if (len === undefined) break;
    items.push(len);
    i += 1 + len;
  }
  const shapeOk =
    i === bytes.length &&
    items.length === count &&
    (type === "p2wpkh"
      ? count === 2 && items[1] === 33 && (items[0] ?? 0) >= 9 && (items[0] ?? 0) <= 73
      : count === 1 && (items[0] === 64 || items[0] === 65));
  if (!shapeOk)
    return 'This doesn\'t look like a BIP-322 "simple" signature for this address. In your wallet choose BIP-322 (not "legacy" or "Electrum" message signing).';
  return null;
}
