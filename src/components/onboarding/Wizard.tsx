"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Plus, Sparkles, X, Zap } from "lucide-react";
import { TEMPLATES, templateById, type Answers, type Question } from "@/templates";
import { initialValue, resolve } from "@/templates/types";
import { HoursEditor } from "./HoursEditor";
import { guessName, guessTemplate } from "@/templates/guess";

const EXAMPLES = [
  "I run a hair salon and want online booking",
  "I'm a landscaper and need quotes and invoices",
  "We repair cars and need a workshop board",
  "I make candles and sell online",
];
import { menuPages } from "@/engine/layout";
import { PageIcon } from "@/components/shell/Icon";

type BuildAction = (input: { templateId: string; name: string; timezone: string; answers: Answers }) => Promise<{ error?: string }>;

/**
 * Onboarding interview: kind of business + name → 3 short questions → "Here's what I'll build"
 * → Build it. Without `build` (public demo) the last step points to sign-up instead.
 */
export function Wizard({ build }: { build?: BuildAction }) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [picking, setPicking] = useState(false);
  // Answers the owner's own words already gave (the trade, the kind of salon) aren't asked again.
  const [known, setKnown] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const template = templateId ? templateById(templateId) : undefined;
  // At most three follow-up questions; anything after that starts from its default (changeable later).
  const questions = (template?.questions ?? []).filter((q) => !known.includes(q.id)).slice(0, 3);
  const lastStep = questions.length + 1; // 0 = type+name, 1..n = questions, n+1 = preview
  const preview = template && step === lastStep ? template.build({ name: name.trim() || "Your business", timezone: "UTC" }, answers) : null;

  const describe = (text: string) => {
    setAbout(text);
    const g = guessTemplate(text);
    if (g && !picking) {
      setTemplateId(g.templateId);
      setAnswers(g.answers);
      setKnown(Object.keys(g.answers));
    }
    const n = guessName(text);
    if (n && !name.trim()) setName(n);
  };
  const next = () => {
    setError(null);
    if (step === 0) {
      if (!template) {
        setPicking(true);
        return setError("Tell me a bit more, or pick the closest below.");
      }
      if (!name.trim()) return setError("Give your business a name.");
    }
    setStep((s) => Math.min(s + 1, lastStep));
  };

  const submit = () =>
    startTransition(async () => {
      if (!build || !template) return;
      const r = await build({ templateId: template.id, name, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", answers });
      if (r?.error) setError(r.error);
    });

  const q = step >= 1 && step <= questions.length ? questions[step - 1] : null;

  return (
    <div className="card w-full max-w-xl p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        {step > 0 && (
          <button type="button" className="rounded-full p-1.5 hover:bg-ground" onClick={() => setStep((s) => s - 1)} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {Array.from({ length: lastStep + 1 }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} />
          ))}
        </div>
        <span className="text-xs text-muted">
          {step + 1} / {lastStep + 1}
        </span>
      </div>

      {step === 0 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold">What business do you run, and what do you need help with?</h1>
            <p className="mt-1 text-sm text-muted">In your own words. I’ll ask two or three things, show you the plan, then build it.</p>
          </div>
          <textarea
            className="input min-h-28"
            value={about}
            onChange={(e) => describe(e.target.value)}
            placeholder="I run a hair salon with 3 stylists and want online booking and fewer no-shows"
            maxLength={600}
            autoFocus
            aria-label="Your business, in your own words"
          />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="rounded-full bg-ground px-3 py-1.5 text-left text-xs text-muted hover:bg-accent-tint hover:text-accent" onClick={() => describe(ex)}>
                {ex}
              </button>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="biz-name">Business name</label>
            <input id="biz-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Studio Mila" maxLength={80} />
          </div>
          {template && !picking ? (
            <p className="rounded-2xl bg-accent-tint px-4 py-3 text-sm text-accent">
              I’ll start from <b>{template.label.toLowerCase()}</b> — {template.description.charAt(0).toLowerCase() + template.description.slice(1)}{" "}
              <button type="button" className="font-semibold underline" onClick={() => setPicking(true)}>Not quite?</button>
            </p>
          ) : (
            <fieldset>
              <legend className="label">Pick the closest</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {TEMPLATES.map((t) => (
                  <label key={t.id} className={`cursor-pointer rounded-2xl border p-4 ${templateId === t.id ? "border-accent bg-accent-tint" : "border-line hover:bg-ground"}`}>
                    <input type="radio" name="template" className="sr-only" checked={templateId === t.id} onChange={() => { setTemplateId(t.id); setAnswers({}); setKnown([]); }} />
                    <span className={`block font-semibold ${templateId === t.id ? "text-accent" : ""}`}>{t.label}</span>
                    <span className="mt-1 block text-xs text-muted">{t.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      {q && <QuestionStep key={q.id} question={q} answers={answers} value={answers[q.id] ?? initialValue(q, answers)} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />}

      {preview && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold">Here’s what I’ll build</h1>
            <p className="mt-1 text-sm text-muted">For {name.trim()}. Anything I didn’t ask about starts with a sensible default. Rename, move or remove anything later — by clicking or by asking the assistant.</p>
          </div>
          <section>
            <h2 className="mb-2 text-sm font-semibold">Pages</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {menuPages(preview.blueprint).map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-xl bg-ground px-3 py-2 text-sm">
                  <PageIcon name={p.icon} className="h-4 w-4 text-accent" />
                  <span className="font-medium">{p.label}</span>
                  <span className="ml-auto text-xs text-muted">{p.layout.blocks.length} block{p.layout.blocks.length === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">What it keeps track of</h2>
            <ul className="space-y-1 text-sm">
              {preview.blueprint.tables.map((t) => (
                <li key={t.id}>
                  <span className="font-medium">{t.label}</span>
                  <span className="text-muted"> — {t.fields.slice(0, 5).map((f) => f.label.toLowerCase()).join(", ")}{t.fields.length > 5 ? "…" : ""}</span>
                </li>
              ))}
            </ul>
          </section>
          {preview.blueprint.scheduling && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Online booking</h2>
              <p className="text-sm">Clients book from your own booking page (you get a link and a QR code to share){preview.blueprint.scheduling.deposit ? ", and pay a deposit to hold the time" : ""}. Reminders go out the day before.</p>
            </section>
          )}
          {preview.blueprint.automations.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Done for you automatically</h2>
              <ul className="space-y-1 text-sm">
                {preview.blueprint.automations.map((a) => (
                  <li key={a.id} className="flex items-center gap-2"><Zap className="h-3.5 w-3.5 text-accent" /> {a.label}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted">Messages only go out once you connect WhatsApp or email.</p>
            </section>
          )}
          {preview.seed.length > 0 && <p className="text-sm text-muted">Starts with {preview.seed.length} records from your answers.</p>}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}

      <div className="mt-8 flex justify-end">
        {step < lastStep ? (
          <button type="button" className="btn-primary" onClick={next}>Continue</button>
        ) : build ? (
          <button type="button" className="btn-primary" onClick={submit} disabled={pending}>
            <Sparkles className="h-4 w-4" /> {pending ? "Building…" : "Build it"}
          </button>
        ) : (
          <Link href="/login" className="btn-primary"><Sparkles className="h-4 w-4" /> Sign up to build it</Link>
        )}
      </div>
    </div>
  );
}

function QuestionStep({ question: q, answers, value, onChange }: { question: Question; answers: Answers; value: string | string[]; onChange: (v: string | string[]) => void }) {
  const [entry, setEntry] = useState("");
  const add = () => {
    const v = entry.trim();
    if (q.kind === "list" && Array.isArray(value) && v && !value.includes(v) && value.length < q.max) onChange([...value, v]);
    setEntry("");
  };
  return (
    <fieldset className="space-y-4">
      <legend className="text-xl font-bold">{resolve(q.label, answers)}</legend>
      {(q.kind === "list" || q.kind === "hours") && q.hint && <p className="text-sm text-muted">{q.hint}</p>}
      {q.kind === "hours" && typeof value === "string" && <HoursEditor value={value} onChange={onChange} />}
      {q.kind === "choice" && (
        <div className="space-y-2">
          {q.options.map((o) => (
            <label key={o.id} className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 ${value === o.id ? "border-accent bg-accent-tint" : "border-line hover:bg-ground"}`}>
              <input type="radio" name={q.id} className="sr-only" checked={value === o.id} onChange={() => onChange(o.id)} />
              <span className="flex-1 text-sm font-medium">{o.label}</span>
              {value === o.id && <Check className="h-4 w-4 text-accent" />}
            </label>
          ))}
        </div>
      )}
      {q.kind === "multi" && (
        <div className="space-y-2">
          {q.options.map((o) => {
            const on = Array.isArray(value) && value.includes(o.id);
            return (
              <label key={o.id} className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 ${on ? "border-accent bg-accent-tint" : "border-line hover:bg-ground"}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={on}
                  onChange={() => onChange(on ? (value as string[]).filter((x) => x !== o.id) : [...(Array.isArray(value) ? value : []), o.id])}
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{o.label}</span>
                  {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {q.kind === "list" && Array.isArray(value) && (
        <div className="space-y-3">
          <ul className="flex flex-wrap gap-2">
            {value.map((v) => (
              <li key={v} className="flex items-center gap-1 rounded-full bg-accent-tint py-1 pl-3 pr-1 text-sm text-accent">
                {v}
                <button type="button" className="rounded-full p-0.5 hover:bg-card" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            {/* Leaving the field also adds what was typed, so Continue never drops it. */}
            <input className="input" value={entry} onChange={(e) => setEntry(e.target.value)} onBlur={add} placeholder={resolve(q.placeholder, answers)} maxLength={60} aria-label={resolve(q.label, answers)} />
            <button className="btn-ghost shrink-0 px-4" aria-label="Add"><Plus className="h-4 w-4" /></button>
          </form>
        </div>
      )}
    </fieldset>
  );
}
