"use client";

import { useEffect, useState } from "react";
import type { SandboxBridge } from "@/sandbox/protocol";

type Code = { compiled: string; css?: string };

/** Fetches a screen's code the page didn't include (e.g. a screen added in Edit mode), then shows it. */
export function OnDemandFrame({ componentId, load, children }: { componentId: string; load: SandboxBridge["loadComponent"]; children: (code: Code) => React.ReactNode }) {
  const [state, setState] = useState<{ code?: Code; error?: string }>({});
  useEffect(() => {
    let live = true;
    if (!load) return;
    load(componentId).then(
      (r) => live && setState(r.ok ? { code: r.value } : { error: r.error }),
      () => live && setState({ error: "Couldn’t load this screen." }),
    );
    return () => {
      live = false;
    };
  }, [componentId, load]);
  if (state.code) return <>{children(state.code)}</>;
  return <p className="p-4 text-sm text-muted">{state.error ?? (load ? "Loading…" : "Save to see this screen.")}</p>;
}
