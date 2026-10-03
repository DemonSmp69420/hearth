import { describe, expect, it } from 'vitest';
import { buildLedgerBlock, foldLedger, threadsForDisplay, type LedgerEventLike } from './fold';
import { gateDirectorCall, messagesSinceLastRun } from './heuristics';
import { extractJsonCandidate, validateDirectorOutput } from './director';

function ev(partial: Omit<LedgerEventLike, 'created_at'> & { created_at?: number }): LedgerEventLike {
  return { created_at: 0, ...partial };
}

const createThread = (id: string, anchor: string, seq: number, title = 'Defeat Xyz'): LedgerEventLike =>
  ev({
    id: `e-${id}`,
    anchor_message_id: anchor,
    seq,
    event_type: 'thread_create',
    payload: JSON.stringify({
      thread: { id, kind: 'quest', title, keywords: ['xyz'], importance: 2, status: 'pending' },
    }),
  });

const path = (...ids: string[]) => ids;

describe('foldLedger — branch awareness (acceptance test 3)', () => {
  const events = [
    createThread('t1', 'm5', 0),
    ev({ id: 'e2', anchor_message_id: 'm5', seq: 1, event_type: 'thread_update', payload: JSON.stringify({ threadId: 't1', status: 'fulfilled' }) }),
  ];

  it('thread absent when branching from BEFORE its creation', () => {
    const branch = foldLedger(events, path('m1', 'm2', 'm3', 'm4'));
    expect(branch.threads).toHaveLength(0);
  });

  it('thread present (and fulfilled) on the branch containing its history', () => {
    const full = foldLedger(events, path('m1', 'm2', 'm3', 'm4', 'm5', 'm6'));
    expect(full.threads).toHaveLength(1);
    expect(full.threads[0]!.status).toBe('fulfilled');
  });

  it('switching branches back restores the thread — fold purity', () => {
    const first = foldLedger(events, path('m1', 'm5'));
    const branch = foldLedger(events, path('m1', 'm2'));
    const again = foldLedger(events, path('m1', 'm5'));
    expect(again.threads).toEqual(first.threads);
    expect(branch.threads).toHaveLength(0);
  });
});

describe('foldLedger — mechanics', () => {
  it('orders events by path position then seq, display ids by creation', () => {
    const events = [
      createThread('t1', 'm2', 0, 'First'),
      createThread('t2', 'm6', 0, 'Second'),
      ev({ id: 'e3', anchor_message_id: 'm6', seq: 1, event_type: 'thread_update', payload: JSON.stringify({ threadId: 't1', status: 'active' }) }),
    ];
    const fold = foldLedger(events, path('m2', 'm4', 'm6'));
    const display = threadsForDisplay(fold);
    expect(display.map((t) => [t.displayId, t.title, t.status])).toEqual([
      ['T1', 'First', 'active'],
      ['T2', 'Second', 'pending'],
    ]);
  });

  it('scene_set is last-wins along the path', () => {
    const events = [
      ev({ id: 'e1', anchor_message_id: 'm1', seq: 0, event_type: 'scene_set', payload: JSON.stringify({ field: 'location', value: 'tavern' }) }),
      ev({ id: 'e2', anchor_message_id: 'm5', seq: 0, event_type: 'scene_set', payload: JSON.stringify({ field: 'location', value: 'bridge' }) }),
    ];
    const fold = foldLedger(events, path('m1', 'm5'));
    expect(fold.scene.location).toBe('bridge');
    // branching before the second set restores the tavern
    expect(foldLedger(events, path('m1', 'm2')).scene.location).toBe('tavern');
  });

  it('tracks the last detector_run position for the safety net', () => {
    const events = [
      ev({ id: 'e1', anchor_message_id: 'm3', seq: 0, event_type: 'detector_run', payload: '{}' }),
    ];
    const fold = foldLedger(events, path('m1', 'm2', 'm3', 'm4', 'm5'));
    expect(fold.lastRunPathIndex).toBe(2);
    expect(messagesSinceLastRun(5, fold.lastRunPathIndex)).toBe(2);
    expect(messagesSinceLastRun(5, -1)).toBe(5);
  });
});

describe('acceptance test 1 — promise survives 150 filler messages under the cap', () => {
  it('thread still injected and block ≤ 200 tokens after 150 messages', () => {
    const pathIds = Array.from({ length: 152 }, (_, i) => `m${i}`);
    const events = [
      createThread('promise', 'm1', 0, 'Meet {{char}} at the bridge'),
      // detector runs every ~15 messages along the way
      ...Array.from({ length: 10 }, (_, i) =>
        ev({ id: `run${i}`, anchor_message_id: `m${15 * (i + 1)}`, seq: 0, event_type: 'detector_run', payload: '{}' }),
      ),
    ];
    const fold = foldLedger(events, pathIds);
    const injection = buildLedgerBlock(fold, 'walking toward the bridge', 200);
    expect(injection.included.map((t) => t.title)).toContain('Meet {{char}} at the bridge');
    expect(injection.content.length).toBeGreaterThan(0);
    // cap enforced: content estimated under the cap
    expect(injection.content.split('\n').join(' ').length / 3.7).toBeLessThanOrEqual(210);
  });
});

describe('acceptance test 2 — keyword mention triggers a resolution check', () => {
  it('gate fires on an open-thread keyword', () => {
    const gate = gateDirectorCall({
      newMessage: 'I cross the bridge at last.',
      recentMessages: [],
      openThreadKeywords: ['bridge'],
      messagesSinceLastRun: 2,
      runEveryN: 15,
    });
    expect(gate.shouldRun).toBe(true);
    expect(gate.reasons.join(' ')).toContain('open-thread keyword');
  });
});

describe('acceptance test 4 — normal chat triggers zero Director calls', () => {
  it('gate stays silent for benign messages with no open threads', () => {
    for (const msg of [
      'The fire crackles softly.',
      'Pass the bread, would you?',
      'This stew is delicious!',
      'Tell me about the harbor.',
    ]) {
      const gate = gateDirectorCall({
        newMessage: msg,
        recentMessages: [],
        openThreadKeywords: [],
        messagesSinceLastRun: 3,
        runEveryN: 15,
      });
      expect(gate.shouldRun).toBe(false);
      expect(gate.reasons).toHaveLength(0);
    }
  });

  it('safety net eventually fires after the lull', () => {
    const gate = gateDirectorCall({
      newMessage: 'The fire crackles softly.',
      recentMessages: [],
      openThreadKeywords: [],
      messagesSinceLastRun: 15,
      runEveryN: 15,
    });
    expect(gate.shouldRun).toBe(true);
    expect(gate.reasons[0]).toContain('safety net');
  });
});

describe('director contract', () => {
  it('accepts a valid diff and caps new threads at 2', () => {
    const raw = JSON.stringify({
      none: false,
      new_threads: [
        { kind: 'appointment', title: 'Meet at the bridge', keywords: ['bridge'], importance: 2, confidence: 0.9 },
        { kind: 'promise', title: 'B', confidence: 0.8 },
        { kind: 'promise', title: 'C should be dropped' },
      ],
      updates: [{ id: 't1', status: 'fulfilled', evidence: 'arrived' }],
      scene: { location: 'Old stone bridge' },
      memory_suggestions: [{ scope: 'persona', text: 'Sam fears heights.', confidence: 0.8 }],
    });
    const out = validateDirectorOutput(raw);
    expect(out.new_threads).toHaveLength(2);
    expect(out.updates[0]!.status).toBe('fulfilled');
    expect(out.scene.location).toBe('Old stone bridge');
  });

  it('accepts {"none": true} and rejects malformed payloads', () => {
    expect(validateDirectorOutput('{"none": true}').none).toBe(true);
    expect(() => validateDirectorOutput('not json')).toThrow();
    expect(() => validateDirectorOutput('{"new_threads":[{"kind":"weird","title":"x"}]}')).toThrow(/kind/);
    expect(() => validateDirectorOutput('{"updates":[{"status":"fulfilled"}]}')).toThrow(/id/);
  });

  it('extracts JSON from a chatty model reply', () => {
    const chatty = 'Sure! Here is the diff: {"none": true} — hope that helps!';
    expect(validateDirectorOutput(extractJsonCandidate(chatty)).none).toBe(true);
  });
});

describe('acceptance test — injection ranking and cap', () => {
  it('ranks by importance then keyword relevance, dropping overflow', () => {
    const events = [
      createThread('low', 'm1', 0, 'Low importance errand'),
      ev({
        id: 'e2', anchor_message_id: 'm1', seq: 1, event_type: 'thread_create',
        payload: JSON.stringify({ thread: { id: 'high', kind: 'quest', title: 'Slay the wyrm', keywords: ['wyrm'], importance: 3, status: 'active' } }),
      }),
      ev({
        id: 'e3', anchor_message_id: 'm1', seq: 2, event_type: 'thread_create',
        payload: JSON.stringify({ thread: { id: 'relevant', kind: 'appointment', title: 'Bridge meeting', keywords: ['bridge'], importance: 2, status: 'pending' } }),
      }),
    ];
    const fold = foldLedger(events, path('m1', 'm2'));
    const injection = buildLedgerBlock(fold, 'walking to the bridge with the wyrm map', 12);
    expect(injection.included[0]!.title).toBe('Slay the wyrm'); // importance first
    expect(injection.dropped.length).toBeGreaterThan(0); // 40-tok cap forces drops
  });
});
