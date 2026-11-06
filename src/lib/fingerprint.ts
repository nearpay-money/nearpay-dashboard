/**
 * Destination fingerprint (spec test vector `destination-fingerprint.json`): first 10 symbols of the
 * upper-case Crockford base32 (MSB-first) of sha256(`chain|address_norm|asset_id`), grouped 4-4-2.
 * Shown next to payment destinations, which carry no fingerprint in the snapshot.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** EVM addresses are compared lower-case; everything else as-is (identity LLD §4 `address_norm`). */
export function normalizeAddress(chain: string, address: string): string {
  return chain.startsWith("eip155:") || /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address;
}

export async function destinationFingerprint(chain: string, address: string, assetId: string): Promise<string> {
  const input = `${chain}|${normalizeAddress(chain, address)}|${assetId}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 10) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length >= 10) break;
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 10)}`;
}
