import { describe, expect, it, vi } from "vitest";
import {
  discoverEvmWallets,
  type Eip1193Provider,
  signEip191,
  utf8ToHex,
  WalletMismatchError,
} from "../../src/wallets/evm";
import { type NearWalletLike, nonceBytes, signNep413 } from "../../src/wallets/near";

const ADDR = "0x42e06263bb5346ae6421ab1ec1019824e7b284e1";
const SIG = `0x${"ab".repeat(65)}`;

function provider(accounts: string[], sig: unknown = SIG): Eip1193Provider & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async request(a) {
      calls.push(a);
      if (a.method === "eth_requestAccounts") return accounts;
      if (a.method === "personal_sign") return sig;
      throw new Error("unexpected");
    },
  };
}

describe("EVM / EIP-191", () => {
  it("hex-encodes UTF-8", () => {
    expect(utf8ToHex("hi ✓")).toBe("0x686920e29c93");
  });

  it("signs the exact message with the destination account", async () => {
    const p = provider([ADDR.toUpperCase().replace("0X", "0x")]);
    await expect(signEip191(p, ADDR, "NearPay settlement destination\nNonce: 1")).resolves.toBe(SIG);
    expect(p.calls[1]).toEqual({
      method: "personal_sign",
      params: [utf8ToHex("NearPay settlement destination\nNonce: 1"), ADDR],
    });
  });

  it("refuses another account and bad signatures", async () => {
    await expect(
      signEip191(provider(["0x0000000000000000000000000000000000000001"]), ADDR, "m"),
    ).rejects.toBeInstanceOf(WalletMismatchError);
    await expect(signEip191(provider([]), ADDR, "m")).rejects.toThrow(/no account/);
    await expect(signEip191(provider([ADDR], "0x12"), ADDR, "m")).rejects.toThrow(/invalid signature/);
    await expect(signEip191(provider([ADDR, 5 as unknown as string], null), ADDR, "m")).rejects.toThrow(/invalid/);
  });

  it("discovers EIP-6963 wallets, falls back to window.ethereum", async () => {
    const target = new EventTarget() as EventTarget & { ethereum?: Eip1193Provider };
    const p = provider([ADDR]);
    target.addEventListener("eip6963:requestProvider", () => {
      target.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: { info: { rdns: "io.test", name: "Test" }, provider: p },
        }),
      );
      target.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "u2" }, provider: p } }),
      );
      target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider: p } }));
      target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { name: "bad" } } }));
    });
    const found = await discoverEvmWallets(target as unknown as Window, 5);
    expect(found.map((w) => [w.id, w.name])).toEqual([
      ["io.test", "Test"],
      ["u2", "u2"],
      ["wallet-2", "wallet-2"],
    ]);
    const legacy = new EventTarget() as EventTarget & { ethereum?: Eip1193Provider };
    legacy.ethereum = p;
    expect((await discoverEvmWallets(legacy as unknown as Window, 5)).map((w) => w.name)).toEqual(["Browser wallet"]);
    expect(await discoverEvmWallets(new EventTarget() as unknown as Window, 5)).toEqual([]);
  });
});

describe("NEAR / NEP-413", () => {
  const nonce = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const signed = {
    accountId: "merchant.near",
    publicKey: "ed25519:2SBdAzviwkHZ4YkAdGqXTitBPqw752YyNhYtzBQiBb25",
    signature: "c2ln",
  };

  function wallet(
    accounts: string[],
    out: Partial<typeof signed> = {},
  ): NearWalletLike & { signMessage: ReturnType<typeof vi.fn> } {
    return {
      getAccounts: async () => accounts.map((accountId) => ({ accountId })),
      signMessage: vi.fn(async () => ({ ...signed, ...out })),
    };
  }
  const connectorOf = (w: NearWalletLike) => async () => ({ connect: async () => w });

  it("decodes the 32-byte nonce", () => {
    expect(nonceBytes(nonce)).toEqual(new Uint8Array(32).fill(7));
    expect(() => nonceBytes(btoa("short"))).toThrow(/32 bytes/);
  });

  it("signs {message, recipient, nonce} with the destination account", async () => {
    const w = wallet(["merchant.near"]);
    const r = await signNep413(connectorOf(w), {
      message: "msg",
      recipient: "nearpay.money",
      nonce,
      address: "merchant.near",
    });
    expect(r).toEqual(signed);
    expect(w.signMessage).toHaveBeenCalledWith({
      message: "msg",
      recipient: "nearpay.money",
      nonce: new Uint8Array(32).fill(7),
      signerId: "merchant.near",
    });
  });

  it("refuses other accounts and odd keys", async () => {
    const c = { message: "m", recipient: "nearpay.money", nonce, address: "merchant.near" };
    await expect(signNep413(connectorOf(wallet(["other.near"])), c)).rejects.toBeInstanceOf(WalletMismatchError);
    await expect(
      signNep413(connectorOf(wallet(["merchant.near"], { accountId: "evil.near" })), c),
    ).rejects.toBeInstanceOf(WalletMismatchError);
    await expect(signNep413(connectorOf(wallet(["merchant.near"], { publicKey: "secp256k1:abc" })), c)).rejects.toThrow(
      /public key/,
    );
  });
});
