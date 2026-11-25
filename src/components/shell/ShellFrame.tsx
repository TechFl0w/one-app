"use client";

import { useEdit } from "@/components/edit/EditProvider";

/** Lays the menu and the content side by side (sidebar) or stacked (top bar / menu button only). */
export function ShellFrame({ children }: { children: React.ReactNode }) {
  const { blueprint } = useEdit();
  const side = (blueprint.theme?.menu ?? "side") === "side";
  return <div className={`flex min-h-screen flex-1 flex-col ${side ? "md:flex-row" : ""}`}>{children}</div>;
}
