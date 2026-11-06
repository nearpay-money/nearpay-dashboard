/** Data-loading hook for pages. */
import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  reload(): void;
}

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
