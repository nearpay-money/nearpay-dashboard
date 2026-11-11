/**
 * Stage 4 (step 4.3) unit tests: Solana/Bitcoin address and signature checks against the spec 0.4.0
 * vectors (`@nearpay-money/spec/test-vectors`), explorer links, Solana / Bitcoin / NEAR transaction wallets.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import {
  base58Decode,
  base58Encode,
  base64Decode,
  base64Encode,
  bitcoinTypeRefusal,
  chainFamily,
  checkBip322Signature,
  checkBitcoinAddress,
  checkSolanaAddress,
  checkSolanaSignature,
  isOnCurve,
  networkName,
} from "../../src/lib/chains";
import { explorerAddressUrl, explorerTxUrl } from "../../src/lib/explorer";
import { detectBitcoinWallets, signBip322 } from "../../src/wallets/bitcoin";
import { type NearConnectorLike, outcomeTxHash, signAndSendNear } from "../../src/wallets/near";
import { discoverSolanaWallets, signSolanaMessage } from "../../src/wallets/solana";

const require = createRequire(import.meta.url);
const vectors = (name: string) =>
  JSON.parse(readFileSync(require.resolve(`@nearpay-money/spec/test-vectors/${name}`), "utf8"));
const ADDR = vectors("chains-solana-bitcoin.json");
const ATT = vectors("destination-attestation.json");

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BTC = "bip122:000000000019d6689c085ae165831e93";

describe("chains: vectors (spec 0.4.0 chains-solana-bitcoin.json#addresses)", () => {
  for (const v of ADDR.addresses.solana as {
    address: string;
    valid: boolean;
    normalized?: string;
    on_curve?: boolean;
  }[]) {
    it(`solana ${v.address || "(empty)"} → ${v.valid ? "valid" : "invalid"}`, () => {
      const r = checkSolanaAddress(v.address);
      expect(r.ok).toBe(v.valid);
      if (r.ok) {
        expect(r.normalized).toBe(v.normalized);
        if (v.on_curve !== undefined) expect(r.onCurve).toBe(v.on_curve);
      }
    });
  }
  for (const v of ADDR.addresses.bitcoin as {
    address: string;
    valid: boolean;
    type?: string;
    normalized?: string;
    destination_allowed?: boolean;
  }[]) {
    it(`bitcoin ${v.address || "(empty)"} → ${v.valid ? v.type : "invalid"}`, () => {
      const r = checkBitcoinAddress(v.address);
      expect(r.ok).toBe(v.valid);
      if (r.ok) {
        expect(r.type).toBe(v.type);
        expect(r.normalized).toBe(v.normalized);
        expect(r.destinationAllowed).toBe(v.destination_allowed);
      }
    });
  }
});

describe("chains: helpers", () => {
  it("families and names", () => {
    expect(chainFamily(SOL)).toBe("solana");
    expect(chainFamily(BTC)).toBe("bitcoin");
    expect(chainFamily("near:mainnet")).toBe("near");
    expect(chainFamily("eip155:1")).toBe("evm");
    expect(chainFamily("cosmos:x")).toBe("other");
    expect(networkName(SOL)).toBe("Solana");
    expect(networkName(BTC)).toBe("Bitcoin");
  });
  it("base58 / base64 round trips and rejects", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 255]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    expect(base58Decode("0OIl")).toBeNull();
    expect(base58Decode("")).toBeNull();
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
    expect(base64Decode("abc")).toBeNull();
    expect(base64Decode("ab$=")).toBeNull();
    expect(base64Decode("")).toBeNull();
  });
  it("ed25519 curve check", () => {
    expect(isOnCurve(new Uint8Array(31))).toBe(false);
    expect(isOnCurve(new Uint8Array(32).fill(0xff))).toBe(false); // y ≥ p
    const pub = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(12);
    expect(isOnCurve(Uint8Array.from(pub))).toBe(true);
  });
  it("solana address errors", () => {
    expect(checkSolanaAddress(" x").ok).toBe(false);
    expect(checkSolanaAddress("0abc").ok).toBe(false);
    expect(checkSolanaAddress("abc").ok).toBe(false);
  });
  it("bitcoin address errors and refusal copy", () => {
    const err = (a: string) => {
      const r = checkBitcoinAddress(a);
      return r.ok ? "" : r.error;
    };
    expect(err("bc1Qpct5")).toMatch(/lower-case/);
    expect(err("tb1qpct5sxzppv204tth290uen85nqkhzw9sq5m0ku")).toMatch(/testnet/);
    expect(err("ltc1qxyz")).toMatch(/mainnet/);
    expect(err("bc1qb")).toMatch(/character|short/);
    expect(err("bc1q")).toMatch(/short/);
    expect(err("bc1qpct5sxzppv204tth290uen85nqkhzw9sq5m0kv")).toMatch(/checksum/);
    expect(err("1abc")).toMatch(/mainnet/);
    expect(bitcoinTypeRefusal("p2pkh")).toMatch(/^Legacy/);
    expect(bitcoinTypeRefusal("p2sh")).toMatch(/^P2SH/);
    expect(bitcoinTypeRefusal("p2wsh")).toMatch(/^Multisig/);
    expect(bitcoinTypeRefusal("segwit_other")).toMatch(/^This address type/);
  });
});

describe("attestation signature shapes (spec 0.4.0 destination-attestation.json)", () => {
  it("solana: base58 64 bytes; base64 refused", () => {
    for (const c of ATT.solana.cases) {
      const problem = checkSolanaSignature(c.signature);
      if (c.valid) expect(problem).toBeNull();
      if (c.name.startsWith("base64")) expect(problem).not.toBeNull();
    }
    expect(checkSolanaSignature("3SXX")).toMatch(/64 bytes/);
  });
  it("bip322: every valid NearPay case passes the shape check; the full format does not", () => {
    for (const v of ATT.bip322.nearpay as {
      type: string;
      cases: { name: string; signature: string; valid: boolean }[];
    }[]) {
      for (const c of v.cases) {
        const problem = checkBip322Signature(c.signature, v.type as "p2wpkh" | "p2tr");
        if (c.valid) expect(problem, c.name).toBeNull();
        if (c.name.includes('"full"')) expect(problem, c.name).not.toBeNull();
      }
    }
    expect(checkBip322Signature("not base64!", "p2wpkh")).toMatch(/base64/);
  });
});

describe("explorers (stage 4 chains)", () => {
  it("Solana and Bitcoin tx and address links; unknown → null", () => {
    expect(explorerTxUrl({ chain: SOL, tx_hash: "5x" })).toBe("https://solscan.io/tx/5x");
    expect(explorerTxUrl({ chain: BTC, tx_hash: "ab" })).toBe("https://mempool.space/tx/ab");
    expect(explorerAddressUrl(SOL, "EyjEeiTxb4rvkoN3ZA2zTimuc6VyF8V1QuH9TT66Gkn6")).toMatch(
      /^https:\/\/solscan\.io\/account\//,
    );
    expect(explorerAddressUrl(BTC, "bc1qpct5sxzppv204tth290uen85nqkhzw9sq5m0ku")).toMatch(
      /^https:\/\/mempool\.space\/address\//,
    );
    expect(explorerAddressUrl(BTC, "not-an-address")).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ wallets

function solanaWallet(opts: {
  address: string;
  key?: ReturnType<typeof generateKeyPairSync>["privateKey"];
  tamper?: boolean;
  shortSig?: boolean;
  empty?: boolean;
}) {
  return {
    name: "Test Sol",
    accounts: [],
    features: {
      "standard:connect": { connect: async () => ({ accounts: [{ address: opts.address }] }) },
      "solana:signMessage": {
        signMessage: async ({ message }: { message: Uint8Array }) => {
          if (opts.empty) return [];
          const signed = opts.tamper ? Uint8Array.from([0xff, ...message]) : message;
          const sig = opts.key
            ? Uint8Array.from(sign(null, signed, opts.key))
            : new Uint8Array(opts.shortSig ? 10 : 64);
          return [{ signedMessage: signed, signature: sig }];
        },
      },
    },
  };
}

function solWin(wallets: unknown[]) {
  const t = new EventTarget();
  t.addEventListener("wallet-standard:app-ready", (e) => {
    const api = (e as CustomEvent<{ register(...w: unknown[]): void }>).detail;
    api.register(...wallets);
  });
  return t as unknown as Window;
}

describe("Solana wallet (wallet standard, raw signMessage)", () => {
  it("discovers signing wallets only, via app-ready and register-wallet", async () => {
    const good = solanaWallet({ address: "a" });
    const win = solWin([good, { name: "No sign", accounts: [], features: {} }]);
    const p = discoverSolanaWallets(win, 10);
    win.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", {
        detail: (api: { register(...w: unknown[]): void }) => api.register({ ...good, name: "Late" }),
      }),
    );
    const found = await p;
    expect(found.map((w) => w.name)).toEqual(["Test Sol", "Late"]);
    const iconWin = solWin([{ ...good, name: "Icon", icon: "data:image/png;base64,iVBORw0KGgo=" }]);
    expect((await discoverSolanaWallets(iconWin, 5)).map((w) => w.icon)).toEqual([
      "data:image/png;base64,iVBORw0KGgo=",
    ]);
  });
  it("signs the exact bytes with the destination key and returns base58", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const address = base58Encode(Uint8Array.from(publicKey.export({ format: "der", type: "spki" }).subarray(12)));
    const [w] = await discoverSolanaWallets(solWin([solanaWallet({ address, key: privateKey })]), 5);
    const onSigning = vi.fn();
    const sig = await signSolanaMessage(w as never, address, "NearPay settlement destination\nAddress: x", onSigning);
    expect(base58Decode(sig)?.length).toBe(64);
    expect(onSigning).toHaveBeenCalledOnce();
  });
  it("refuses another account, a changed message, odd signatures", async () => {
    const mk = async (o: Parameters<typeof solanaWallet>[0]) =>
      (await discoverSolanaWallets(solWin([solanaWallet(o)]), 5))[0] as never;
    await expect(signSolanaMessage(await mk({ address: "other" }), "mine", "m")).rejects.toThrow(/switch it to mine/);
    await expect(signSolanaMessage(await mk({ address: "a", tamper: true }), "a", "m")).rejects.toThrow(
      /changed the message/,
    );
    await expect(signSolanaMessage(await mk({ address: "a", shortSig: true }), "a", "m")).rejects.toThrow(
      /unexpected signature/,
    );
    await expect(signSolanaMessage(await mk({ address: "a", empty: true }), "a", "m")).rejects.toThrow(/no signature/);
  });
});

describe("Bitcoin wallets (BIP-322 simple)", () => {
  const prov = (accounts: string[], sig = "AkgwRQ==") => ({
    requestAccounts: async () => accounts,
    signMessage: async (_m: string, t: string): Promise<string> => (t === "bip322-simple" ? sig : ""),
  });
  it("detects UniSat and OKX", () => {
    const win = { unisat: prov([]), okxwallet: { bitcoin: prov([]) } } as unknown as Window;
    expect(detectBitcoinWallets(win).map((w) => w.id)).toEqual(["unisat", "okx"]);
    expect(detectBitcoinWallets({} as Window)).toEqual([]);
  });
  it("signs with the destination account only", async () => {
    const a = "bc1qpct5sxzppv204tth290uen85nqkhzw9sq5m0ku";
    const w = (p: ReturnType<typeof prov>) => ({ id: "unisat" as const, name: "UniSat", provider: p });
    const onSigning = vi.fn();
    expect(await signBip322(w(prov([a.toUpperCase()], " sig= ")), a, "m", onSigning)).toBe("sig=");
    expect(onSigning).toHaveBeenCalledOnce();
    const never = vi.fn();
    await expect(signBip322(w(prov(["bc1qother"])), a, "m", never)).rejects.toThrow(/switch it to/);
    expect(never).not.toHaveBeenCalled();
    await expect(signBip322(w(prov([a], "")), a, "m")).rejects.toThrow(/no signature/);
  });
});

describe("NEAR transactions (merchant mandate cancel)", () => {
  const tx = {
    signer_id: "acme.near",
    receiver_id: "v1.vault.nearpay.near",
    actions: [
      {
        type: "FunctionCall" as const,
        method_name: "cancel",
        args: { mandate_id: 7 },
        gas: "100000000000000",
        deposit: "1",
      },
    ],
  };
  const connector = (accounts: string[], send?: (p: unknown) => Promise<unknown>) => async () =>
    ({
      connect: async () => ({
        getAccounts: async () => accounts.map((accountId) => ({ accountId })),
        signMessage: async () => ({ accountId: "", publicKey: "", signature: "" }),
        ...(send ? { signAndSendTransaction: send } : {}),
      }),
    }) as unknown as NearConnectorLike;
  it("sends exactly the prepared transaction from the receiving account", async () => {
    const seen: unknown[] = [];
    const r = await signAndSendNear(
      connector(["acme.near"], async (p) => {
        seen.push(p);
        return { transaction: { hash: "8hQ3XpDzWkYB6zEXfDzX9v2u8v5nJxQ3r7tKXk1n2bcd" } };
      }),
      tx,
      "acme.near",
    );
    expect(r.txHash).toBe("8hQ3XpDzWkYB6zEXfDzX9v2u8v5nJxQ3r7tKXk1n2bcd");
    expect(seen[0]).toEqual({
      signerId: "acme.near",
      receiverId: "v1.vault.nearpay.near",
      actions: [
        {
          type: "FunctionCall",
          params: { methodName: "cancel", args: { mandate_id: 7 }, gas: "100000000000000", deposit: "1" },
        },
      ],
    });
  });
  it("refuses a different signer, another connected account, wallets without sending", async () => {
    await expect(
      signAndSendNear(connector(["acme.near"]), { ...tx, signer_id: "x.near" }, "acme.near"),
    ).rejects.toThrow(/switch it to x.near/);
    await expect(
      signAndSendNear(
        connector(["bob.near"], async () => ({})),
        tx,
        "acme.near",
      ),
    ).rejects.toThrow(/switch it to acme.near/);
    await expect(signAndSendNear(connector(["acme.near"]), tx, "acme.near")).rejects.toThrow(
      /can't send NEAR transactions/,
    );
  });
  it("reads the hash from either outcome shape", () => {
    expect(outcomeTxHash({ transaction_outcome: { id: "8hQ3XpDzWkYB6zEXfDzX9v2u8v5nJxQ3r7tKXk1n2bcd" } })).toBe(
      "8hQ3XpDzWkYB6zEXfDzX9v2u8v5nJxQ3r7tKXk1n2bcd",
    );
    expect(outcomeTxHash({ transaction: { hash: "not a hash!" } })).toBeUndefined();
    expect(outcomeTxHash(undefined)).toBeUndefined();
  });
});
