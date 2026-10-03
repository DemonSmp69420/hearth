export interface MacroContext {
  userName: string;
  charName: string;
  /** Raw last message content (pre-expansion), or '' when none. */
  lastMessage: string;
  now?: Date;
  /** Custom per-chat variables (`/setvar name value`, stored in chat settings). */
  vars?: Record<string, string>;
}

/**
 * Macro expansion for all text fields (spec §6.1). Runs before token
 * estimation. Supported: {{user}}/{{char}} plus legacy aliases {user}/<USER>,
 * {{date}}, {{time}}, {{random:a,b,c}}, {{lastMessage}}, {{var:name}}.
 * Unknown macros are left verbatim so typos stay visible.
 */
export function expandMacros(text: string, ctx: MacroContext): string {
  if (!text) return text;
  // Fast path: every macro contains '{' or (legacy <USER>) '<'. Most history
  // messages contain neither — skipping 7 regex scans keeps 10k-message
  // assemblies fast (M6.1: this alone was 1.9s via eager Intl calls).
  if (!/[<{]/.test(text)) return text;
  const now = ctx.now ?? new Date();
  const result = text
    .replace(/\{\{user\}\}|\{user\}|<USER>/gi, ctx.userName)
    .replace(/\{\{char\}\}/gi, ctx.charName)
    .replace(/\{\{date\}\}/gi, () => formatDate(now))
    .replace(/\{\{time\}\}/gi, () => formatTime(now))
    .replace(/\{\{lastMessage\}\}/gi, ctx.lastMessage)
    .replace(/\{\{random:([^}]*)\}\}/gi, (_, list: string) => {
      const options = list.split(',').map((s) => s.trim());
      if (options.length === 0) return '';
      return options[Math.floor(Math.random() * options.length)] ?? '';
    });

  const vars = ctx.vars ?? {};
  return result.replace(/\{\{var:([^}]+)\}\}/gi, (_, name: string) => {
    const key = name.trim().toLowerCase();
    return vars[key] ?? `{{var:${name}}}`;
  });
}

// Intl formatters are expensive to construct — cache them process-wide and
// only invoke when a date/time macro is actually present.
let dateFmt: Intl.DateTimeFormat | undefined;
let timeFmt: Intl.DateTimeFormat | undefined;

// Locales pinned for deterministic output (and stable tests).
function formatDate(d: Date): string {
  dateFmt ??= new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return dateFmt.format(d);
}

function formatTime(d: Date): string {
  timeFmt ??= new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  return timeFmt.format(d);
}
