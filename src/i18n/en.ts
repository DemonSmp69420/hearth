/**
 * Typed i18n dictionary (English). §14: strings are externalized so a second
 * language is a new file in this folder, not a code sweep.
 *
 * Pattern: `t('nav.chats')` with dot-separated keys; translations receive
 * `{name}` placeholders filled by t(). The dictionary is typed — a missing
 * key is a compile error at the call site via the keyof lookup.
 *
 * M6.5 migrated the shell, composer, and chat-header surfaces; the remaining
 * hardcoded strings are inventoried in docs/I18N.md with per-file counts.
 */

export const en = {
  'app.name': 'Hearth',
  'app.devBanner': 'Browser dev mode — SQLite, keychain, and providers require the Tauri shell ({command}).',
  'nav.home': 'Home',
  'nav.chats': 'Chats',
  'nav.characters': 'Characters',
  'nav.personas': 'Personas',
  'nav.lorebooks': 'Lorebooks',
  'nav.search': 'Search',
  'nav.providers': 'Providers',
  'nav.settings': 'Settings',
  'nav.stats': 'Stats',
  'nav.skip': 'Skip to content',
  'home.title': 'Home',
  'home.continue': 'Continue where you left off',
  'home.empty': 'No chats yet. Pick a character and press Chat to start one.',
  'home.newChat': 'New chat',
  'chat.back': '‹ Chats',
  'chat.as': 'as',
  'chat.noPersona': '(no persona)',
  'chat.memory': 'Memory',
  'chat.inspector': 'Inspector',
  'chat.proxy': 'Proxy',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.continue': 'Continue',
  'chat.impersonate': 'Impersonate',
  'chat.placeholder': 'Write your reply… (Enter to send, Shift+Enter for a new line)',
  'chat.edit': 'Edit',
  'chat.regenerate': 'Regenerate',
  'chat.bookmark': 'Bookmark',
  'chat.more': 'More',
  'chat.you': 'You',
  'chat.ai': 'AI',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.loading': 'Loading…',
} as const;

export type TranslationKey = keyof typeof en;
export type TranslationVars = Record<string, string | number>;

export function t(key: TranslationKey, vars?: TranslationVars): string {
  let text: string = en[key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(`{${name}}`, String(value));
    }
  }
  return text;
}
