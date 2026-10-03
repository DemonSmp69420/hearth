import { describe, expect, it } from 'vitest';
import { schemeVars } from './palette';

const HEX6 = /^#[0-9a-f]{6}$/;
const CORE_ROLES = ['primary', 'onPrimary', 'surface', 'onSurface', 'surfaceContainer', 'outline'];

describe('schemeVars', () => {
  it('produces hex values for all core roles in light and dark', () => {
    const light = schemeVars('#6750A4', false);
    const dark = schemeVars('#6750A4', true);
    for (const role of CORE_ROLES) {
      expect(light[role]).toMatch(HEX6);
      expect(dark[role]).toMatch(HEX6);
    }
    expect(light.primary).not.toBe(dark.primary);
  });

  it('flattens surfaces to black in AMOLED mode', () => {
    const amoled = schemeVars('#6750A4', true, true);
    expect(amoled.surface).toBe('#000000');
    expect(amoled.surfaceContainer).toBe('#0b0b0b');
    expect(amoled.primary).toMatch(HEX6);
  });

  it('keeps surfaces untouched in normal dark mode', () => {
    const dark = schemeVars('#6750A4', true);
    expect(dark.surface).not.toBe('#000000');
  });
});
