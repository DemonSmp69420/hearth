import { describe, expect, it } from 'vitest';
import { schemeVars } from './palette';
import { THEME_PRESETS } from './presets';

/**
 * §11.3 quality bar: WCAG AA contrast, enforced across every shipped theme
 * preset × mode. Text pairs need ≥ 4.5:1; UI-boundary pairs (outline) ≥ 3:1.
 */

function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const raw = parseInt(v.slice(i, i + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['onPrimary', 'primary'],
  ['onPrimaryContainer', 'primaryContainer'],
  ['onSecondaryContainer', 'secondaryContainer'],
  ['onTertiaryContainer', 'tertiaryContainer'],
  ['onError', 'error'],
  ['onErrorContainer', 'errorContainer'],
  ['onSurface', 'surface'],
  ['onSurface', 'surfaceContainerHigh'],
  ['onSurfaceVariant', 'surfaceContainer'],
  ['onBackground', 'background'],
  ['inverseOnSurface', 'inverseSurface'],
];

const UI_PAIRS: [string, string][] = [['outline', 'surface'], ['outline', 'surfaceContainerLow']];

const MODES: { name: string; dark: boolean; amoled: boolean }[] = [
  { name: 'light', dark: false, amoled: false },
  { name: 'dark', dark: true, amoled: false },
  { name: 'amoled', dark: true, amoled: true },
];

describe('WCAG AA contrast across all themes (§11.3)', () => {
  for (const preset of THEME_PRESETS) {
    for (const mode of MODES) {
      it(`${preset.name} × ${mode.name}: all text pairs ≥ 4.5, UI pairs ≥ 3`, () => {
        const vars = schemeVars(preset.seed, mode.dark, mode.amoled);
        for (const [fg, bg] of TEXT_PAIRS) {
          const ratio = contrast(vars[fg]!, vars[bg]!);
          expect([preset.name, mode.name, fg, bg, ratio.toFixed(2)]).toSatisfyRatio(4.5);
        }
        for (const [fg, bg] of UI_PAIRS) {
          const ratio = contrast(vars[fg]!, vars[bg]!);
          expect([preset.name, mode.name, fg, bg, ratio.toFixed(2)]).toSatisfyRatio(3);
        }
      });
    }
  }
});

// Small helper so failures print the pair and ratio, not just a number.
expect.extend({
  toSatisfyRatio(received: unknown, min: number) {
    const [preset, mode, fg, bg, ratio] = received as [string, string, string, string, string];
    const pass = parseFloat(ratio) >= min;
    return {
      pass,
      message: () =>
        `${preset} × ${mode}: ${fg} on ${bg} is ${ratio}:1 — needs ≥ ${min}:1`,
    };
  },
});

declare module 'vitest' {
  interface Assertion {
    toSatisfyRatio(min: number): void;
  }
}
