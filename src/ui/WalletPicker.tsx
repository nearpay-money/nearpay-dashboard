/**
 * Wallet picker for signing (settlement attestations, refund signing): one primary "Connect … wallet" menu
 * button. Opening it runs wallet discovery once (EIP-6963, Wallet Standard, injected Bitcoin providers)
 * and lists the detected wallets in a dropdown menu (WAI-ARIA menu button); an empty result is shown
 * inside the menu, with "Search again" and, where the flow has one, "Paste a signature instead".
 *
 * Choosing a wallet closes the menu and only the trigger shows progress ("Connecting X…", "Waiting for
 * signature in X…", "Verifying signature…"). "Cancel" stops waiting: a signature that still arrives
 * afterwards is discarded (the wallet's own popup can't be closed from here). A failure shows the error
 * and reopens the menu with the wallet that was tried highlighted, so another one can be picked.
 *
 * `WalletConnectButton` is the same trigger for connectors that bring their own wallet selector (NEAR).
 * CSP-safe: classes only (kit tokens + `dash-wallet-picker*` in styles.css), no inline styles.
 */
import { Avatar, ChevronDownIcon, Button as KitButton, WalletIcon } from "@nearpay-internal/ui";
import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useReducer, useRef, useState } from "react";
import { friendlyError } from "../lib/errors";
import { ErrorNote } from "./ui";

export interface PickerWallet {
  readonly id: string;
  readonly name: string;
  /** Image data URI (already filtered by `safeWalletIcon`); a monogram is shown without one. */
  readonly icon?: string | undefined;
}

export type SignPhase = "connecting" | "signing" | "verifying";

/** Handed to the sign action: report progress, and stop if the user cancelled. */
export interface SignContext {
  readonly signal: AbortSignal;
  setPhase(phase: SignPhase): void;
}

// ------------------------------------------------------------------------------------------ pure state

export type PickerItem = { kind: "wallet"; id: string } | { kind: "retry" } | { kind: "paste" };

export interface PickerState<W extends PickerWallet = PickerWallet> {
  readonly open: boolean;
  /** `undefined` until discovery has run. */
  readonly wallets: readonly W[] | undefined;
  readonly discovering: boolean;
  /** Index of the highlighted (focused) item in `pickerItems(...)`. */
  readonly active: number;
  /** Where to put the highlight once items exist. */
  readonly want: "first" | "last";
  readonly pending: { readonly id: string; readonly name: string; readonly phase: SignPhase } | undefined;
  readonly error: unknown;
  /** The wallet tried last (highlighted after an error). */
  readonly lastId: string | undefined;
  /** Whether the menu ends with "Paste a signature instead". */
  readonly canPaste: boolean;
}

export type PickerAction<W extends PickerWallet = PickerWallet> =
  | { type: "open"; want?: "first" | "last" }
  | { type: "close" }
  | { type: "discover" }
  | { type: "discovered"; wallets: readonly W[] }
  | { type: "move"; key: string; count: number }
  | { type: "start"; wallet: W }
  | { type: "phase"; phase: SignPhase }
  | { type: "cancel" }
  | { type: "done" }
  | { type: "failed"; error: unknown };

export function initialPickerState<W extends PickerWallet>(canPaste = false, wallets?: readonly W[]): PickerState<W> {
  return {
    canPaste,
    open: false,
    wallets,
    discovering: false,
    active: 0,
    want: "first",
    pending: undefined,
    error: undefined,
    lastId: undefined,
  };
}

/** The focusable menu items, in order: wallets, then "Search again" (none found), then the paste fallback. */
export function pickerItems(wallets: readonly PickerWallet[] | undefined, canPaste: boolean): PickerItem[] {
  const items: PickerItem[] = (wallets ?? []).map((w) => ({ kind: "wallet", id: w.id }));
  if (wallets && wallets.length === 0) items.push({ kind: "retry" });
  if (canPaste && wallets) items.push({ kind: "paste" });
  return items;
}

/** Roving focus inside the menu: arrows wrap, Home/End jump; `null` for keys the menu doesn't move on. */
export function menuKeyTarget(key: string, active: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return (active + 1) % count;
    case "ArrowUp":
      return (active - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Keys on the closed trigger that open the menu (Enter/Space open it through the button's click). */
export function triggerKeyTarget(key: string): "first" | "last" | null {
  if (key === "ArrowDown" || key === "Enter" || key === " ") return "first";
  if (key === "ArrowUp") return "last";
  return null;
}

function highlight<W extends PickerWallet>(s: PickerState<W>, wallets: readonly W[] | undefined): number {
  const last = s.lastId ? (wallets ?? []).findIndex((w) => w.id === s.lastId) : -1;
  if (last >= 0) return last;
  if (s.want === "last") return Math.max(0, pickerItems(wallets, s.canPaste).length - 1);
  return 0;
}

export function pickerReducer<W extends PickerWallet>(s: PickerState<W>, a: PickerAction<W>): PickerState<W> {
  switch (a.type) {
    case "open": {
      if (s.pending) return s;
      const next = { ...s, open: true, want: a.want ?? "first" };
      return { ...next, active: highlight(next, s.wallets) };
    }
    case "close":
      return { ...s, open: false };
    case "discover":
      return { ...s, discovering: true, wallets: undefined, active: 0 };
    case "discovered":
      return { ...s, discovering: false, wallets: a.wallets, active: highlight(s, a.wallets) };
    case "move": {
      const target = menuKeyTarget(a.key, s.active, a.count);
      return target === null ? s : { ...s, active: target };
    }
    case "start":
      return {
        ...s,
        open: false,
        error: undefined,
        lastId: a.wallet.id,
        pending: { id: a.wallet.id, name: a.wallet.name, phase: "connecting" },
      };
    case "phase":
      return s.pending ? { ...s, pending: { ...s.pending, phase: a.phase } } : s;
    case "cancel":
      return s.pending?.phase === "verifying" ? s : { ...s, pending: undefined };
    case "done":
      return { ...s, pending: undefined };
    case "failed": {
      const next = { ...s, pending: undefined, error: a.error, open: true, want: "first" as const };
      return { ...next, active: highlight(next, s.wallets) };
    }
  }
}

/** Trigger text for the current progress (also announced in the polite live region). */
export function progressText(pending: PickerState["pending"]): string | undefined {
  if (!pending) return undefined;
  if (pending.phase === "connecting") return `Connecting ${pending.name}…`;
  if (pending.phase === "signing") return `Waiting for signature in ${pending.name}…`;
  return "Verifying signature…";
}

// ------------------------------------------------------------------------------------------ view

function WalletGlyph({ wallet }: { wallet: PickerWallet }) {
  return wallet.icon ? (
    <img className="dash-wallet-picker__icon" src={wallet.icon} alt="" width={28} height={28} />
  ) : (
    <Avatar initial={wallet.name.trim().charAt(0).toUpperCase() || "?"} shape="square" size="sm" />
  );
}

export interface WalletPickerViewProps<W extends PickerWallet> {
  state: PickerState<W>;
  /** Trigger label, e.g. "Connect EVM wallet". */
  label: string;
  /** Shown in the menu when no wallet was found (what to install or unlock). */
  installHint: ReactNode;
  ids: { trigger: string; menu: string; head: string };
  triggerRef?: Ref<HTMLButtonElement>;
  menuRef?: Ref<HTMLDivElement>;
  itemRef?: (index: number, el: HTMLButtonElement | null) => void;
  onTriggerClick?: () => void;
  onTriggerKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onMenuKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onPick?: (item: PickerItem) => void;
  onCancel?: () => void;
  testId?: string;
  /** Not available right now (role or live-mode gate): the trigger is disabled. */
  disabled?: boolean;
}

/** Stateless rendering of the picker (the container below owns state, focus and effects). */
export function WalletPickerView<W extends PickerWallet>({
  state,
  label,
  installHint,
  ids,
  triggerRef,
  menuRef,
  itemRef,
  onTriggerClick,
  onTriggerKeyDown,
  onMenuKeyDown,
  onPick,
  onCancel,
  testId,
  disabled,
}: WalletPickerViewProps<W>) {
  const items = pickerItems(state.wallets, state.canPaste);
  const progress = progressText(state.pending);
  const busy = Boolean(state.pending);
  const none = state.wallets?.length === 0;
  const headText = state.discovering
    ? "Looking for wallets in this browser…"
    : state.error && state.lastId
      ? friendlyError(state.error).title
      : undefined;
  const item = (it: PickerItem, index: number, body: ReactNode, extra = "") => (
    <button
      key={it.kind === "wallet" ? `w:${it.id}` : it.kind}
      ref={(el) => itemRef?.(index, el)}
      type="button"
      role="menuitem"
      tabIndex={index === state.active ? 0 : -1}
      className={`np-menu__item dash-wallet-picker__item${extra}`}
      data-active={index === state.active || undefined}
      onClick={() => onPick?.(it)}
    >
      {body}
    </button>
  );

  return (
    <div className="dash-wallet-picker" data-testid={testId}>
      <div className="dash-wallet-picker__row">
        <div className="np-popover-anchor dash-wallet-picker__anchor">
          <KitButton
            ref={triggerRef}
            id={ids.trigger}
            className="dash-wallet-picker__trigger"
            aria-haspopup="menu"
            aria-expanded={state.open}
            aria-controls={state.open ? ids.menu : undefined}
            loading={busy}
            loadingText={progress}
            disabled={disabled && !busy}
            leadingIcon={<WalletIcon size={18} aria-hidden="true" />}
            trailingIcon={<ChevronDownIcon size={16} aria-hidden="true" className="dash-wallet-picker__chevron" />}
            onClick={onTriggerClick}
            onKeyDown={onTriggerKeyDown}
          >
            {label}
          </KitButton>
          {state.open && (
            <div className="np-popover np-popover--menu dash-wallet-picker__popover">
              {headText && (
                <p
                  id={ids.head}
                  className={`dash-wallet-picker__head${state.discovering ? "" : " dash-wallet-picker__head--error"}`}
                >
                  {state.discovering && <span className="np-spinner" aria-hidden="true" />}
                  <span>{headText}</span>
                </p>
              )}
              {none && (
                <div className="dash-wallet-picker__empty" data-testid="wallet-picker-empty">
                  <span className="dash-wallet-picker__empty-title">No wallet found in this browser</span>
                  <span className="dash-wallet-picker__empty-hint">{installHint}</span>
                </div>
              )}
              <div
                ref={menuRef}
                id={ids.menu}
                role="menu"
                tabIndex={-1}
                aria-labelledby={ids.trigger}
                aria-describedby={headText ? ids.head : undefined}
                aria-busy={state.discovering || undefined}
                className="np-menu dash-wallet-picker__menu"
                onKeyDown={onMenuKeyDown}
              >
                {items.map((it, i) => {
                  if (it.kind === "wallet") {
                    const w = (state.wallets ?? []).find((x) => x.id === it.id) as W;
                    const last = Boolean(state.error) && state.lastId === w.id;
                    return item(
                      it,
                      i,
                      <>
                        <WalletGlyph wallet={w} />
                        <span className="np-menu__text">
                          <span className="np-menu__label">{w.name}</span>
                          <span className="np-menu__description">{last ? "Tried last · Try again" : "Detected"}</span>
                        </span>
                      </>,
                      last ? " dash-wallet-picker__item--last" : "",
                    );
                  }
                  // one separator between the wallets (or the empty-state text) and the footer actions
                  const footer = it.kind === "retry" || (it.kind === "paste" && !none && i > 0);
                  return (
                    <div key={it.kind} role="none" className="dash-wallet-picker__group">
                      {footer && <hr className="np-menu__separator" />}
                      {item(
                        it,
                        i,
                        <span className="np-menu__text">
                          <span className="np-menu__label">
                            {it.kind === "retry" ? "Search again" : "Paste a signature instead"}
                          </span>
                        </span>,
                        " dash-wallet-picker__item--footer",
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {busy && state.pending?.phase !== "verifying" && (
          <KitButton variant="ghost" className="dash-wallet-picker__cancel" onClick={onCancel}>
            Cancel
          </KitButton>
        )}
      </div>
      <span className="np-sr-only" role="status" aria-live="polite">
        {progress ?? ""}
      </span>
      <ErrorNote error={state.error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ container

export interface WalletPickerProps<W extends PickerWallet> {
  /** Trigger label, e.g. "Connect EVM wallet". */
  label: string;
  /** Finds the wallets (sync or async); runs when the menu first opens and on "Search again". */
  discover(): readonly W[] | Promise<readonly W[]>;
  /** Signs and submits with `wallet`; reject to show the error and let the user pick again. */
  onSign(wallet: W, ctx: SignContext): Promise<void>;
  /** Footer item "Paste a signature instead" (omit when the flow has no paste fallback). */
  onPaste?: () => void;
  installHint: ReactNode;
  "data-testid"?: string;
  /** Disables the trigger (e.g. a role or live-mode gate). */
  disabled?: boolean;
}

export function WalletPicker<W extends PickerWallet>({
  label,
  discover,
  onSign,
  onPaste,
  installHint,
  "data-testid": testId,
  disabled,
}: WalletPickerProps<W>) {
  const [state, dispatch] = useReducer(pickerReducer<W>, Boolean(onPaste), (p: boolean) => initialPickerState<W>(p));
  const base = useId();
  const ids = { trigger: `${base}-trigger`, menu: `${base}-menu`, head: `${base}-head` };
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLButtonElement | null)[]>([]);
  const run = useRef<AbortController | null>(null);
  const discoverySeq = useRef(0);
  const discoverRef = useRef(discover);
  discoverRef.current = discover;
  const items = pickerItems(state.wallets, state.canPaste);

  const close = (returnFocus: boolean) => {
    dispatch({ type: "close" });
    if (returnFocus) triggerRef.current?.focus();
  };

  /** Runs discovery; a newer run (or unmounting) drops the result of an older one. */
  const runDiscovery = () => {
    const n = ++discoverySeq.current;
    dispatch({ type: "discover" });
    Promise.resolve()
      .then(() => discoverRef.current())
      .catch(() => [] as readonly W[])
      .then((wallets) => {
        if (discoverySeq.current === n) dispatch({ type: "discovered", wallets });
      });
  };

  const open = (want: "first" | "last") => {
    if (state.pending) return;
    dispatch({ type: "open", want });
    if (!state.wallets && !state.discovering) runDiscovery();
  };

  // roving focus: the highlighted item, or the menu itself while discovering
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-focus when the discovered items render
  useEffect(() => {
    if (!state.open) return;
    const el = itemEls.current[state.active];
    if (el) el.focus();
    else menuRef.current?.focus();
  }, [state.open, state.active, state.wallets]);

  // click outside closes (focus stays where the user clicked)
  useEffect(() => {
    if (!state.open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) dispatch({ type: "close" });
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [state.open]);

  // unmounting (e.g. the challenge expired or the attestation finished) stops all waiting
  useEffect(
    () => () => {
      discoverySeq.current++;
      run.current?.abort();
    },
    [],
  );

  const start = (w: W) => {
    run.current?.abort();
    const ac = new AbortController();
    run.current = ac;
    dispatch({ type: "start", wallet: w });
    triggerRef.current?.focus();
    const ctx: SignContext = {
      signal: ac.signal,
      setPhase: (phase) => {
        if (!ac.signal.aborted) dispatch({ type: "phase", phase });
      },
    };
    Promise.resolve()
      .then(() => onSign(w, ctx))
      .then(
        () => {
          if (!ac.signal.aborted) dispatch({ type: "done" });
        },
        (error: unknown) => {
          if (!ac.signal.aborted) dispatch({ type: "failed", error });
        },
      );
  };

  const pick = (it: PickerItem) => {
    if (it.kind === "wallet") {
      const w = state.wallets?.find((x) => x.id === it.id);
      if (w) start(w);
    } else if (it.kind === "retry") {
      runDiscovery();
    } else {
      close(false);
      onPaste?.();
    }
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (state.pending || state.open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open(triggerKeyTarget(e.key) ?? "first");
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    } else if (menuKeyTarget(e.key, state.active, items.length) !== null) {
      e.preventDefault();
      dispatch({ type: "move", key: e.key, count: items.length });
    }
  };

  return (
    <div ref={rootRef}>
      <WalletPickerView
        state={state}
        label={label}
        installHint={installHint}
        ids={ids}
        triggerRef={triggerRef}
        menuRef={menuRef}
        itemRef={(i, el) => {
          itemEls.current[i] = el;
        }}
        onTriggerClick={() => {
          if (state.pending) return;
          if (state.open) close(true);
          else open("first");
        }}
        onTriggerKeyDown={onTriggerKeyDown}
        onMenuKeyDown={onMenuKeyDown}
        onPick={pick}
        onCancel={() => {
          run.current?.abort();
          dispatch({ type: "cancel" });
          triggerRef.current?.focus();
        }}
        testId={testId}
        disabled={disabled}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ connector button

/**
 * The same "Connect … wallet" trigger for connectors that open their own wallet selector (NEAR Connect):
 * no dropdown; progress, Cancel and the error work like the picker's.
 */
export function WalletConnectButton({
  label,
  walletName,
  onSign,
  "data-testid": testId,
}: {
  label: string;
  /** Used in the progress text ("Waiting for signature in your NEAR wallet…"). */
  walletName: string;
  onSign(ctx: SignContext): Promise<void>;
  "data-testid"?: string;
}) {
  const [pending, setPending] = useState<SignPhase>();
  const [error, setError] = useState<unknown>();
  const run = useRef<AbortController | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => run.current?.abort(), []);
  const progress = progressText(pending ? { id: "", name: walletName, phase: pending } : undefined);

  const start = () => {
    if (pending) return;
    run.current?.abort();
    const ac = new AbortController();
    run.current = ac;
    setError(undefined);
    setPending("connecting");
    const ctx: SignContext = {
      signal: ac.signal,
      setPhase: (phase) => {
        if (!ac.signal.aborted) setPending(phase);
      },
    };
    Promise.resolve()
      .then(() => onSign(ctx))
      .then(
        () => {
          if (!ac.signal.aborted) setPending(undefined);
        },
        (e: unknown) => {
          if (ac.signal.aborted) return;
          setPending(undefined);
          setError(e);
        },
      );
  };

  return (
    <div className="dash-wallet-picker" data-testid={testId}>
      <div className="dash-wallet-picker__row">
        <KitButton
          ref={triggerRef}
          className="dash-wallet-picker__trigger"
          loading={Boolean(pending)}
          loadingText={progress}
          leadingIcon={<WalletIcon size={18} aria-hidden="true" />}
          onClick={start}
        >
          {label}
        </KitButton>
        {pending && pending !== "verifying" && (
          <KitButton
            variant="ghost"
            className="dash-wallet-picker__cancel"
            onClick={() => {
              run.current?.abort();
              setPending(undefined);
              triggerRef.current?.focus();
            }}
          >
            Cancel
          </KitButton>
        )}
      </div>
      <span className="np-sr-only" role="status" aria-live="polite">
        {progress ?? ""}
      </span>
      <ErrorNote error={error} />
    </div>
  );
}
