import type { CharacterCard, Message, Persona } from '../../domain/types';
import { expandMacros, type MacroContext } from '../../domain/prompt/macros';
import { activePath } from '../../domain/tree/tree';
import { estimator } from '../../domain/tokens/estimator';

export interface WireMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AssembleArgs {
  character: CharacterCard;
  persona: Persona | null;
  messages: Message[];
  leafId: string | null;
  now?: Date;
  /** The active named prompt's content (replaces the default intro; D-025). */
  systemOverride?: string | null;
  /** Per-chat context budget in tokens; oldest history is trimmed to fit. */
  contextTokens?: number;
  /** Reserved space for the reply, subtracted from the history budget. */
  maxTokens?: number;
}

export interface AssembledPrompt {
  wire: WireMessage[];
  macroCtx: MacroContext;
  /** How many history messages were trimmed by the context budget. */
  droppedHistory: number;
}

/**
 * M1 assembly — the full 12-block PromptBuilder + TokenBudgeter lands in M2.
 * Shape already mirrors §6.5: system (intro + card + persona + custom
 * entries + post-history) → history, with macro expansion before estimation
 * and an optional per-chat context budget.
 */
export function assemblePrompt(args: AssembleArgs): AssembledPrompt {
  const path = activePath(args.messages, args.leafId).filter((m) => !m.hidden);
  const macroCtx: MacroContext = {
    userName: args.persona?.name ?? 'User',
    charName: args.character.name,
    lastMessage: [...path].reverse().find((m) => m.role === 'user')?.content ?? '',
    now: args.now,
  };

  const intro = expandMacros(
    args.systemOverride?.trim() ||
      `You are ${args.character.name} in a roleplay. Stay in character and keep responses immersive.`,
    macroCtx,
  );

  const charBlock = [
    args.character.description,
    args.character.personality && `Personality: ${args.character.personality}`,
    args.character.scenario && `Scenario: ${args.character.scenario}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const personaBlock = args.persona
    ? [
        args.persona.appearance,
        args.persona.personality,
        args.persona.backstory,
        args.persona.preferences,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const customBlock = '';

  const systemContent = [
    intro,
    charBlock,
    personaBlock &&
      `The user plays ${expandMacros('{{user}}', macroCtx)}:\n${expandMacros(personaBlock, macroCtx)}`,
    customBlock,
    args.character.post_history_instructions &&
      expandMacros(args.character.post_history_instructions, macroCtx),
  ]
    .filter(Boolean)
    .join('\n\n');

  const system: WireMessage = { role: 'system', content: systemContent };
  const history: WireMessage[] = [];
  for (const m of path) {
    if (m.role === 'system') continue;
    const role = m.role === 'narrator' ? 'system' : m.role;
    history.push({ role, content: expandMacros(m.content, macroCtx) });
  }

  // Context budget: newest-first fill, always keeping at least the last message.
  let droppedHistory = 0;
  let kept = history;
  const budget = args.contextTokens ?? 0;
  if (budget > 0) {
    let remaining = budget - estimator.estimate(system.content) - (args.maxTokens ?? 0);
    const keptReversed: WireMessage[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i]!;
      const cost = estimator.estimate(msg.content) + 4;
      if (remaining - cost < 0 && keptReversed.length > 0) {
        droppedHistory = i + 1;
        break;
      }
      remaining -= cost;
      keptReversed.push(msg);
    }
    if (keptReversed.length < history.length && droppedHistory === 0 && history.length > 0) {
      droppedHistory = history.length - keptReversed.length;
    }
    kept = keptReversed.reverse();
  }

  return { wire: [system, ...kept], macroCtx, droppedHistory };
}
