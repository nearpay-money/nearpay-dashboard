/** Data hooks shared by every page (feature modules use these instead of their own fetch state). */
import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  reload(): void;
}

/** Runs `fn` when `deps` change; keeps the last data while reloading (no flash of empty content). */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // biome-ignore lint/correctness/useExhaustiveDependencies: callers pass their own dependency list
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fnRef.current().then(
      (data) => live && setState({ data, error: undefined, loading: false }),
      (error: unknown) => live && setState({ data: undefined, error, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export interface Mutation<A extends unknown[], R> {
  /** Runs the action; resolves with its result, or undefined when it failed (the error is in `error`). */
  run(...args: A): Promise<R | undefined>;
  readonly busy: boolean;
  readonly error: unknown;
  reset(): void;
}

/** Busy/error state around one write (button `loading`, `<ErrorState>` / `friendlyError`). */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>): Mutation<A, R> {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const run = useCallback(async (...args: A) => {
    setBusy(true);
    setError(undefined);
    try {
      return await fnRef.current(...args);
    } catch (e) {
      if (mounted.current) setError(e);
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);
  const reset = useCallback(() => setError(undefined), []);
  return { run, busy, error, reset };
}

export interface CursorPage<T> {
  readonly data: readonly T[];
  readonly has_more: boolean;
}

export interface CursorList<T> extends AsyncState<CursorPage<T>> {
  /** 1-based index of the first row on this page (for "Showing 21–40"). */
  readonly offset: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  next(): void;
  previous(): void;
  /** Back to the first page (call when filters change). */
  restart(): void;
}

/**
 * Cursor pagination over a spec list route (`starting_after`; lists are ordered newest first).
 * `fetchPage(after)` is called with the id of the last row of the previous page, or undefined.
 */
export function useCursorList<T extends { id: string }>(
  fetchPage: (startingAfter: string | undefined) => Promise<CursorPage<T>>,
  deps: DependencyList,
  pageSize: number,
): CursorList<T> {
  const [state, setState] = useState<{ deps: DependencyList; cursors: string[] }>({ deps, cursors: [] });
  // a filter change starts over from the first page (reset during render: no fetch with a stale cursor)
  const changed = state.deps.length !== deps.length || state.deps.some((d, i) => !Object.is(d, deps[i]));
  if (changed) setState({ deps, cursors: [] });
  const cursors = changed ? [] : state.cursors;
  const setCursors = (f: (c: string[]) => string[]) => setState((s) => ({ ...s, cursors: f(s.cursors) }));
  const after = cursors[cursors.length - 1];
  // biome-ignore lint/correctness/useExhaustiveDependencies: callers pass their own dependency list
  const page = useAsync(() => fetchPage(after), [...deps, after]);
  return {
    ...page,
    offset: cursors.length * pageSize + 1,
    hasPrevious: cursors.length > 0,
    hasNext: Boolean(page.data?.has_more),
    next: () => {
      const last = page.data?.data[page.data.data.length - 1];
      if (last) setCursors((c) => [...c, last.id]);
    },
    previous: () => setCursors((c) => c.slice(0, -1)),
    restart: () => setCursors(() => []),
  };
}

/** Seconds since the epoch, ticking every `intervalMs` (countdowns, "18 hours remaining"). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
