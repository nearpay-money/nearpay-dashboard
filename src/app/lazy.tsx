/**
 * Code-split pages for feature modules: `lazyPage(() => import("./Invoices"), "Invoices")` returns a
 * component that loads its chunk on first render, with the page skeleton as fallback. A failed chunk
 * load (deploy in between, offline) shows an error with retry instead of a blank page.
 */
import { Button, Callout } from "@nearpay-internal/ui";
import { Component, type ComponentType, lazy, type ReactNode, Suspense } from "react";
import { LoadingState } from "../ui/page";

class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="dash-page">
        <Callout tone="danger" title="This page couldn't load" role="alert">
          <p>The dashboard may have been updated. Reload to get the latest version.</p>
          <div className="dash-retry">
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </Callout>
      </div>
    );
  }
}

export function lazyPage<M, K extends keyof M>(load: () => Promise<M>, name: K, what = "Loading"): M[K] {
  const Lazy = lazy(async () => ({ default: (await load())[name] as ComponentType<object> }));
  // biome-ignore lint/correctness/noComponentHookFactories: called once per page at module load, never during render
  function LazyPage(props: object) {
    return (
      <ChunkBoundary>
        <Suspense fallback={<LoadingState what={what} />}>
          <Lazy {...props} />
        </Suspense>
      </ChunkBoundary>
    );
  }
  return LazyPage as M[K];
}
