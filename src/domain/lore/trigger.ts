import { estimator } from '../tokens/estimator';
import type { FiredLore } from '../prompt/builder';

export interface LoreEntryLike {
  id: string;
  title: string;
  content: string;
  keywords_primary: string;
  keywords_secondary: string;
  regexes: string;
  constant: number;
  enabled: number;
  priority: number;
  scan_depth: number;
}

function parseKeywords(json: string): string[] {
  try {
    const parsed = JSON.parse(json || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map(String).map((s) => s.toLowerCase().trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function matchesKeyword(haystack: string, keywords: string[]): boolean {
  return keywords.some((k) => haystack.includes(k));
}

/**
 * §8 basic trigger engine: constant entries always fire; keyword entries fire
 * when a primary keyword appears in the last `scan_depth` messages (secondary
 * keywords apply only when no primaries are defined); regexes are tried last.
 * Fired entries are returned highest-priority first with token estimates.
 */
export function fireLore(
  entries: LoreEntryLike[],
  recentMessages: { role: string; content: string }[],
): FiredLore[] {
  const fired: FiredLore[] = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const depth = Math.max(1, entry.scan_depth || 2);
    const haystack = recentMessages
      .slice(-depth)
      .map((m) => m.content.toLowerCase())
      .join('\n');

    if (entry.constant) {
      fired.push({ id: entry.id, title: entry.title, content: entry.content, priority: entry.priority });
      continue;
    }
    const primary = parseKeywords(entry.keywords_primary);
    const secondary = parseKeywords(entry.keywords_secondary);
    const regexes = parseKeywords(entry.regexes);

    let hit = false;
    if (primary.length > 0) {
      hit = matchesKeyword(haystack, primary);
    } else if (secondary.length > 0) {
      hit = matchesKeyword(haystack, secondary);
    }
    if (!hit && regexes.length > 0) {
      hit = regexes.some((pattern) => {
        try {
          return new RegExp(pattern, 'i').test(haystack);
        } catch {
          return false; // user regex errors never break generation
        }
      });
    }
    if (hit) {
      fired.push({ id: entry.id, title: entry.title || 'Lore', content: entry.content, priority: entry.priority });
    }
  }
  return fired
    .sort((a, b) => b.priority - a.priority)
    .map((f) => ({ ...f, tokens: estimator.estimate(`[${f.title}] ${f.content}`) }));
}
