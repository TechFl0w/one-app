"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useEditOptional } from "@/components/edit/editContext";
import type { Site, SiteSection } from "@/schema/blueprint";

type Img = { path: string; name: string };
const ADD: { type: SiteSection["type"]; label: string; make: (id: string) => SiteSection }[] = [
  { type: "about", label: "About us", make: (id) => ({ id, type: "about", title: "About us", text: "" }) },
  { type: "banner", label: "Banner (a special or notice)", make: (id) => ({ id, type: "banner", text: "" }) },
  { type: "gallery", label: "Photo gallery", make: (id) => ({ id, type: "gallery", title: "Our work", images: [] }) },
  { type: "reviews", label: "Reviews", make: (id) => ({ id, type: "reviews", title: "What clients say", quotes: [{ text: "", name: "" }] }) },
  { type: "services", label: "Services & prices (live)", make: (id) => ({ id, type: "services", title: "Services & prices" }) },
  { type: "team", label: "Team (live)", make: (id) => ({ id, type: "team", title: "Meet the team" }) },
  { type: "hours", label: "Hours & address (live)", make: (id) => ({ id, type: "hours", title: "Visit us" }) },
  { type: "contact", label: "Contact form", make: (id) => ({ id, type: "contact", title: "Get in touch" }) },
];
const NAMES: Record<SiteSection["type"], string> = { hero: "Top banner", services: "Services", team: "Team", about: "About", gallery: "Gallery", reviews: "Reviews", banner: "Banner", hours: "Hours & address", contact: "Contact form" };

/**
 * The owner edits their website's words and photos here: section by section, move, remove, add.
 * Live sections (services, team, hours) only take a title — their content comes from the app.
 */
export function SiteEditor({ site, upload, photos }: { site: Site; upload: (name: string, size: number, mime: string) => Promise<{ path: string; url: string } | { error: string }>; photos: Record<string, string> }) {
  const edit = useEditOptional();
  const [sections, setSections] = useState<SiteSection[]>(site.sections);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>(photos);
  if (!edit) return null;
  const set = (i: number, patch: Partial<SiteSection>) => setSections((x) => x.map((s, n) => (n === i ? ({ ...s, ...patch } as SiteSection) : s)));
  const move = (i: number, d: -1 | 1) => setSections((x) => { const c = [...x]; [c[i], c[i + d]] = [c[i + d], c[i]]; return c; });
  const photo = async (f: File): Promise<Img | null> => {
    const t = await upload(f.name, f.size, f.type);
    if ("error" in t) { setMsg({ text: t.error, bad: true }); return null; }
    const r = await fetch(t.url, { method: "PUT", body: f, headers: { "content-type": f.type } }).catch(() => null);
    if (!r?.ok) { setMsg({ text: "Couldn’t upload the photo.", bad: true }); return null; }
    setPreviews((p) => ({ ...p, [t.path]: URL.createObjectURL(f) }));
    return { path: t.path, name: f.name };
  };
  const save = async () => {
    setBusy(true);
    setMsg(null);
    // Empty quotes and banners are left out rather than published blank.
    const clean = sections
      .map((s) => (s.type === "reviews" ? { ...s, quotes: s.quotes.filter((q) => q.text.trim()) } : s))
      .filter((s) => !(s.type === "banner" && !s.text.trim()) && !(s.type === "about" && !s.text.trim()));
    const err = await edit.applyNow([{ op: "setSite", site: { ...site, sections: clean } }], "Update the website");
    setBusy(false);
    setMsg(err ? { text: err, bad: true } : { text: "Saved — your website is updated." });
  };
  const newId = (type: string) => { let n = 1; while (sections.some((s) => s.id === `sec_${type}_${n}`)) n++; return `sec_${type}_${n}`; };
  const field = "input py-2";
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={s.id} className="card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{NAMES[s.type]}</p>
            <span className="ml-auto flex gap-1">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded-full p-1.5 hover:bg-ground disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" disabled={i === sections.length - 1} onClick={() => move(i, 1)} className="rounded-full p-1.5 hover:bg-ground disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
              {s.type !== "hero" && <button type="button" onClick={() => setSections((x) => x.filter((_, n) => n !== i))} className="rounded-full p-1.5 text-muted hover:bg-red-50 hover:text-red-700" aria-label="Remove section"><Trash2 className="h-4 w-4" /></button>}
            </span>
          </div>
          {s.type !== "banner" && <input className={field} value={s.title ?? ""} onChange={(e) => set(i, { title: e.target.value })} placeholder="Heading" aria-label="Heading" />}
          {s.type === "hero" && <input className={field} value={s.subtitle ?? ""} onChange={(e) => set(i, { subtitle: e.target.value })} placeholder="One line under the heading" aria-label="Subtitle" />}
          {(s.type === "services" || s.type === "team" || s.type === "contact") && <input className={field} value={s.intro ?? ""} onChange={(e) => set(i, { intro: e.target.value })} placeholder="A short intro (optional)" aria-label="Intro" />}
          {s.type === "about" && <textarea className={field} rows={5} value={s.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="Your story, what makes you different" aria-label="Text" />}
          {s.type === "banner" && <input className={field} value={s.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="Winter special: 20% off deep cleans in December" aria-label="Banner text" />}
          {(s.type === "hero" || s.type === "about") && (
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              {s.image && previews[s.image.path] ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview or signed URL
                <img src={previews[s.image.path]} alt="" className="h-14 w-20 rounded-xl object-cover" />
              ) : (
                <span className="flex h-14 w-20 items-center justify-center rounded-xl bg-ground text-muted"><ImagePlus className="h-5 w-5" /></span>
              )}
              <span className="font-semibold text-accent">{s.image ? "Change photo" : "Add a photo"}</span>
              <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const img = await photo(f); if (img) set(i, { image: img }); } }} />
            </label>
          )}
          {s.type === "gallery" && (
            <div className="flex flex-wrap gap-2">
              {s.images.map((im, k) => (
                <button key={im.path} type="button" onClick={() => set(i, { images: s.images.filter((_, n) => n !== k) })} className="group relative" aria-label={`Remove ${im.name}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview or signed URL */}
                  {previews[im.path] ? <img src={previews[im.path]} alt="" className="h-16 w-16 rounded-xl object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-ground text-xs">{im.name}</span>}
                  <span className="absolute inset-0 hidden items-center justify-center rounded-xl bg-black/50 text-white group-hover:flex"><Trash2 className="h-4 w-4" /></span>
                </button>
              ))}
              <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line text-muted hover:border-accent hover:text-accent">
                <Plus className="h-5 w-5" />
                <input type="file" accept="image/*" multiple className="sr-only" onChange={async (e) => { const added: Img[] = []; for (const f of Array.from(e.target.files ?? []).slice(0, 24 - s.images.length)) { const img = await photo(f); if (img) added.push(img); } set(i, { images: [...s.images, ...added] }); }} />
              </label>
            </div>
          )}
          {s.type === "reviews" && (
            <div className="space-y-2">
              {s.quotes.map((q, k) => (
                <div key={k} className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                  <input className={field} value={q.text} onChange={(e) => set(i, { quotes: s.quotes.map((x, n) => (n === k ? { ...x, text: e.target.value } : x)) })} placeholder="What they said" aria-label="Review" />
                  <input className={field} value={q.name} onChange={(e) => set(i, { quotes: s.quotes.map((x, n) => (n === k ? { ...x, name: e.target.value } : x)) })} placeholder="Name" aria-label="Name" />
                </div>
              ))}
              {s.quotes.length < 12 && <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => set(i, { quotes: [...s.quotes, { text: "", name: "" }] })}>+ Add a review</button>}
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto py-2" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add a section">
          <option value="">Add a section…</option>
          {ADD.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
        </select>
        <button type="button" className="btn-ghost px-4 py-2" disabled={!adding} onClick={() => { const a = ADD.find((x) => x.type === adding); if (a) setSections((x) => [...x, a.make(newId(a.type))]); setAdding(""); }}>
          <Plus className="h-4 w-4" /> Add
        </button>
        <button type="button" className="btn-primary ml-auto" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save website"}</button>
      </div>
      {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.bad ? "bg-red-50 text-red-800" : "bg-accent-tint text-accent"}`}>{msg.text}</p>}
    </div>
  );
}
