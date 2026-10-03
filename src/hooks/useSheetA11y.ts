import { useEffect, useRef } from 'react';

/**
 * Shared side-sheet a11y (M6.2): Escape closes, focus moves into the sheet on
 * open and returns to the previously focused element on close.
 */
export function useSheetA11y(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return ref;
}
