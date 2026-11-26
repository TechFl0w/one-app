import Link from "next/link";
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/server/control";

export const metadata: Metadata = { title: "Control center · One App", robots: { index: false, follow: false } };

/** One App's own control center: every app users built, and what the system learns from them. */
export default async function ControlLayout({ children }: LayoutProps<"/control">) {
  const { email } = await requirePlatformAdmin();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-ink px-4 py-2.5 text-sm text-white md:px-8">
        <Link href="/control" className="mr-4 font-bold">
          One App · Control center
        </Link>
        <Link href="/control" className="rounded-full px-3 py-1 hover:bg-white/10">
          Apps
        </Link>
        <Link href="/control/learning" className="rounded-full px-3 py-1 hover:bg-white/10">
          Learning
        </Link>
        <span className="ml-auto text-white/60">{email}</span>
      </header>
      {children}
    </div>
  );
}
