import { describe, expect, it } from 'vitest';
import { buildPrompt, visibleHistory, type PromptEntryLike } from './builder';
import type { CharacterCard, Message, Persona } from '../types';

function char(overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    id: 'c1',
    name: 'Serena',
    avatar_asset_id: null,
    avatar_path: null,
    description: 'A lighthouse keeper.',
    personality: 'Warm',
    scenario: 'A stormy night.',
    first_message: '',
    alt_greetings: [],
    example_dialogue: '',
    system_prompt_override: null,
    post_history_instructions: null,
    tags: [],
    creator_notes: null,
    favorite: 0,
    folder_id: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function persona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'p1',
    name: 'Sam',
    pronouns: null,
    role: null,
    appearance: null,
    personality: null,
    backstory: null,
    preferences: null,
    is_default: 0,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function historyOf(count: number, words: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `${i} ${'word '.repeat(words)}`,
  }));
}

const base = {
  character: char(),
  persona: null,
  activePromptContent: null,
  memoryItems: [],
  firedLore: [],
  summary: null,
  history: [],
  postHistory: null,
  ledgerBlock: null,
  sceneBlock: null,
  contextTokens: 0,
  maxTokens: 0,
};

describe('buildPrompt — assembly', () => {
  it('produces one system wire message + history with mapped roles', () => {
    const out = buildPrompt({
      ...base,
      history: [
        { id: 'u1', role: 'user', content: 'hi' },
        { id: 'a1', role: 'assistant', content: 'hello' },
        { id: 'n1', role: 'narrator', content: 'wind howls' },
      ],
    });
    expect(out.wire[0]!.role).toBe('system');
    expect(out.wire[0]!.content).toContain('Serena');
    expect(out.wire.map((w) => w.role)).toEqual(['system', 'user', 'assistant', 'system']);
  });

  it('includes persona and memory blocks in the system payload', () => {
    const out = buildPrompt({
      ...base,
      persona: persona({ role: 'cartographer', backstory: 'mapped old roads' }),
      memoryItems: [{ id: 'mem1', text: 'Sam fears heights.', importance: 2 }],
    });
    expect(out.wire[0]!.content).toContain('Sam');
    expect(out.wire[0]!.content).toContain('mapped old roads');
    expect(out.wire[0]!.content).toContain('Sam fears heights.');
  });

  it('the active named prompt replaces the default intro', () => {
    const out = buildPrompt({ ...base, activePromptContent: 'Custom intro here.' });
    expect(out.wire[0]!.content.startsWith('Custom intro here.')).toBe(true);
    expect(out.wire[0]!.content).not.toContain('Stay in character');
  });

  it('expands macros before estimating', () => {
    const out = buildPrompt({
      ...base,
      persona: persona(),
      character: char({ scenario: 'Meeting {{user}} at dawn.' }),
    });
    expect(out.wire[0]!.content).toContain('Meeting Sam at dawn.');
  });

  it('reports per-block token counts in injection order', () => {
    const out = buildPrompt({
      ...base,
      character: char({ example_dialogue: 'Example: "hello there"' }),
      firedLore: [{ id: 'l1', title: 'Bridge', content: 'Old stone.', priority: 50 }],
    });
    const ids = out.blocks.map((b) => b.id);
    // empty blocks (no persona/memory given) are omitted entirely
    expect(ids).toEqual(['system', 'character', 'lore', 'example', 'history']);
    expect(out.blocks.find((b) => b.id === 'lore')?.tokens).toBeGreaterThan(0);
    expect(out.totalTokens).toBe(out.blocks.reduce((s, b) => s + b.tokens, 0));
  });

  it('renders the group cast block as protected, right after the character card (M5.2)', () => {
    const roster = '[Group scene] One character speaks per turn.';
    const out = buildPrompt({
      ...base,
      persona: persona(),
      groupBlock: roster,
      contextTokens: 0,
    });
    const group = out.blocks.find((b) => b.id === 'group');
    expect(group?.content).toBe(roster);
    expect(group?.protected).toBe(true);
    const ids = out.blocks.map((b) => b.id);
    expect(ids.indexOf('group')).toBe(ids.indexOf('character') + 1);
    expect(out.wire[0]!.content).toContain(roster);
  });

  it('omits the group block when no roster is given (1:1 chats)', () => {
    const out = buildPrompt({ ...base });
    expect(out.blocks.find((b) => b.id === 'group')).toBeUndefined();
  });
});

describe('buildPrompt — trim ladder', () => {
  it('drops oldest history first and logs it', () => {
    const history = historyOf(50, 40);
    const out = buildPrompt({ ...base, history, contextTokens: 1200 });
    expect(out.blocks.find((b) => b.id === 'history')?.messageCount).toBeLessThan(50);
    expect(out.trimLog[0]?.target).toContain('oldest history');
  });

  it('trims lore and example before the summary, protects system/character/persona/memory', () => {
    const longLore = 'An old stone bridge crosses the ravine. '.repeat(6);
    const longSummary = 'Earlier, they met a storm and found a cave. '.repeat(6);
    const longExample = 'Example: "hello there, traveler" '.repeat(6);
    const out = buildPrompt({
      ...base,
      memoryItems: [{ id: 'mem1', text: 'Sam fears heights.', importance: 3 }],
      firedLore: [{ id: 'l1', title: 'The bridge', content: longLore, priority: 50 }],
      summary: longSummary,
      character: char({ example_dialogue: longExample }),
      history: [{ id: 'u1', role: 'user', content: 'hi' }],
      contextTokens: 400,
      maxTokens: 60,
    });
    const sys = out.wire[0]!.content;
    expect(sys).toContain('Sam fears heights.'); // memory: never trimmed
    expect(sys).toContain('lighthouse keeper'); // character: never trimmed
    expect(sys).not.toContain('An old stone bridge'); // lore trimmed first
    expect(sys).not.toContain('Example:'); // example second
    expect(sys).toContain('Earlier, they met a storm'); // summary survives
    const targets = out.trimLog.map((t) => t.target);
    expect(targets.some((t) => t.startsWith('lore:'))).toBe(true);
    expect(targets).toContain('example dialogue');
    expect(targets[0]).toContain('oldest history');
  });

  it('throws a clear error when protected blocks alone exceed the budget', () => {
    const bigMemory = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      text: 'memory '.repeat(50) + String(i),
      importance: 3,
    }));
    expect(() =>
      buildPrompt({ ...base, memoryItems: bigMemory, contextTokens: 600, history: historyOf(2, 3) }),
    ).toThrow(/context limit/);
  });

  it('never trims when contextTokens is 0 (unlimited)', () => {
    const history = historyOf(200, 60);
    const out = buildPrompt({ ...base, history });
    expect(out.blocks.find((b) => b.id === 'history')?.messageCount).toBe(200);
    expect(out.trimLog).toHaveLength(0);
  });
});

describe('buildPrompt — advanced entries (F17)', () => {
  function entry(overrides: Partial<PromptEntryLike> = {}): PromptEntryLike {
    return {
      id: 'e1',
      name: 'Style note',
      content: 'Always answer in rhyme.',
      role: 'system',
      locked: false,
      anchor: 'before:history',
      depth: null,
      timing: 'always',
      period: 1,
      phase: 0,
      tokenBudget: null,
      trimPriority: 50,
      ...overrides,
    };
  }

  it('includes an always entry anchored before history', () => {
    const out = buildPrompt({ ...base, promptEntries: [entry()] });
    const block = out.blocks.find((b) => b.id === 'entry');
    expect(block?.content).toBe('Always answer in rhyme.');
    expect(out.wire[0]?.content).toContain('Always answer in rhyme.');
  });

  it('respects once timing against the active-path length', () => {
    const e = entry({ timing: 'once', phase: 1 });
    expect(buildPrompt({ ...base, history: historyOf(1, 2), promptEntries: [e] }).blocks.find((b) => b.id === 'entry')).toBeDefined();
    expect(
      buildPrompt({ ...base, history: historyOf(2, 2), promptEntries: [e] }).blocks.find((b) => b.id === 'entry'),
    ).toBeUndefined();
  });

  it('fires every_n entries only on matching turns', () => {
    const e = entry({ timing: 'every_n', period: 3, phase: 0 });
    expect(
      buildPrompt({ ...base, history: historyOf(3, 2), promptEntries: [e] }).blocks.find((b) => b.id === 'entry'),
    ).toBeDefined();
    expect(
      buildPrompt({ ...base, history: historyOf(2, 2), promptEntries: [e] }).blocks.find((b) => b.id === 'entry'),
    ).toBeUndefined();
  });

  it('anchors entries after a canonical block', () => {
    const out = buildPrompt({
      ...base,
      activePromptContent: 'Intro line.',
      promptEntries: [entry({ anchor: 'after:system' })],
    });
    const ids = out.blocks.map((b) => b.id);
    expect(ids.indexOf('entry')).toBe(ids.indexOf('system') + 1);
  });

  it('injects depth entries into the wire N messages from the end', () => {
    const out = buildPrompt({
      ...base,
      history: [
        { id: 'u1', role: 'user', content: 'one' },
        { id: 'a1', role: 'assistant', content: 'two' },
        { id: 'u2', role: 'user', content: 'three' },
      ],
      promptEntries: [entry({ anchor: 'depth', depth: 2, role: 'system' })],
    });
    // depth 2 = the entry has exactly two messages after it:
    // wire: [system, u1, ENTRY, a1, u2]
    expect(out.wire).toHaveLength(5);
    expect(out.wire[2]?.content).toBe('Always answer in rhyme.');
    expect(out.wire[3]?.content).toBe('two');
  });

  it('drops unlocked entries by trim priority (locked never drop)', () => {
    const inputs = {
      memoryItems: [{ id: 'm1', text: 'memory '.repeat(60), importance: 3 }],
      history: historyOf(4, 40),
      promptEntries: [
        entry({ id: 'e1', name: 'Low', trimPriority: 10, content: 'low entry' }),
        entry({ id: 'e2', name: 'High', locked: true, content: 'locked entry' }),
      ],
    };
    // Measure an unlimited build, then set the budget so that everything
    // fits except the history and exactly the one unlocked entry.
    const probe = buildPrompt({ ...base, ...inputs });
    const historyTokens = probe.blocks.find((b) => b.id === 'history')!.tokens;
    const out = buildPrompt({
      ...base,
      ...inputs,
      contextTokens: probe.totalTokens - historyTokens - 1,
      maxTokens: 0,
    });
    const sys = out.wire[0]?.content ?? '';
    expect(sys).toContain('locked entry');
    expect(sys).not.toContain('low entry');
    expect(out.trimLog.some((t) => t.target === 'entry: Low')).toBe(true);
  });

  it('trims entries before the rolling summary', () => {
    const inputs = {
      memoryItems: [{ id: 'm1', text: 'memory '.repeat(60), importance: 3 }],
      summary: 'Earlier, they met a storm',
      history: historyOf(4, 40),
      promptEntries: [entry({ id: 'e1', name: 'Low', trimPriority: 10, content: 'low entry' })],
    };
    const probe = buildPrompt({ ...base, ...inputs });
    const historyTokens = probe.blocks.find((b) => b.id === 'history')!.tokens;
    const out = buildPrompt({
      ...base,
      ...inputs,
      contextTokens: probe.totalTokens - historyTokens - 1,
      maxTokens: 0,
    });
    const targets = out.trimLog.map((t) => t.target);
    const entryAt = targets.indexOf('entry: Low');
    const summaryAt = targets.indexOf('rolling summary');
    expect(entryAt).toBeGreaterThanOrEqual(0);
    if (summaryAt >= 0) {
      expect(entryAt).toBeLessThan(summaryAt);
    }
  });

  it('drops an entry that exceeds its own token budget', () => {
    const out = buildPrompt({
      ...base,
      promptEntries: [entry({ content: 'way too long '.repeat(60), tokenBudget: 10 })],
    });
    expect(out.blocks.find((b) => b.id === 'entry')).toBeUndefined();
    expect(out.trimLog.some((t) => t.target === 'entry: Style note')).toBe(true);
  });
});

describe('visibleHistory', () => {
  it('walks the path, skipping hidden/deleted/system messages', () => {
    const msgs = [
      { id: 'g', chat_id: 'c', parent_id: null, ord: 0, role: 'assistant', content: 'greeting', status: 'complete', hidden: 0, pinned: 0, bookmarked: 0, meta: '{}', created_at: 0, updated_at: 0, deleted_at: null },
      { id: 'h', chat_id: 'c', parent_id: 'g', ord: 0, role: 'system', content: 'sys note', status: 'complete', hidden: 0, pinned: 0, bookmarked: 0, meta: '{}', created_at: 0, updated_at: 0, deleted_at: null },
      { id: 'u', chat_id: 'c', parent_id: 'h', ord: 0, role: 'user', content: 'visible', status: 'complete', hidden: 0, pinned: 0, bookmarked: 0, meta: '{}', created_at: 0, updated_at: 0, deleted_at: null },
    ] as unknown as Message[];
    const out = visibleHistory(msgs, 'u');
    expect(out.map((m) => m.id)).toEqual(['g', 'u']);
  });
});
