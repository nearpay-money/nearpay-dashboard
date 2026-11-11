/**
 * The sidebar search as a combobox (WAI-ARIA 1.2 combobox + listbox): typing lists matching pages and a
 * pasted object ID; ↑/↓ move, Enter opens, Escape closes; ⌘K / Ctrl+K focuses the field from anywhere.
 * The listbox opens under the field, wider than the sidebar (positioned by `dash-jump` CSS, no inline styles).
 */
import { SearchIcon } from "@nearpay-internal/ui";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useApp } from "./context";
import { type JumpTarget, jumpPages, jumpResults } from "./jump-search";

const INPUT = ".dash-search__input";

export function useJump(): { field: ReactNode } {
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
  }, []);

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
  const activeId = shown && results[active] ? `${listId}-${active}` : undefined;
  const field = (
    <search className="dash-search">
      <form
        className="dash-search__form"
        onSubmit={(e) => {
          e.preventDefault();
          goRef.current(state.current.results[state.current.active]);
        }}
      >
        <SearchIcon size={16} className="dash-search__icon" />
        <input
          className="dash-search__input"
          type="search"
          role="combobox"
          aria-label="Search pages, or paste an ID"
          placeholder="Search"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={shown}
          aria-activedescendant={activeId}
          aria-keyshortcuts="Meta+K Control+K"
          autoComplete="off"
          spellCheck={false}
          value={query}
          data-testid="jump-search"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
        />
        <span className="dash-search__key" aria-hidden="true">
          ⌘K
        </span>
        {panel}
      </form>
    </search>
  );
  return { field };
}
