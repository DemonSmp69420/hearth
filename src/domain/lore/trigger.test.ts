import { describe, expect, it } from 'vitest';
import { fireLore, type LoreEntryLike } from './trigger';

function entry(overrides: Partial<LoreEntryLike> = {}): LoreEntryLike {
  return {
    id: 'l1',
    title: 'The bridge',
    content: 'An old stone bridge crosses the ravine.',
    keywords_primary: '["bridge"]',
    keywords_secondary: '[]',
    regexes: '[]',
    constant: 0,
    enabled: 1,
    priority: 50,
    scan_depth: 2,
    ...overrides,
  };
}

describe('fireLore', () => {
  it('fires on a primary keyword within scan depth', () => {
    const out = fireLore([entry()], [
      { role: 'user', content: 'Let us head to the ravine.' },
      { role: 'assistant', content: 'The BRIDGE looms ahead.' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('The bridge');
  });

  it('ignores keywords deeper than scan_depth', () => {
    const out = fireLore([entry({ scan_depth: 1 })], [
      { role: 'user', content: 'bridge talk happened earlier' },
      { role: 'assistant', content: 'We walk on.' },
    ]);
    expect(out).toHaveLength(0);
  });

  it('constant entries always fire, disabled never do', () => {
    expect(fireLore([entry({ constant: 1 })], [{ role: 'user', content: 'nothing relevant' }])).toHaveLength(1);
    expect(fireLore([entry({ enabled: 0, constant: 1 })], [{ role: 'user', content: 'x' }])).toHaveLength(0);
  });

  it('uses secondary keywords only when no primaries are defined', () => {
    const onlySecondary = entry({ keywords_primary: '[]', keywords_secondary: '["ravine"]' });
    expect(fireLore([onlySecondary], [{ role: 'user', content: 'down to the ravine' }])).toHaveLength(1);
    const both = entry({ keywords_primary: '["bridge"]', keywords_secondary: '["ravine"]' });
    expect(fireLore([both], [{ role: 'user', content: 'down to the ravine' }])).toHaveLength(0);
  });

  it('tries regexes when keywords miss and never throws on bad regex', () => {
    const regex = entry({ keywords_primary: '[]', regexes: '["steel[^s]*sword"]' });
    expect(fireLore([regex], [{ role: 'user', content: 'a steel Sword glints' }])).toHaveLength(1);
    const bad = entry({ keywords_primary: '[]', regexes: '["([bad"]' });
    expect(() => fireLore([bad], [{ role: 'user', content: 'x' }])).not.toThrow();
    expect(fireLore([bad], [{ role: 'user', content: 'x' }])).toHaveLength(0);
  });

  it('orders fired entries by priority and estimates tokens', () => {
    const out = fireLore(
      [entry({ id: 'a', priority: 10, constant: 1 }), entry({ id: 'b', priority: 90, constant: 1 })],
      [],
    );
    expect(out.map((o) => o.id)).toEqual(['b', 'a']);
    expect(out[0]!.tokens).toBeGreaterThan(0);
  });
});
