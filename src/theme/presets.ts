export interface ThemePreset {
  id: string;
  name: string;
  seed: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'violet-dusk', name: 'Violet Dusk', seed: '#6750A4' },
  { id: 'forest', name: 'Forest', seed: '#386A20' },
  { id: 'rose', name: 'Rose', seed: '#984061' },
  { id: 'ocean', name: 'Ocean', seed: '#00639B' },
  { id: 'amber', name: 'Amber', seed: '#7A5900' },
  { id: 'slate', name: 'Slate', seed: '#565F71' },
  { id: 'mono', name: 'Mono', seed: '#605D62' },
  { id: 'sakura', name: 'Sakura', seed: '#B3272D' },
];

export const DEFAULT_SEED = '#6750A4';
