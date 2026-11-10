/**
 * WalletPicker (src/ui/WalletPicker.tsx): the state machine (open/close, discovery, keyboard, only the
 * chosen wallet busy, cancel, error → reopen with the tried wallet highlighted) and the rendered markup
 * of each state (menu-button ARIA, empty state inside the menu, icons). Real-DOM focus, click-outside
 * and keyboard behaviour are covered end to end in test/e2e/onboarding.spec.ts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  initialPickerState,
  menuKeyTarget,
  type PickerAction,
  type PickerState,
  type PickerWallet,
  pickerItems,
  pickerReducer,
  progressText,
  triggerKeyTarget,
  WalletPickerView,
} from "../../src/ui/WalletPicker";
import { safeWalletIcon } from "../../src/wallets/icon";

const META: PickerWallet = { id: "io.metamask", name: "MetaMask", icon: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" };
const PHANTOM: PickerWallet = { id: "app.phantom", name: "Phantom" };
const RABBY: PickerWallet = { id: "io.rabby", name: "Rabby" };

const reduce = (s: PickerState, ...actions: PickerAction[]) => actions.reduce(pickerReducer, s);
const ids = { trigger: "t", menu: "m", head: "h" };
const render = (state: PickerState) =>
  renderToStaticMarkup(
    <WalletPickerView state={state} label="Connect EVM wallet" installHint="Install MetaMask." ids={ids} />,
  );
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("WalletPicker state", () => {
  it("opens, discovers once, closes", () => {
    let s = reduce(initialPickerState(), { type: "open" });
    expect(s.open).toBe(true);
    expect(s.wallets).toBeUndefined();
    s = reduce(s, { type: "discover" });
    expect(s.discovering).toBe(true);
    s = reduce(s, { type: "discovered", wallets: [META, PHANTOM] });
    expect(s).toMatchObject({ discovering: false, active: 0, wallets: [META, PHANTOM] });
    s = reduce(s, { type: "close" });
    expect(s.open).toBe(false);
    // reopening keeps the discovered list (no second discovery needed)
    expect(reduce(s, { type: "open" }).wallets).toEqual([META, PHANTOM]);
  });

  it("ArrowUp on the trigger highlights the last item", () => {
    const s = reduce(initialPickerState(true, [META, PHANTOM]), { type: "open", want: "last" });
    expect(s.active).toBe(2); // MetaMask, Phantom, Paste a signature instead
    const noPaste = reduce(initialPickerState(false, [META, PHANTOM]), { type: "open", want: "last" });
    expect(noPaste.active).toBe(1);
  });

  it("maps keys: trigger opens, arrows wrap, Home/End jump, others ignored", () => {
    expect(triggerKeyTarget("ArrowDown")).toBe("first");
    expect(triggerKeyTarget("Enter")).toBe("first");
    expect(triggerKeyTarget(" ")).toBe("first");
    expect(triggerKeyTarget("ArrowUp")).toBe("last");
    expect(triggerKeyTarget("a")).toBeNull();
    expect(menuKeyTarget("ArrowDown", 0, 3)).toBe(1);
    expect(menuKeyTarget("ArrowDown", 2, 3)).toBe(0);
    expect(menuKeyTarget("ArrowUp", 0, 3)).toBe(2);
    expect(menuKeyTarget("Home", 2, 3)).toBe(0);
    expect(menuKeyTarget("End", 0, 3)).toBe(2);
    expect(menuKeyTarget("x", 1, 3)).toBeNull();
    expect(menuKeyTarget("ArrowDown", 0, 0)).toBeNull();
    let s = reduce(initialPickerState(false, [META, PHANTOM, RABBY]), { type: "open" });
    s = reduce(s, { type: "move", key: "ArrowDown", count: 3 }, { type: "move", key: "ArrowDown", count: 3 });
    expect(s.active).toBe(2);
    s = reduce(s, { type: "move", key: "ArrowDown", count: 3 });
    expect(s.active).toBe(0);
    expect(reduce(s, { type: "move", key: "q", count: 3 })).toBe(s);
  });

  it("selecting closes the menu and marks only that wallet as pending; phases advance", () => {
    let s = reduce(initialPickerState(false, [META, PHANTOM]), { type: "open" }, { type: "start", wallet: PHANTOM });
    expect(s.open).toBe(false);
    expect(s.pending).toEqual({ id: PHANTOM.id, name: "Phantom", phase: "connecting" });
    expect(progressText(s.pending)).toBe("Connecting Phantom…");
    s = reduce(s, { type: "phase", phase: "signing" });
    expect(progressText(s.pending)).toBe("Waiting for signature in Phantom…");
    // the menu can't be opened while a wallet is busy
    expect(reduce(s, { type: "open" }).open).toBe(false);
    s = reduce(s, { type: "phase", phase: "verifying" });
    expect(progressText(s.pending)).toBe("Verifying signature…");
    // the API call can't be cancelled once the signature is being verified
    expect(reduce(s, { type: "cancel" }).pending).toBeDefined();
    expect(reduce(s, { type: "done" }).pending).toBeUndefined();
    expect(progressText(undefined)).toBeUndefined();
    expect(reduce(initialPickerState(), { type: "phase", phase: "signing" }).pending).toBeUndefined();
  });

  it("cancel resets the waiting state", () => {
    const s = reduce(
      initialPickerState(false, [META]),
      { type: "start", wallet: META },
      { type: "phase", phase: "signing" },
      { type: "cancel" },
    );
    expect(s.pending).toBeUndefined();
    expect(s.open).toBe(false);
  });

  it("an error reopens the menu with the tried wallet highlighted; picking again clears it", () => {
    const err = new Error("The wallet is connected to 0xabc; switch it to 0xdef and try again.");
    let s = reduce(
      initialPickerState(true, [META, PHANTOM, RABBY]),
      { type: "open" },
      { type: "start", wallet: RABBY },
      { type: "failed", error: err },
    );
    expect(s).toMatchObject({ open: true, active: 2, pending: undefined, error: err, lastId: RABBY.id });
    s = reduce(s, { type: "start", wallet: META });
    expect(s.error).toBeUndefined();
    expect(s.pending?.id).toBe(META.id);
    // the tried wallet stays highlighted on a later open too
    expect(reduce(s, { type: "done" }, { type: "close" }, { type: "open" }).active).toBe(0);
  });

  it("lists wallets, then Search again when none were found, then the paste fallback", () => {
    expect(pickerItems(undefined, true)).toEqual([]);
    expect(pickerItems([], false)).toEqual([{ kind: "retry" }]);
    expect(pickerItems([], true)).toEqual([{ kind: "retry" }, { kind: "paste" }]);
    expect(pickerItems([META], true)).toEqual([{ kind: "wallet", id: META.id }, { kind: "paste" }]);
  });
});

describe("WalletPicker markup", () => {
  it("closed: a menu button with a chevron and no menu", () => {
    const html = render(initialPickerState());
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Connect EVM wallet");
    expect(html).toContain("dash-wallet-picker__chevron");
    expect(html).not.toContain('role="menu"');
  });

  it("open: role=menu with one menuitem per wallet (icon or monogram) and roving tabindex", () => {
    const html = render(reduce(initialPickerState(true, [META, PHANTOM]), { type: "open" }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="m"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-labelledby="t"');
    expect(count(html, 'role="menuitem"')).toBe(3);
    expect(count(html, 'tabindex="0"')).toBe(1);
    expect(html).toContain(`src="${META.icon}"`);
    expect(html).toMatch(/np-avatar[^>]*>P</);
    expect(count(html, "Detected")).toBe(2);
    expect(html).toContain("Paste a signature instead");
    expect(html).not.toContain("No wallet found");
  });

  it("discovering: a polite status in the menu, no items yet", () => {
    const html = render(reduce(initialPickerState(), { type: "open" }, { type: "discover" }));
    expect(html).toContain("Looking for wallets in this browser");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('role="menuitem"');
  });

  it("empty: the message and install hint inside the menu, with Search again", () => {
    const html = render(reduce(initialPickerState(true), { type: "open" }, { type: "discovered", wallets: [] }));
    expect(html).toContain("No wallet found in this browser");
    expect(html).toContain("Install MetaMask.");
    expect(html).toContain("Search again");
    expect(html).toContain("Paste a signature instead");
    expect(html).not.toContain("np-callout"); // not a separate warning card
    expect(count(html, "np-menu__separator")).toBe(1);
  });

  it("busy: only the trigger shows the chosen wallet's progress, with Cancel", () => {
    const s = reduce(
      initialPickerState(false, [META, PHANTOM]),
      { type: "start", wallet: META },
      { type: "phase", phase: "signing" },
    );
    const html = render(s);
    expect(count(html, 'aria-busy="true"')).toBe(1);
    expect(count(html, "np-spinner")).toBe(1);
    expect(count(html, "Waiting for signature in MetaMask…")).toBe(2); // trigger + live region
    expect(html).not.toContain("Phantom");
    expect(html).toContain(">Cancel<");
    expect(render(reduce(s, { type: "phase", phase: "verifying" }))).not.toContain(">Cancel<");
  });

  it("error: the error is shown and the reopened menu highlights the tried wallet", () => {
    const html = render(
      reduce(
        initialPickerState(false, [META, PHANTOM]),
        { type: "start", wallet: PHANTOM },
        { type: "failed", error: new Error("User rejected the request.") },
      ),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("User rejected the request.");
    expect(html).toContain('aria-describedby="h"');
    expect(html).toMatch(
      /dash-wallet-picker__item--last"[^>]*tabindex="0"|tabindex="0"[^>]*dash-wallet-picker__item--last/,
    );
    expect(html).toContain("Tried last · Try again");
  });
});

describe("wallet icons", () => {
  it("keeps image data URIs only", () => {
    expect(safeWalletIcon("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(safeWalletIcon(" data:image/svg+xml,<svg/> ")).toBe("data:image/svg+xml,<svg/>");
    expect(safeWalletIcon("https://tracker.example/icon.png")).toBeUndefined();
    expect(safeWalletIcon("data:text/html,<script>")).toBeUndefined();
    expect(safeWalletIcon("javascript:alert(1)")).toBeUndefined();
    expect(safeWalletIcon("")).toBeUndefined();
    expect(safeWalletIcon(42)).toBeUndefined();
    expect(safeWalletIcon(`data:image/png;base64,${"A".repeat(200_001)}`)).toBeUndefined();
  });
});
