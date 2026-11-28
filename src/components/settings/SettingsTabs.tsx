"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Settings sections as tabs across the top, so owners never scroll to find one. */
export function SettingsTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  // The longest matching tab wins (General is the settings root).
  const active = [...tabs].sort((a, b) => b.href.length - a.href.length).find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href;
  return (
    <nav aria-label="Settings" className="mx-auto -mt-2 mb-8 flex max-w-3xl gap-1 overflow-x-auto border-b border-line pb-px">
      {tabs.map((t) => {
        const on = t.href === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${on ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
