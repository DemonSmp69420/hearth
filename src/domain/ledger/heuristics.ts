/**
 * Stage 1 of §9.3: the zero-token gate. No trigger ⇒ no Director call, ever
 * (acceptance test 4). Patterns are user-editable regex sources.
 */

export const DEFAULT_PATTERNS: string[] = [
  "\\bi'?ll\\b",
  "\\bi promise\\b",
  "\\bwe should\\b",
  "\\bmeet (me |you )?(at|by|before)\\b",
  "\\byou (must|have to|need to)\\b",
  "\\bi swear\\b",
  "\\byour (mission|task|quest)\\b",
  "\\b(before|by) (dawn|dusk|midnight|morning|tomorrow|sundown)\\b",
  "\\bdon'?t forget\\b",
  "\\bremember to\\b",
  "\\bi owe you\\b",
  "\\byou owe me\\b",
  "\\bwhat about the\\b",
  "\\bwhere is the\\b",
  "\\bdid you (find|bring|get)\\b",
];

export interface GateInput {
  /** The message that just arrived. */
  newMessage: string;
  /** The 1–2 messages before it (already include newMessage if desired). */
  recentMessages: string[];
  /** Keywords of currently open (pending/active) threads. */
  openThreadKeywords: string[];
  /** Visible path messages since the last detector_run (-1 = never run). */
  messagesSinceLastRun: number;
  /** When the lull reaches this, the safety net fires. */
  runEveryN: number;
  /** User-editable regex sources; defaults applied when empty. */
  patterns?: string[];
}

export interface GateResult {
  shouldRun: boolean;
  reasons: string[];
}

export function gateDirectorCall(input: GateInput): GateResult {
  const reasons: string[] = [];
  const patterns = (input.patterns && input.patterns.length > 0 ? input.patterns : DEFAULT_PATTERNS)
    .map((source) => {
      try {
        return new RegExp(source, 'i');
      } catch {
        return null; // a broken user pattern never breaks the chat
      }
    })
    .filter((r): r is RegExp => r !== null);

  const text = [input.newMessage, ...input.recentMessages].join('\n');

  if (patterns.some((re) => re.test(text))) {
    reasons.push('commitment/objective phrase');
  }
  const lower = input.newMessage.toLowerCase();
  if (input.openThreadKeywords.some((k) => k && lower.includes(k.toLowerCase()))) {
    reasons.push('open-thread keyword (possible resolution)');
  }
  if (input.messagesSinceLastRun >= input.runEveryN) {
    reasons.push(`safety net (${input.messagesSinceLastRun} messages since last run)`);
  }

  return { shouldRun: reasons.length > 0, reasons };
}

/** Visible path length minus the last run's position. */
export function messagesSinceLastRun(pathLength: number, lastRunPathIndex: number): number {
  if (lastRunPathIndex < 0) return pathLength;
  return pathLength - 1 - lastRunPathIndex;
}
