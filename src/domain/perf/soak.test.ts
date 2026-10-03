import { describe, expect, it } from 'vitest';
import { activePath, childrenOf, nextOrd } from '../tree/tree';
import { foldLedger, type LedgerEventLike } from '../ledger/fold';
import { visibleHistory, buildPrompt } from '../prompt/builder';
import type { Message, CharacterCard } from '../types';

/**
 * M6.1 performance soak: a 10,000-message chat must stay snappy on the pure
 * path — tree walk, ledger fold, prompt assembly — which is where branching
 * depth and event count could quietly go quadratic. Budgets are generous
 * (CI machines) but any order-of-magnitude regression trips them.
 */

function character(): CharacterCard {
  return {
    id: 'c1',
    name: 'Serena',
    avatar_asset_id: null,
    avatar_path: null,
    description: 'Keeper.',
    personality: 'Warm',
    scenario: '',
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
  };
}

function bigChat(count: number): { messages: Message[]; events: ReturnType<typeof Object>[] } {
  const messages: Message[] = [];
  let prevId: string | null = null;
  const events: LedgerEventLike[] = [];
  let uuid = 0;
  const id = () => `id-${++uuid}`;
  for (let i = 0; i < count; i++) {
    const mid = id();
    messages.push({
      id: mid,
      chat_id: 'c',
      parent_id: prevId,
      ord: 0,
      role: i % 2 === 0 ? 'user' : 'assistant',
      speaker_character_id: null,
      content: `message ${i} with some story content `.repeat(8),
      status: 'complete',
      model: 'm',
      provider_profile_id: null,
      prompt_tokens: null,
      completion_tokens: null,
      latency_ms: null,
      finish_reason: null,
      hidden: 0,
      pinned: 0,
      bookmarked: 0,
      meta: '{}',
      created_at: i,
      updated_at: i,
      deleted_at: null,
    });
    prevId = mid;
    // a thread created early + detector runs every 15 messages
    if (i === 5) {
      events.push({
        id: id(),
        anchor_message_id: mid,
        seq: events.length,
        event_type: 'thread_create',
        payload: JSON.stringify({
          thread: { id: 't1', kind: 'quest', title: 'Fix the lamp', keywords: ['lamp'], importance: 2, status: 'pending' },
        }),
        created_at: i,
      });
    }
    if (i % 15 === 0) {
      events.push({
        id: id(),
        anchor_message_id: mid,
        seq: events.length,
        event_type: 'detector_run',
        payload: '{}',
        created_at: i,
      });
    }
  }
  return { messages, events };
}

const N = 10_000;
const { messages, events } = bigChat(N);
const leafId = messages[messages.length - 1]!.id;

describe('M6.1 performance soak (10k messages)', () => {
  it('walks the active path in well under 100ms', () => {
    const t0 = performance.now();
    const path = activePath(messages, leafId);
    const dt = performance.now() - t0;
    expect(path).toHaveLength(N);
    expect(dt).toBeLessThan(100);
  });

  it('folds 667+ ledger events along the path in well under 100ms', () => {
    const pathIds = activePath(messages, leafId).map((m) => m.id);
    const t0 = performance.now();
    const fold = foldLedger(events, pathIds);
    const dt = performance.now() - t0;
    expect(fold.threads).toHaveLength(1);
    expect(dt).toBeLessThan(100);
  });

  it('assembles the prompt from a 10k history in well under 250ms', () => {
    const t0 = performance.now();
    const history = visibleHistory(messages, leafId);
    const out = buildPrompt({
      character: character(),
      persona: null,
      activePromptContent: null,
      memoryItems: [],
      firedLore: [],
      summary: null,
      history,
      postHistory: null,
      ledgerBlock: null,
      sceneBlock: null,
      contextTokens: 8192,
      maxTokens: 512,
    });
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(250);
    expect(out.blocks.find((b) => b.id === 'history')?.messageCount).toBeLessThan(1200); // budget applied
    expect(out.trimLog[0]?.target).toContain('oldest history');
  });

  it('sibling/children queries stay linear and cheap', () => {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      childrenOf(messages, messages[i * 90]?.id ?? null);
      nextOrd(messages, messages[i * 90]?.id ?? null);
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(500);
  });
});
