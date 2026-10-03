import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SEED } from '../theme/presets';
import type { PinRecord } from '../domain/privacy/pin';

export type ThemeMode = 'system' | 'light' | 'dark' | 'amoled';
export type ViewId =
  | 'home'
  | 'chats'
  | 'characters'
  | 'personas'
  | 'lorebooks'
  | 'providers'
  | 'search'
  | 'stats'
  | 'settings';

export type ChatStyle = 'bubbles' | 'flat' | 'compact';
export type FontChoice = 'default' | 'serif' | 'round' | 'mono';
export type AvatarSize = 'hidden' | 'sm' | 'md' | 'lg';

/** M4.5 reading settings — app-wide, how the chat itself looks. */
export interface ReadingSettings {
  chatStyle: ChatStyle;
  fontChoice: FontChoice;
  fontSize: number;
  lineHeight: number;
  chatWidth: number;
  avatarSize: AvatarSize;
  /** 0 = off, 1 = gentle, 2 = slow streaming reveal. */
  typewriter: 0 | 1 | 2;
}

export const DEFAULT_READING: ReadingSettings = {
  chatStyle: 'flat',
  fontChoice: 'default',
  fontSize: 16,
  lineHeight: 1.6,
  chatWidth: 820,
  avatarSize: 'md',
  typewriter: 0,
};

/** M5.3 privacy prefs (§12). The PIN itself lives in the DB, not here. */
export interface PrivacySettings {
  /** Blur message content until hover. */
  blurUntilHover: boolean;
  /** Show a neutral window/browser title instead of "Hearth". */
  hideTitle: boolean;
  /** Panic/boss key (Ctrl+Shift+H) hides the window instantly. */
  panicKey: boolean;
  /** The panic key also locks the app (only effective when a PIN is set). */
  lockOnPanic: boolean;
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  blurUntilHover: false,
  hideTitle: false,
  panicKey: true,
  lockOnPanic: true,
};

export type LockState = 'checking' | 'locked' | 'unlocked';

/** Settings-table key holding the app-lock PIN record (M5.3). */
export const PIN_SETTING_KEY = 'privacy_pin';

interface SessionState {
  view: ViewId;
  themeMode: ThemeMode;
  themeSeed: string;
  reading: ReadingSettings;
  privacy: PrivacySettings;
  /** M5.3 app lock: PIN record + gate state (never persisted). */
  lockState: LockState;
  pinRecord: PinRecord | null;
  setView: (v: ViewId) => void;
  setThemeMode: (m: ThemeMode) => void;
  setThemeSeed: (s: string) => void;
  setReading: (patch: Partial<ReadingSettings>) => void;
  setPrivacy: (patch: Partial<PrivacySettings>) => void;
  setLockState: (s: LockState) => void;
  setPinRecord: (r: PinRecord | null) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      view: 'home',
      themeMode: 'system',
      themeSeed: DEFAULT_SEED,
      reading: DEFAULT_READING,
      privacy: DEFAULT_PRIVACY,
      lockState: 'checking',
      pinRecord: null,
      setView: (view) => set({ view }),
      setThemeMode: (themeMode) => set({ themeMode }),
      setThemeSeed: (themeSeed) => set({ themeSeed }),
      setReading: (patch) => set((s) => ({ reading: { ...s.reading, ...patch } })),
      setPrivacy: (patch) => set((s) => ({ privacy: { ...s.privacy, ...patch } })),
      setLockState: (lockState) => set({ lockState }),
      setPinRecord: (pinRecord) => set({ pinRecord }),
    }),
    {
      name: 'hearth.session',
      partialize: (s) => ({
        view: s.view,
        themeMode: s.themeMode,
        themeSeed: s.themeSeed,
        reading: s.reading,
        privacy: s.privacy,
      }),
    },
  ),
);
