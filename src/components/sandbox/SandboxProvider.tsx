"use client";

import { createContext, useContext } from "react";
import type { SandboxBridge } from "@/sandbox/protocol";

/** Data access for generated components, for blocks the page renders in the browser (drafts, the demo). */
const SandboxContext = createContext<{ bridge: SandboxBridge; basePath: string } | null>(null);
export const useSandbox = () => useContext(SandboxContext);

export function SandboxProvider({ value, children }: { value: { bridge: SandboxBridge; basePath: string }; children: React.ReactNode }) {
  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}
