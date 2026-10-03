/**
 * M5.9 consistency guard (§12): zero-token, deterministic scan of a fresh AI
 * reply against pinned memory facts. Flags "subject + negation" patterns as
 * possible contradictions — never auto-acts, only warns. The heuristic is
 * intentionally conservative (needs 2+ matching content words AND a negation
 * cue nearby) so normal replies don't trigger it.
 */
export interface ConsistencyWarning {
  /** The memory fact that may be contradicted. */
  fact: string;
  /** The negation cue found in the reply. */
  cue: string;
  /** 0..1 heuristic confidence — display only. */
  confidence: number;
}

const NEGATION_CUES = [
  'not',
  'never',
  'no longer',
  "isn't",
  "wasn't",
  "doesn't",
  "didn't",
  "can't",
  "cannot",
  "won't",
  "aren't",
  "hasn't",
  "haven't",
];

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'with',
  'that',
  'this',
  'they',
  'them',
  'their',
  'from',
  'for',
  'his',
  'her',
  'she',
  'him',
  'you',
  'your',
  'user',
]);

/** Content words of a fact that must re-appear near a negation to warn. */
function keyTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

export function checkConsistency(input: { reply: string; facts: string[] }): ConsistencyWarning[] {
  const reply = input.reply.toLowerCase();
  if (!reply.trim()) return [];
  const warnings: ConsistencyWarning[] = [];

  for (const fact of input.facts) {
    const tokens = keyTokens(fact);
    if (tokens.length === 0) continue;
    const subject = tokens[0]!;
    const matchedTokens: string[] = [];
    let cue = '';
    for (const token of tokens) {
      let idx = reply.indexOf(token);
      while (idx !== -1) {
        const windowStart = Math.max(0, idx - 48);
        const windowEnd = Math.min(reply.length, idx + token.length + 48);
        const window = reply.slice(windowStart, windowEnd);
        const hit = NEGATION_CUES.find((c) => window.includes(c));
        if (hit) {
          matchedTokens.push(token);
          cue = cue || hit;
          break;
        }
        idx = reply.indexOf(token, idx + token.length);
      }
    }
    const matched = matchedTokens.length;
    // Classic signature: the fact's subject re-appears near a negation.
    // Extra matched content words raise confidence; subject alone still warns.
    if (matched >= 1 && matchedTokens.includes(subject)) {
      warnings.push({
        fact,
        cue,
        confidence:
          matched >= 2 ? Math.min(0.9, 0.6 + (matched - 2) * 0.1) : 0.55,
      });
    }
  }
  return warnings;
}
