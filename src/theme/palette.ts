import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities';

// Roles exposed directly by mcu 0.3.0's Scheme class.
const ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'background',
  'onBackground',
  'surface',
  'onSurface',
  'surfaceVariant',
  'onSurfaceVariant',
  'outline',
  'outlineVariant',
  'shadow',
  'scrim',
  'inverseSurface',
  'inverseOnSurface',
  'inversePrimary',
] as const;

// The newer surface-container roles are part of the M3 spec but not of mcu
// 0.3.0's Scheme class, so we derive them from the neutral tonal palette using
// the canonical M3 tones (same formulas as mcu's DynamicScheme).
const CONTAINER_TONES_LIGHT = {
  surfaceDim: 87,
  surfaceBright: 98,
  surfaceContainerLowest: 100,
  surfaceContainerLow: 96,
  surfaceContainer: 94,
  surfaceContainerHigh: 92,
  surfaceContainerHighest: 90,
} as const;

const CONTAINER_TONES_DARK = {
  surfaceDim: 6,
  surfaceBright: 24,
  surfaceContainerLowest: 4,
  surfaceContainerLow: 10,
  surfaceContainer: 12,
  surfaceContainerHigh: 17,
  surfaceContainerHighest: 22,
} as const;

const AMOLED_OVERRIDES: Record<string, string> = {
  background: '#000000',
  surface: '#000000',
  surfaceDim: '#000000',
  surfaceContainerLowest: '#000000',
  surfaceContainerLow: '#060606',
  surfaceContainer: '#0b0b0b',
  surfaceContainerHigh: '#111111',
  surfaceContainerHighest: '#171717',
  surfaceBright: '#1b1b1b',
};

/** All M3 color roles for a seed, as hex values (pure — no DOM). */
export function schemeVars(seedHex: string, dark: boolean, amoled = false): Record<string, string> {
  const theme = themeFromSourceColor(argbFromHex(seedHex));
  const scheme = dark ? theme.schemes.dark : theme.schemes.light;
  const props = scheme as unknown as Record<string, number>;
  const vars: Record<string, string> = {};
  for (const role of ROLES) {
    const v = props[role];
    if (typeof v === 'number') vars[role] = hexFromArgb(v);
  }

  const tones = dark ? CONTAINER_TONES_DARK : CONTAINER_TONES_LIGHT;
  for (const [role, tone] of Object.entries(tones)) {
    vars[role] = hexFromArgb(theme.palettes.neutral.tone(tone));
  }
  vars.surfaceTint = vars.primary!;

  if (dark && amoled) {
    for (const [role, hex] of Object.entries(AMOLED_OVERRIDES)) {
      if (role in vars) vars[role] = hex;
    }
  }
  return vars;
}

export function cssVarName(role: string): string {
  return `--md-sys-color-${role.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
}

export function applyScheme(seedHex: string, dark: boolean, amoled = false): void {
  const root = document.documentElement;
  for (const [role, hex] of Object.entries(schemeVars(seedHex, dark, amoled))) {
    root.style.setProperty(cssVarName(role), hex);
  }
  root.dataset.scheme = amoled && dark ? 'amoled' : dark ? 'dark' : 'light';
}
