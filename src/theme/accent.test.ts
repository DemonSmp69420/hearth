import { describe, expect, it } from 'vitest';
import { accentFor, accentVars } from './accent';

describe('accentFor', () => {
  it('is deterministic for the same name', () => {
    expect(accentFor('Serena')).toEqual(accentFor('Serena'));
  });

  it('differs across names (overwhelmingly likely)', () => {
    const a = accentFor('Serena');
    const b = accentFor('Sir Arthur');
    expect(a.primary).not.toEqual(b.primary);
  });

  it('emits valid CSS color strings for all roles', () => {
    const a = accentFor('Test Knight');
    expect(a.primary).toMatch(/^hsl\(\d+ 62% 42%\)$/);
    expect(a.container).toMatch(/^hsl\(\d+ 70% 88%\)$/);
    expect(a.onPrimary).toBe('#ffffff');
  });

  it('accentVars exposes the four scoped custom properties', () => {
    const vars = accentVars('Serena');
    expect(Object.keys(vars).sort()).toEqual([
      '--md-sys-color-on-primary',
      '--md-sys-color-on-primary-container',
      '--md-sys-color-primary',
      '--md-sys-color-primary-container',
    ]);
  });
});
