import { describe, expect, it } from 'vitest';
import { checkConsistency } from './guard';

describe('consistency guard (M5.9)', () => {
  it('flags a reply that negates a pinned fact', () => {
    const warnings = checkConsistency({
      reply: 'Honestly, Mira cannot stand the sea — she refuses to even look at it.',
      facts: ['Mira loves the sea and swims every morning'],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.fact).toContain('Mira');
    expect(warnings[0]!.confidence).toBeGreaterThan(0.5);
  });

  it('stays quiet when the reply is consistent with the fact', () => {
    const warnings = checkConsistency({
      reply: 'Mira loves the sea, so she suggests swimming before breakfast.',
      facts: ['Mira loves the sea and swims every morning'],
    });
    expect(warnings).toHaveLength(0);
  });

  it('stays quiet when only one content word matches', () => {
    const warnings = checkConsistency({
      reply: 'The harbor is closed today because of the storm, nobody is sailing.',
      facts: ['Mira loves the sea and swims every morning'],
    });
    expect(warnings).toHaveLength(0);
  });

  it('ignores short and stopword-only facts', () => {
    const warnings = checkConsistency({
      reply: 'That was not the plan at all.',
      facts: ['a', 'the', ''],
    });
    expect(warnings).toHaveLength(0);
  });

  it('returns nothing for an empty reply or no facts', () => {
    expect(checkConsistency({ reply: '', facts: ['Mira loves the sea'] })).toHaveLength(0);
    expect(checkConsistency({ reply: 'not mira sea', facts: [] })).toHaveLength(0);
  });

  it('caps confidence below 1', () => {
    const warnings = checkConsistency({
      reply: 'mira sea swims morning — not never no longer none of it is real',
      facts: ['Mira loves the sea and swims every morning near the shore'],
    });
    expect(warnings[0]!.confidence).toBeLessThanOrEqual(0.9);
  });
});
