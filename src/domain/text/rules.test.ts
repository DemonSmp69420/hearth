import { describe, expect, it } from 'vitest';
import { applyRules, type OutputRuleLike } from './rules';

const rule = (over: Partial<OutputRuleLike>): OutputRuleLike => ({
  find: 'foo',
  replace: 'bar',
  regex: false,
  direction: 'out',
  characterId: null,
  enabled: true,
  ...over,
});

describe('output rules (M5.6)', () => {
  it('replaces plain substrings, all occurrences', () => {
    const out = applyRules('foo and FOO and foo', [rule({})], { direction: 'out' });
    expect(out).toBe('bar and FOO and bar');
  });

  it('respects direction', () => {
    const rules = [rule({ direction: 'in' })];
    expect(applyRules('foo', rules, { direction: 'out' })).toBe('foo');
    expect(applyRules('foo', rules, { direction: 'in' })).toBe('bar');
  });

  it('honors the character scope for out rules', () => {
    const rules = [rule({ characterId: 'char-a' })];
    expect(applyRules('foo', rules, { direction: 'out', characterId: 'char-a' })).toBe('bar');
    expect(applyRules('foo', rules, { direction: 'out', characterId: 'char-b' })).toBe('foo');
    expect(applyRules('foo', rules, { direction: 'out' })).toBe('foo');
    expect(applyRules('foo', [rule({ characterId: null })], { direction: 'out' })).toBe('bar');
  });

  it('applies regex rules globally and skips invalid patterns', () => {
    expect(applyRules('aaa', [rule({ find: 'a+', regex: true, replace: 'b' })], { direction: 'out' })).toBe('b');
    expect(applyRules('x(foo', [rule({ find: '(foo', regex: true, replace: 'bar' })], { direction: 'out' })).toBe('x(foo');
  });

  it('skips disabled rules and empty finds, applying in order', () => {
    const rules = [
      rule({ find: 'a', replace: 'b' }),
      rule({ find: 'b', replace: 'c', enabled: false }),
      rule({ find: '', replace: 'z' }),
      rule({ find: 'b', replace: 'c' }),
    ];
    expect(applyRules('ab', rules, { direction: 'out' })).toBe('cc');
  });
});
