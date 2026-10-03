import { describe, expect, it } from 'vitest';
import {
  activePath,
  childrenOf,
  deepestLeaf,
  descendantIds,
  nearestSurvivingAncestor,
  nextOrd,
  siblingsOf,
} from './tree';
import type { Message } from '../types';

function msg(partial: Partial<Message> & { id: string }): Message {
  const base: Message = {
    id: partial.id,
    chat_id: 'c1',
    parent_id: null,
    ord: 0,
    role: 'assistant',
    speaker_character_id: null,
    content: '',
    status: 'complete',
    model: null,
    provider_profile_id: null,
    prompt_tokens: null,
    completion_tokens: null,
    latency_ms: null,
    finish_reason: null,
    hidden: 0,
    pinned: 0,
    bookmarked: 0,
    meta: '{}',
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
  };
  return Object.assign(base, partial);
}

/** root → g → u1 → a1a/a1b (swipes) ; u1 also branches to u2 → a2 */
function fixture(): Message[] {
  return [
    msg({ id: 'g', ord: 0, role: 'assistant', content: 'greeting' }),
    msg({ id: 'u1', parent_id: 'g', ord: 0, role: 'user', content: 'hello' }),
    msg({ id: 'a1a', parent_id: 'u1', ord: 0, content: 'reply A' }),
    msg({ id: 'a1b', parent_id: 'u1', ord: 1, content: 'reply B' }),
    msg({ id: 'u2', parent_id: 'g', ord: 1, role: 'user', content: 'branch opener' }),
    msg({ id: 'a2', parent_id: 'u2', ord: 0, content: 'reply on branch 2' }),
  ];
}

describe('childrenOf', () => {
  it('returns visible children ordered by ord', () => {
    const m = fixture();
    m.find((x) => x.id === 'a1b')!.deleted_at = 5;
    const kids = childrenOf(m, 'u1');
    expect(kids.map((k) => k.id)).toEqual(['a1a']);
  });
});

describe('siblingsOf', () => {
  it('includes swipes and the node itself', () => {
    const m = fixture();
    const a1a = m.find((x) => x.id === 'a1a')!;
    expect(siblingsOf(m, a1a).map((s) => s.id)).toEqual(['a1a', 'a1b']);
  });
});

describe('activePath', () => {
  it('walks leaf to root and returns root-first order', () => {
    const path = activePath(fixture(), 'a1b');
    expect(path.map((p) => p.id)).toEqual(['g', 'u1', 'a1b']);
  });

  it('skips soft-deleted ancestors but keeps the path connected', () => {
    const m = fixture();
    m.find((x) => x.id === 'u1')!.deleted_at = 5;
    const path = activePath(m, 'a1b');
    expect(path.map((p) => p.id)).toEqual(['g', 'a1b']);
  });

  it('handles null leaf and unknown ids', () => {
    expect(activePath(fixture(), null)).toEqual([]);
    expect(activePath(fixture(), 'nope')).toEqual([]);
  });

  it('survives a corrupted cyclic store without hanging', () => {
    const m = fixture();
    const a = m.find((x) => x.id === 'a1a')!;
    const b = m.find((x) => x.id === 'a1b')!;
    a.parent_id = 'a1b'; // manufactured cycle
    b.parent_id = 'a1a';
    expect(activePath(m, 'a1a').length).toBeLessThanOrEqual(2);
  });
});

describe('deepestLeaf', () => {
  it('follows the last child chain to a leaf', () => {
    const m = fixture();
    const u1 = m.find((x) => x.id === 'u1')!;
    expect(deepestLeaf(m, u1).id).toBe('a1b');
  });

  it('returns the node itself when it is a leaf', () => {
    const m = fixture();
    const a2 = m.find((x) => x.id === 'a2')!;
    expect(deepestLeaf(m, a2).id).toBe('a2');
  });
});

describe('nextOrd', () => {
  it('continues sibling numbering', () => {
    const m = fixture();
    expect(nextOrd(m, 'u1')).toBe(2);
    expect(nextOrd(m, null)).toBe(1);
  });
});

describe('descendantIds', () => {
  it('collects the whole subtree, deleted included', () => {
    const m = fixture();
    m.find((x) => x.id === 'a1b')!.deleted_at = 5;
    // 'g' has two children (u1 and u2), so both branches are descendants.
    expect(descendantIds(m, 'g').sort()).toEqual(['a1a', 'a1b', 'a2', 'u1', 'u2'].sort());
  });
});

describe('nearestSurvivingAncestor', () => {
  it('climbs past deleted ancestors to the nearest survivor', () => {
    const m = fixture();
    m.find((x) => x.id === 'u1')!.deleted_at = 5;
    m.find((x) => x.id === 'g')!.deleted_at = 5;
    expect(nearestSurvivingAncestor(m, 'a1b')).toBeNull();
  });

  it('returns the parent when alive', () => {
    const m = fixture();
    expect(nearestSurvivingAncestor(m, 'a1a')?.id).toBe('u1');
  });
});
