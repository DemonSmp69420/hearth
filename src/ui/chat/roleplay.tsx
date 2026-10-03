import type { ReactNode } from 'react';

/**
 * Roleplay-aware inline formatting (spec §6.4), safe by construction: input
 * text becomes React nodes — no HTML string is ever injected.
 * `*actions*` → em · `**bold**` → strong · "dialogue" / “dialogue” →
 * accent span · (OOC …) → dim span · `code` → code.
 */
const INLINE = new RegExp(
  [
    '(`[^`\\n]+`)', // code
    '(\\*\\*[^*\\n]+\\*\\*)', // bold
    '(\\*[^*\\n]+\\*)', // italic
    '("[^"\\n]+")', // straight quotes
    '(“[^”\\n]+”)', // curly quotes
    '(\\((?:ooc|OOC)[^)\\n]*\\))', // OOC parens
  ].join('|'),
  'g',
);

export function renderRoleplay(content: string): ReactNode[] {
  const out: ReactNode[] = [];
  const paragraphs = content.split(/\n{2,}/);
  paragraphs.forEach((para, pi) => {
    const nodes: ReactNode[] = [];
    para.split('\n').forEach((line, li) => {
      if (li > 0) nodes.push(<br key={`br-${li}`} />);
      nodes.push(...renderInline(line, `${pi}-${li}`));
    });
    out.push(<p key={pi}>{nodes}</p>);
  });
  return out;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const match of text.matchAll(INLINE)) {
    const idx = match.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const [full, code, bold, italic, quoteS, quoteC, ooc] = match;
    const key = `${keyPrefix}-${k++}`;
    if (code) nodes.push(<code key={key}>{code.slice(1, -1)}</code>);
    else if (bold) nodes.push(<strong key={key}>{bold.slice(2, -2)}</strong>);
    else if (italic) nodes.push(<em key={key} className="rp-action">{italic.slice(1, -1)}</em>);
    else if (quoteS) nodes.push(<span key={key} className="rp-dialogue">{quoteS}</span>);
    else if (quoteC) nodes.push(<span key={key} className="rp-dialogue">{quoteC}</span>);
    else if (ooc) nodes.push(<span key={key} className="rp-ooc">{ooc}</span>);
    last = idx + full.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
