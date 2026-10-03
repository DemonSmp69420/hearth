export interface Accent {
  primary: string;
  onPrimary: string;
  container: string;
  onContainer: string;
}

/**
 * Deterministic per-chat accent (M4.4 "avatar-seeded themes"): derived from
 * the character's name so every chat for the same character shares an accent,
 * no avatar file needed. HSL keeps saturation/lightness in accessible ranges.
 */
export function accentFor(name: string): Accent {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  // Light mode accent: medium-dark; text on it is white. Container is soft.
  const primary = `hsl(${hue} 62% 42%)`;
  const container = `hsl(${hue} 70% 88%)`;
  return { primary, onPrimary: '#ffffff', container, onContainer: `hsl(${hue} 60% 18%)` };
}

/** Same accent as CSS custom-property overrides, scoped to a chat. */
export function accentVars(name: string): Record<string, string> {
  const a = accentFor(name);
  return {
    '--md-sys-color-primary': a.primary,
    '--md-sys-color-on-primary': a.onPrimary,
    '--md-sys-color-primary-container': a.container,
    '--md-sys-color-on-primary-container': a.onContainer,
  };
}
