const PATHS = {
  home: ['M4 11.2 12 4.4l8 6.8', 'M6.2 9.8V19a1 1 0 0 0 1 1H10v-5.2h4V20h2.8a1 1 0 0 0 1-1V9.8'],
  chats: ['M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9.5L4.5 20.5V6Z'],
  characters: [
    'M10 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M3.5 20c.8-3.2 3-4.8 6.5-4.8s5.7 1.6 6.5 4.8',
    'M15.5 5.2a4 4 0 0 1 0 7.6',
    'M17 15.4c1.9.7 3.1 2.2 3.7 4.6',
  ],
  personas: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M12 11.5a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
    'M5.8 18.2C7 15.7 9.2 14.5 12 14.5s5 1.2 6.2 3.7',
  ],
  lorebooks: ['M6 3.5h12v17l-6-3.8-6 3.8Z', 'M9.5 8h5'],
  providers: ['M9 2.8V7', 'M15 2.8V7', 'M7.5 7h9v3.2a4.5 4.5 0 0 1-9 0Z', 'M12 14.7V21'],
  settings: ['M4 7h9', 'M17 7h3', 'M15 4.8v4.4', 'M4 17h3', 'M11 17h9', 'M9 14.8v4.4'],
  search: ['M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Z', 'M15.3 15.3 20 20'],
  stats: ['M4 20V10', 'M10 20V4', 'M16 20v-8', 'M2.5 20h19'],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
