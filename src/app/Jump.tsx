/**
 * The top-bar search as a combobox (WAI-ARIA 1.2 combobox + listbox): typing lists matching pages and a
 * pasted object ID; ↑/↓ move, Enter opens, Escape closes; ⌘K / Ctrl+K focuses the field from anywhere.
 * The field itself is the kit AppShell `search` (form role="search"); the combobox attributes are set on
 * its input here, and the listbox renders in the top bar (positioned by `dash-jump` CSS, no inline styles).
 */
import type { AppShellSearch } from "@nearpay-internal/ui";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useApp } from "./context";
import { type JumpTarget, jumpPages, jumpResults } from "./jump";

const INPUT = ".np-shell__search-input";

export function useJump(): { search: AppShellSearch; panel: ReactNode } {
  const app = useApp();
  const listId = `dash-jump${useId().replace(/:/g, "")}`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const pages = useMemo(() => jumpPages(app.registry, app.session?.role), [app.registry, app.session?.role]);
  const results = useMemo(() => jumpResults(query, pages, app.registry), [query, pages, app.registry]);
  const shown = open && query.trim() !== "";
  const state = useRef({ results, active, shown });
  state.current = { results, active, shown };

  const go = (t: JumpTarget | undefined) => {
    if (!t) return;
    setOpen(false);
    setQuery("");
    document.querySelector<HTMLInputElement>(INPUT)?.blur();
    app.navigate(app.href(t.path));
  };
  const goRef = useRef(go);
  goRef.current = go;

  // combobox semantics + keyboard on the kit's input
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>(INPUT);
    if (!input) return;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", listId);
    input.setAttribute("aria-keyshortcuts", "Meta+K Control+K");
    const onKey = (e: KeyboardEvent) => {
      const s = state.current;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        const n = s.results.length;
        if (n) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
      } else if (e.key === "Escape") {
        if (s.shown) {
          e.preventDefault();
          setOpen(false);
        } else if (input.value) {
          setQuery("");
        }
      }
    };
    const onFocus = () => setOpen(true);
    const onBlur = () => setTimeout(() => setOpen(false), 120);
    input.addEventListener("keydown", onKey);
    input.addEventListener("focus", onFocus);
    input.addEventListener("blur", onBlur);
    return () => {
      input.removeEventListener("keydown", onKey);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
    };
  }, [listId]);

  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>(INPUT);
    if (!input) return;
    input.setAttribute("aria-expanded", String(shown));
    const id = shown && results[active] ? `${listId}-${active}` : "";
    if (id) input.setAttribute("aria-activedescendant", id);
    else input.removeAttribute("aria-activedescendant");
  }, [shown, results, active, listId]);

  // ⌘K / Ctrl+K from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        const input = document.querySelector<HTMLInputElement>(INPUT);
        if (!input) return;
        e.preventDefault();
        input.focus();
        input.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const search: AppShellSearch = {
    label: "Search pages, or paste an ID",
    placeholder: "Search pages, or paste an ID",
    value: query,
    onChange: (v) => {
      setQuery(v);
      setActive(0);
      setOpen(true);
    },
    onSubmit: () => goRef.current(state.current.results[state.current.active]),
    "data-testid": "jump-search",
  };

  const panel = (
    <div className="dash-jump" hidden={!shown}>
      <div
        id={listId}
        role="listbox"
        aria-label="Search results"
        className="dash-jump__list"
        data-testid="jump-results"
      >
        {results.map((r, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is handled on the combobox input (aria-activedescendant)
          <div
            key={r.id}
            id={`${listId}-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            className="dash-jump__option"
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(r)}
          >
            <span className="dash-jump__label">{r.label}</span>
            <span className="dash-jump__hint">{r.hint}</span>
          </div>
        ))}
      </div>
      {results.length === 0 ? (
        <p className="dash-jump__empty" role="status">
          No page matches “{query.trim()}”. Paste a payment, customer or link ID to open it.
        </p>
      ) : null}
    </div>
  );
  return { search, panel };
}
