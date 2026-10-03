/**
 * M5.6 output rules (§6.5): ordered find/replace rewrites applied to text
 * going out (AI messages) or coming in (user messages), optionally scoped to
 * one character's output. Pure and unit-tested; invalid regexes are skipped
 * rather than throwing mid-send.
 */
export interface OutputRuleLike {
  find: string;
  replace: string;
  /** Treat `find` as a JavaScript regex instead of a plain substring. */
  regex: boolean;
  direction: 'out' | 'in';
  /** null/undefined = any speaker; otherwise only that character's output. */
  characterId?: string | null;
  enabled: boolean;
}

export function applyRules(
  text: string,
  rules: OutputRuleLike[],
  opts: { direction: 'out' | 'in'; characterId?: string | null },
): string {
  let result = text;
  for (const rule of rules) {
    if (!rule.enabled || rule.direction !== opts.direction) continue;
    if (rule.characterId && rule.characterId !== opts.characterId) continue;
    if (!rule.find) continue;
    if (rule.regex) {
      try {
        result = result.replace(new RegExp(rule.find, 'g'), rule.replace);
      } catch {
        // invalid regex — skip the rule instead of failing the send
      }
    } else {
      result = result.split(rule.find).join(rule.replace);
    }
  }
  return result;
}
