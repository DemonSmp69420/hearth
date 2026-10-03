import { describe, expect, it } from 'vitest';
import { expandMacros } from './macros';

const ctx = {
  userName: 'Sam',
  charName: 'Sir Arthur',
  lastMessage: 'the bridge at dawn',
  now: new Date(2026, 9, 3, 14, 5),
  vars: { mood: 'sunny' },
};

describe('expandMacros', () => {
  it('expands {{user}} and {{char}}', () => {
    expect(expandMacros('{{user}} meets {{char}}', ctx)).toBe('Sam meets Sir Arthur');
  });

  it('supports legacy aliases', () => {
    expect(expandMacros('{user} and <USER>', ctx)).toBe('Sam and Sam');
  });

  it('expands date, time, lastMessage', () => {
    const out = expandMacros('{{date}} {{time}} — {{lastMessage}}', ctx);
    expect(out).toContain('2026');
    expect(out).toContain('14:05');
    expect(out).toContain('the bridge at dawn');
  });

  it('picks from {{random:a,b,c}}', () => {
    for (let i = 0; i < 20; i++) {
      expect(['a', 'b', 'c']).toContain(expandMacros('{{random:a,b,c}}', ctx));
    }
  });

  it('resolves custom vars and leaves unknown vars visible', () => {
    expect(expandMacros('{{var:mood}}', ctx)).toBe('sunny');
    expect(expandMacros('{{var:nope}}', ctx)).toBe('{{var:nope}}');
  });

  it('leaves unknown macros verbatim', () => {
    expect(expandMacros('{{nope}}', ctx)).toBe('{{nope}}');
  });
});
