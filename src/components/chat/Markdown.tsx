import { Fragment, type ReactNode } from "react";

/**
 * The bit of markdown assistant replies use: paragraphs, bullet and numbered lists, **bold**,
 * *italic*, `code` and [links](https://…). Built as React elements, never as HTML, so a reply
 * can't inject markup. WhatsApp/Telegram can later render the same text their own way.
 */
export function Markdown({ text, className = "", ...rest }: { text: string; className?: string; "data-role"?: string }) {
  return <div {...rest} className={`space-y-2 ${className}`}>{blocks(text)}</div>;
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] } | { kind: "h"; text: string };

function parse(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    const last = out.at(-1);
    if (!line.trim()) out.push({ kind: "p", lines: [] });
    else if (head) out.push({ kind: "h", text: head[1] });
    else if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else out.push({ kind: "ul", items: [bullet[1]] });
    } else if (num) {
      if (last?.kind === "ol") last.items.push(num[1]);
      else out.push({ kind: "ol", items: [num[1]] });
    }
    else if (last?.kind === "p") last.lines.push(line);
    else out.push({ kind: "p", lines: [line] });
  }
  return out.filter((b) => b.kind !== "p" || b.lines.length);
}

function blocks(text: string): ReactNode[] {
  return parse(text).map((b, i) => {
    if (b.kind === "h") return <p key={i} className="font-semibold">{inline(b.text)}</p>;
    if (b.kind === "p") return <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
    const List = b.kind === "ul" ? "ul" : "ol";
    return (
      <List key={i} className={`space-y-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"}`}>
        {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
      </List>
    );
  });
}

const TOKEN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

export function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > at) out.push(s.slice(at, m.index));
    const t = m[0];
    const k = `${m.index}`;
    if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={k} className="font-semibold">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-card px-1 py-0.5 text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\((.+)\)$/.exec(t)!;
      out.push(<a key={k} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2">{label}</a>);
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    at = m.index + t.length;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}
