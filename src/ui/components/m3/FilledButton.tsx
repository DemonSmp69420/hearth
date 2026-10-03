import type { ButtonHTMLAttributes } from 'react';

export function FilledButton({
  variant = 'filled',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'filled' | 'outlined' | 'text' | 'tonal';
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`m3-button m3-button-${variant} ${rest.className ?? ''}`}
    />
  );
}
