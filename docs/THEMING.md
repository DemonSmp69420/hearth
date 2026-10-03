# Hearth — Theming

Hearth uses a real Material Design 3 color system: every theme is generated
at runtime from a **seed color** with
`@material/material-color-utilities`, and all ~37 color roles are exposed as
CSS custom properties (`--md-sys-color-*`). Implementation:
`src/theme/palette.ts` + `src/styles/tokens.css`; UI in **Settings →
Appearance**.

## What you can change

- **Mode:** System · Light · Dark · **AMOLED** (surfaces flattened to true
  black; contrast re-verified against AA).
- **Seed color:** 8 built-in presets (Violet Dusk, Forest, Rose, Ocean,
  Amber, Slate, Mono, Sakura) plus any custom color via the picker — the
  full tonal palette regenerates live, no reload.
- **Custom themes:** create, preview live, and export/import as JSON.
- **Character accent (per chat):** tint buttons and highlights with a color
  derived from the character's name (toggle in the chat Proxy panel).
- **Typography & reading:** body font, reading font, text size, line height,
  column width, and chat styles (bubbles / flat / compact) — persisted
  app-wide.

## Guarantees

- **WCAG AA contrast is enforced by a unit test**
  (`src/theme/contrast.test.ts`): every shipped preset × light/dark/AMOLED
  is checked for ≥ 4.5:1 on all text role pairs and ≥ 3:1 on UI-boundary
  pairs. A theme change that breaks accessibility fails CI.
- `prefers-reduced-motion` is respected globally, with visible
  `:focus-visible` outlines everywhere and a skip-to-content link.

## Surface-container roles

Newer M3 roles (`surfaceContainerLowest…Highest`, `surfaceDim/Bright`) are
not exposed by mcu 0.3.0's `Scheme` class, so `schemeVars` derives them from
the neutral tonal palette using the canonical M3 tones — the same formulas
mcu's own `DynamicScheme` uses. AMOLED mode then flattens the surface family
to black while text roles stay untouched (contrast only improves).
