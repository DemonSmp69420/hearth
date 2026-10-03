import type { HTMLAttributes } from 'react';

export function Card({
  variant = 'filled',
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: 'filled' | 'outlined' | 'elevated' }) {
  return <div {...rest} className={`m3-card m3-card-${variant} ${rest.className ?? ''}`} />;
}
