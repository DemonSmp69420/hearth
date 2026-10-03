import { useEffect } from 'react';
import { applyScheme } from '../theme/palette';
import { useSession } from '../stores/session';

/** Resolves the theme mode (incl. system preference) and paints the M3 roles. */
export function useTheme(): void {
  const themeMode = useSession((s) => s.themeMode);
  const themeSeed = useSession((s) => s.themeSeed);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark =
        themeMode === 'dark' || themeMode === 'amoled' || (themeMode === 'system' && mq.matches);
      applyScheme(themeSeed, dark, themeMode === 'amoled');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themeMode, themeSeed]);
}
