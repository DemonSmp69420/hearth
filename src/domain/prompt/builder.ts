import type { CharacterCard, Message, Persona } from '../types';
import { estimator } from '../tokens/estimator';
import { expandMacros, type MacroContext } from './macros';

export type BlockId =
  | 'system'
  | 'character'
  | 'group'
  | 'persona'
  | 'memory'
  | 'lore'
  | 'ledger'
  | 'scene'
  | 'summary'
  | 'example'
  | 'history'
  | 'phi'
  | 'entry'
  | 'entryDepth';

/** ledger + scene blocks arrive with M3. */
export interface PromptBlock {
  id: BlockId;
  label: string;
  content: string;
  tokens: number;
  /** Never-trim blocks (spec §6.5): system, character, persona, memory, phi. */
  protected: boolean;
  /** For the history block: how many messages ended up included. */
  messageCount?: number;
}

export interface TrimRecord {
  target: string;
  reason: string;
  tokens: number;
}

export interface MemoryFact {
  id: string;
  text: string;
  importance: number;
}

export interface FiredLore {
  id: string;
  title: string;
  content: string;
  priority: number;
  tokens?: number;
}

export interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'narrator';
  content: string;
  /** M5.2: which group member (or lead) spoke this line, when known. */
  speaker_character_id?: string | null;
}

/**
 * One advanced prompt entry (F17 / §8.6). Timing is evaluated against the
 * active-path length so effects stay branch-correct.
 */
export interface PromptEntryLike {
  id: string;
  name: string;
  content: string;
  role: 'system' | 'user' | 'assistant';
  locked: boolean;
  /** 'before:<block>' | 'after:<block>' | 'depth'. */
  anchor: string;
  /** Used when anchor === 'depth': N messages from the end of history. */
  depth: number | null;
  timing: 'always' | 'once' | 'every_n';
  period: number;
  phase: number;
  /** Content over its own budget is dropped with a trim record. */
  tokenBudget: number | null;
  trimPriority: number;
}

export interface BuildInput {
  character: CharacterCard;
  persona: Persona | null;
  /** The active named prompt (D-025) — replaces the default intro. */
  activePromptContent: string | null;
  memoryItems: MemoryFact[];
  firedLore: FiredLore[];
  summary: string | null;
  /** Visible active-path history, oldest first. */
  history: HistoryMessage[];
  /** Post-history instructions from the card (imported decks may carry them). */
  postHistory: string | null;
  /** Pre-rendered ledger block (open threads; §9.4) — protected, hard-capped upstream. */
  ledgerBlock: string | null;
  /** Pre-rendered scene-state line (§12) — protected, tiny. */
  sceneBlock: string | null;
  /** M5.2 group chats: cast roster + speaker instruction — protected. */
  groupBlock?: string | null;
  /** Advanced prompt entries already scope-filtered (global + character + chat). */
  promptEntries?: PromptEntryLike[];
  contextTokens: number;
  maxTokens: number;
  now?: Date;
}

export interface BuiltPrompt {
  blocks: PromptBlock[];
  /** Final payload: one system message (joined blocks) + role-mapped history. */
  wire: { role: 'system' | 'user' | 'assistant'; content: string }[];
  trimLog: TrimRecord[];
  totalTokens: number;
  macroCtx: MacroContext;
}

const PER_MESSAGE_OVERHEAD = 4;

/**
 * The §6.5 pipeline: fixed block order, per-block content, and a documented
 * trim ladder — oldest history → example dialogue → lore (priority asc) →
 * summary. Protected blocks (system/character/persona/memory/phi) are never
 * dropped. Pure and fully logged so the Inspector can explain every token.
 */
export function buildPrompt(input: BuildInput): BuiltPrompt {
  const macroCtx: MacroContext = {
    userName: input.persona?.name ?? 'User',
    charName: input.character.name,
    lastMessage: [...input.history].reverse().find((m) => m.role === 'user')?.content ?? '',
    now: input.now,
  };

  const intro = expandMacros(
    input.activePromptContent?.trim() ||
      `You are ${input.character.name} in a roleplay. Stay in character and keep responses immersive.`,
    macroCtx,
  );
  const charBlock = [
    input.character.description,
    input.character.personality && `Personality: ${expandMacros(input.character.personality, macroCtx)}`,
    input.character.scenario && `Scenario: ${expandMacros(input.character.scenario, macroCtx)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const personaText = input.persona
    ? [input.persona.appearance, input.persona.personality, input.persona.backstory, input.persona.preferences]
        .filter(Boolean)
        .join('\n')
    : '';
  const personaBlock = personaText
    ? `The user plays ${expandMacros('{{user}}', macroCtx)}:\n${expandMacros(personaText, macroCtx)}`
    : '';
  const memoryBlock = input.memoryItems.map((m) => expandMacros(m.text, macroCtx).trim()).filter(Boolean).join('\n');
  const loreBlock = input.firedLore
    .map((e) => `[${e.title}] ${expandMacros(e.content, macroCtx).trim()}`)
    .filter(Boolean)
    .join('\n');
  const summaryBlock = input.summary ? expandMacros(input.summary, macroCtx).trim() : '';
  const ledgerBlock = input.ledgerBlock?.trim() ?? '';
  const sceneBlock = input.sceneBlock?.trim() ?? '';
  const groupBlock = input.groupBlock?.trim() ?? '';
  const exampleBlock = expandMacros(input.character.example_dialogue, macroCtx).trim();
  const phiBlock = input.postHistory ? expandMacros(input.postHistory, macroCtx).trim() : '';

  const mk = (
    id: BlockId,
    label: string,
    content: string,
    defProtected: boolean,
    messageCount?: number,
  ): PromptBlock => ({
    id,
    label,
    content,
    tokens: content ? estimator.estimate(content) : 0,
    protected: defProtected,
    ...(messageCount !== undefined ? { messageCount } : {}),
  });

  const systemBlocks: PromptBlock[] = [
    mk('system', 'System prompt', intro, true),
    mk('character', 'Character card', charBlock, true),
    mk('group', 'Group cast', groupBlock, true),
    mk('persona', `Persona (${macroCtx.userName})`, personaBlock, true),
    mk('memory', 'Pinned memory', memoryBlock, true),
    mk('lore', 'Triggered lore', loreBlock, false),
    mk('ledger', 'Story ledger', ledgerBlock, true),
    mk('scene', 'Scene state', sceneBlock, true),
    mk('summary', 'Rolling summary', summaryBlock, false),
    mk('example', 'Example dialogue', exampleBlock, false),
    mk('phi', 'Post-history instruction', phiBlock, true),
  ].filter((b) => b.content.length > 0);

  const historyMessages = input.history.map((m) => ({
    id: m.id,
    wireRole: (m.role === 'narrator' ? 'system' : m.role) as 'system' | 'user' | 'assistant',
    content: expandMacros(m.content, macroCtx),
  }));

  const systemTokens = systemBlocks.reduce((sum, b) => sum + b.tokens, 0);
  const trimLog: TrimRecord[] = [];

  // ---- Advanced prompt entries (F17 / §8.6) ----
  // Timing runs against the active-path length, so "every N turns" stays
  // correct when the user switches branches. Over-budget content is dropped
  // up front; unlocked entries join the trim ladder (locked never drop).
  const turn = input.history.length;
  const evaluated = (input.promptEntries ?? [])
    .filter((e) => {
      if (e.timing === 'always') return true;
      if (e.timing === 'once') return turn === e.phase;
      const period = Math.max(1, e.period);
      return (turn - e.phase) % period === 0;
    })
    .map((e) => {
      const content = expandMacros(e.content, macroCtx).trim();
      return { e, content, tokens: estimator.estimate(content) };
    })
    .filter((x) => {
      if (x.content.length === 0) return false;
      if (x.e.tokenBudget !== null && x.e.tokenBudget > 0 && x.tokens > x.e.tokenBudget) {
        trimLog.push({
          target: `entry: ${x.e.name}`,
          reason: `over its own token budget (${x.e.tokenBudget})`,
          tokens: x.tokens,
        });
        return false;
      }
      return true;
    });
  const anchoredEntries = evaluated.filter((x) => x.e.anchor !== 'depth');
  const depthEntries = evaluated.filter((x) => x.e.anchor === 'depth');
  const droppedEntries = new Set<string>();
  const keptEntryTokens = () =>
    evaluated.filter((x) => !droppedEntries.has(x.e.id)).reduce((s, x) => s + x.tokens, 0);
  // Only locked entries are hard requirements; unlocked ones can trim.
  const lockedEntryTokens = evaluated.filter((x) => x.e.locked).reduce((s, x) => s + x.tokens, 0);
  const protectedTokens = systemTokens + lockedEntryTokens;

  // ---- Budget: what fits? ----
  const budget = input.contextTokens > 0 ? input.contextTokens - input.maxTokens : Number.POSITIVE_INFINITY;

  // Per-item costs for history and trimmable blocks.
  const historyCosts = historyMessages.map((m) => ({
    msg: m,
    tokens: estimator.estimate(m.content) + PER_MESSAGE_OVERHEAD,
  }));

  const loreItems = input.firedLore
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .map((e) => ({
      lore: e,
      tokens: estimator.estimate(`[${e.title}] ${e.content}`),
    }));
  const loreByTrimOrder = [...loreItems].reverse(); // lowest priority first
  const exampleTokens = exampleBlock ? estimator.estimate(exampleBlock) : 0;
  const summaryTokens = summaryBlock ? estimator.estimate(summaryBlock) : 0;

  if (Number.isFinite(budget) && protectedTokens > budget) {
    throw new Error(
      `Protected prompt blocks (${protectedTokens} tok) exceed the context limit (${budget} tok). Raise the context limit.`,
    );
  }

  // Suffix sums over history costs: suffix[i] = cost of messages i..end.
  // Makes the trim walk O(n) total instead of O(n²) (M6.1 — a 10k-message
  // chat previously spent 2.8s re-summing the kept suffix on every drop).
  const suffix = new Array<number>(historyCosts.length + 1);
  suffix[historyCosts.length] = 0;
  for (let i = historyCosts.length - 1; i >= 0; i--) {
    suffix[i] = historyCosts[i]!.tokens + suffix[i + 1]!;
  }

  let loreRemaining = loreItems.length;
  let exampleDropped = false;
  let summaryDropped = false;
  const loreKeptSum = () => loreItems.slice(0, loreRemaining).reduce((s, i) => s + i.tokens, 0);
  const trimmableTokens = () =>
    keptEntryTokens() + loreKeptSum() + (exampleDropped ? 0 : exampleTokens) + (summaryDropped ? 0 : summaryTokens);

  // Walk history oldest→newest, dropping until the remainder fits with room
  // for the still-included trimmable blocks. Entry/lore/example/summary costs
  // are constants during this phase, so the stop point is a single scan.
  let firstKept = 0;
  if (Number.isFinite(budget)) {
    const room1 = budget - systemTokens - trimmableTokens();
    while (firstKept < historyCosts.length && suffix[firstKept]! > room1) firstKept++;
  }

  // Still over (history exhausted or room1 < 0)? Trim blocks in the §6.5 ladder.
  while (
    Number.isFinite(budget) &&
    systemTokens + trimmableTokens() + suffix[firstKept]! > budget
  ) {
    if (loreRemaining > 0) {
      loreRemaining--;
      const dropped = loreByTrimOrder[loreItems.length - 1 - loreRemaining];
      if (dropped) {
        trimLog.push({ target: `lore: ${dropped.lore.title}`, reason: 'over budget (low priority first)', tokens: dropped.tokens });
      }
      continue;
    }
    if (!exampleDropped) {
      exampleDropped = true;
      trimLog.push({ target: 'example dialogue', reason: 'over budget', tokens: exampleTokens });
      continue;
    }
    // Unlocked advanced entries: lowest trim priority first (locked never drop).
    const entryCandidate = evaluated
      .filter((x) => !x.e.locked && !droppedEntries.has(x.e.id))
      .sort((a, b) => a.e.trimPriority - b.e.trimPriority)[0];
    if (entryCandidate) {
      droppedEntries.add(entryCandidate.e.id);
      trimLog.push({
        target: `entry: ${entryCandidate.e.name}`,
        reason: 'over budget (low trim priority first)',
        tokens: entryCandidate.tokens,
      });
      continue;
    }
    if (!summaryDropped) {
      summaryDropped = true;
      trimLog.push({ target: 'rolling summary', reason: 'over budget (regenerate shorter to re-fit)', tokens: summaryTokens });
      continue;
    }
    break; // nothing left to trim — protected blocks alone overflowed
  }

  if (firstKept > 0) {
    trimLog.unshift({
      target: `${firstKept} oldest history message${firstKept === 1 ? '' : 's'}`,
      reason: 'context limit (oldest first)',
      tokens: historyCosts.slice(0, firstKept).reduce((s, h) => s + h.tokens, 0),
    });
  }

  const keptHistory = historyCosts.slice(firstKept);
  const includedLore = loreItems.slice(0, loreRemaining);
  const loreContent = includedLore.map((i) => `[${i.lore.title}] ${i.lore.content}`).join('\n');
  const blocks: PromptBlock[] = systemBlocks
    .filter((b) => b.id !== 'lore' || loreRemaining > 0)
    .map((b) => {
      if (b.id === 'lore') {
        return { ...b, content: loreContent, tokens: loreContent ? estimator.estimate(loreContent) : 0 };
      }
      if (b.id === 'example' && exampleDropped) return { ...b, content: '', tokens: 0 };
      if (b.id === 'summary' && summaryDropped) return { ...b, content: '', tokens: 0 };
      return b;
    });
  blocks.push(
    mk(
      'history',
      'Recent history',
      keptHistory.map((h) => h.msg.content).join('\n'),
      false,
      keptHistory.length,
    ),
  );

  // Splice anchored entries into the block list at their anchor position
  // (input order = user's drag order). 'before/after:history' → end.
  const historyIdx = blocks.findIndex((b) => b.id === 'history');
  for (const x of anchoredEntries) {
    if (droppedEntries.has(x.e.id)) continue;
    const entryBlock = mk('entry', x.e.name, x.content, x.e.locked);
    const [side, target = 'history'] = x.e.anchor.split(':');
    let at = historyIdx < 0 ? blocks.length : historyIdx;
    if (target !== 'history') {
      const idx = blocks.findIndex((b) => b.id === target);
      if (idx >= 0) at = side === 'after' ? idx + 1 : idx;
    }
    blocks.splice(at, 0, entryBlock);
  }
  // Depth entries ride in the wire, not the system message — display-only
  // blocks keep the Inspector honest about them.
  for (const x of depthEntries) {
    if (droppedEntries.has(x.e.id)) continue;
    blocks.push({ ...mk('entryDepth', `${x.e.name} (depth ${x.e.depth ?? 0})`, x.content, x.e.locked) });
  }

  const systemContent = blocks
    .filter((b) => b.id !== 'history' && b.id !== 'entryDepth')
    .map((b) => b.content)
    .filter(Boolean)
    .join('\n\n');

  const wire = [
    { role: 'system' as const, content: systemContent },
    ...keptHistory.map((h) => ({ role: h.msg.wireRole, content: h.msg.content })),
  ];
  // Depth insertion: deepest first so indexes stay stable. depth 0 = after
  // the very last message (author's-note position).
  for (const x of [...depthEntries].sort((a, b) => (b.e.depth ?? 0) - (a.e.depth ?? 0))) {
    if (droppedEntries.has(x.e.id)) continue;
    const depth = Math.max(0, x.e.depth ?? 0);
    const at = Math.max(1, wire.length - depth);
    wire.splice(at, 0, { role: x.e.role, content: x.content });
  }
  const totalTokens = blocks.reduce((sum, b) => sum + b.tokens, 0);

  return {
    blocks,
    wire,
    trimLog,
    totalTokens,
    macroCtx,
  };
}

/** Convenience: visible active-path history from a message snapshot. */
export function visibleHistory(messages: Message[], leafId: string | null): HistoryMessage[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const chain: Message[] = [];
  const seen = new Set<string>();
  let cursor = leafId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    if (node.deleted_at === null && !node.hidden) chain.push(node);
    cursor = node.parent_id;
  }
  return chain
    .reverse()
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'narrator',
      speaker_character_id: m.speaker_character_id,
      content: m.content,
    }));
}
