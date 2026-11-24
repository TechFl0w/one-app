"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronsUpDown, Menu, X } from "lucide-react";
import { PageIcon } from "./Icon";

export interface SidebarProps {
  businessName: string;
  basePath: string;
  pages: { id: string; label: string; icon?: string }[];
  businesses?: { id: string; name: string }[];
  footer?: React.ReactNode;
}

/** White sidebar with the business's pages; collapses into a drawer on phones. */
export function Sidebar({ businessName, basePath, pages, businesses = [], footer }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const activeId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? pages[0]?.id;

  const nav = (
    <>
      <div className="relative mb-6">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left hover:bg-ground disabled:hover:bg-transparent"
          onClick={() => setSwitching((s) => !s)}
          disabled={businesses.length < 2}
          aria-expanded={switching}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-bold text-white">
            {businessName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">{businessName}</span>
          {businesses.length > 1 && <ChevronsUpDown className="h-4 w-4 text-muted" aria-hidden />}
        </button>
        {switching && (
          <ul className="card absolute inset-x-0 top-full z-20 mt-1 p-1.5">
            {businesses.map((b) => (
              <li key={b.id}>
                <Link href={`/b/${b.id}`} className="block truncate rounded-xl px-3 py-2 text-sm hover:bg-ground">
                  {b.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <nav className="flex-1 space-y-0.5" aria-label="Pages">
        {pages.map((p) => {
          const active = p.id === activeId;
          return (
            <Link
              key={p.id}
              href={`${basePath}/p/${p.id}`}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-full px-4 py-2 text-sm transition-colors ${
                active ? "bg-accent-tint font-semibold text-accent" : "text-muted hover:bg-ground hover:text-ink"
              }`}
            >
              <PageIcon name={p.icon} className="h-[18px] w-[18px] shrink-0" />
              <span className="truncate">{p.label}</span>
            </Link>
          );
        })}
      </nav>
      {footer && <div className="mt-4 border-t border-line pt-4">{footer}</div>}
    </>
  );

  return (
    <>
      {/* Phone top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-card px-4 py-3 md:hidden">
        <button type="button" className="-ml-1 rounded-full p-1.5 hover:bg-ground" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <span className="truncate font-semibold">{businessName}</span>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/20" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-card p-4 shadow-soft">
            <button
              type="button"
              className="absolute right-3 top-3 rounded-full p-1.5 hover:bg-ground"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {nav}
          </aside>
        </div>
      )}
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-card p-4 md:flex">{nav}</aside>
    </>
  );
}
