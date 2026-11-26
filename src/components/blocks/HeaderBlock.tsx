import type { Block, Blueprint, Field } from "@/schema/blueprint";
import { singular } from "@/lib/words";
import { AddRecordButton } from "./RecordOpener";
import { formatMoney, valueText, type FormatCtx } from "./format";
import { TONE, toneOf } from "./tone";

type Stat = { label: string; value: number | null; field?: Field; tone?: string };

/** "drop-off today|drop-offs today" picks by the number; a plain label is used as is. */
const plural = (label: string, n: number | null) => (label.includes("|") ? label.split("|")[n === 1 ? 0 : 1] : label);

function greeting(now: Date, timezone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/**
 * The top of a page: who and when ("Good morning · Wednesday, 25 November"), a line of live
 * counts ("4 cars in the shop · 1 job late"), and New buttons. Options: title, text, stats, add.
 */
export function HeaderBlock({ block, blueprint, stats, ctx, now = new Date() }: { block: Block; blueprint: Blueprint; stats: Stat[]; ctx: FormatCtx; now?: Date }) {
  const o = block.options ?? {};
  const name = blueprint.business.name;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const date = new Intl.DateTimeFormat(ctx.locale ?? "en-CA", { weekday: "long", day: "numeric", month: "long", timeZone: ctx.timezone }).format(now);
  const add = (Array.isArray(o.add) ? o.add : []).map((id) => blueprint.tables.find((t) => t.id === id)).filter((t) => !!t).slice(0, 3);
  const num = (s: Stat) => (s.value === null ? "—" : s.field?.type === "money" ? formatMoney(s.value, s.field.currency ?? ctx.currency, ctx.locale) : s.field ? valueText(s.field, s.value, {}, ctx) : String(s.value));
  return (
    <section className="card flex h-full flex-wrap items-center gap-4 px-5 py-5 sm:gap-5 md:px-7 md:py-6" style={{ background: "linear-gradient(120deg, var(--card) 55%, var(--accent-tint))" }}>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ink text-base font-extrabold tracking-tight text-ground sm:h-16 sm:w-16 sm:rounded-[18px] sm:text-xl">{initials || "•"}</div>
      <div className="min-w-0 flex-[1_1_10rem]">
        <p className="text-sm text-muted">{typeof o.title === "string" && o.title ? o.title : `${greeting(now, ctx.timezone)}, ${name}`}</p>
        <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight md:text-[28px]">{date}</h1>
        {(stats.length > 0 || typeof o.text === "string") && (
          <p className="mt-1.5 text-sm text-ink/80">
            {typeof o.text === "string" && o.text}
            {stats.map((s, i) => {
              const hot = s.tone && s.value ? TONE[toneOf(s.tone)].color : undefined;
              return (
                <span key={i}>
                  {(i > 0 || typeof o.text === "string") && <span className="mx-1.5 text-muted/60">·</span>}
                  <span className="whitespace-nowrap" style={hot ? { color: hot, fontWeight: 600 } : undefined}>
                    {num(s)} {plural(s.label, s.value)}
                  </span>
                </span>
              );
            })}
          </p>
        )}
      </div>
      {add.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {add.map((t) => (
            <AddRecordButton key={t.id} table={t.id} label={singular(t.label).toLowerCase()} big />
          ))}
        </div>
      )}
    </section>
  );
}
