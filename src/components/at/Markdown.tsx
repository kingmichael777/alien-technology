import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-medium text-ink">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-surface-raised px-1 font-mono text-[0.9em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal, safe Markdown: headings, lists, quotes, paragraphs, bold, italic, code. */
export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(<p key={k}>{inline(para.join(" "), k)}</p>);
      para = [];
    }
    if (list.length) {
      const k = `l${blocks.length}`;
      blocks.push(
        <ul key={k} className="list-disc space-y-1 pl-5 marker:text-amber">
          {list.map((li, i) => <li key={i}>{inline(li, `${k}${i}`)}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      const k = `h${blocks.length}`;
      blocks.push(<h3 key={k} className={h[1]!.length === 1 ? "font-serif text-2xl text-ink" : "mono-label pt-2"}>{inline(h[2] ?? "", k)}</h3>);
    } else if (/^[-*]\s+/.test(line)) {
      if (para.length) flush();
      list.push(line.replace(/^[-*]\s+/, ""));
    } else if (line.startsWith("> ")) {
      flush();
      const k = `q${blocks.length}`;
      blocks.push(<blockquote key={k} className="border-l border-amber-line pl-3 text-ink-muted">{inline(line.slice(2), k)}</blockquote>);
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return <div className="space-y-3 text-[15px] leading-relaxed text-ink">{blocks}</div>;
}
