import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../components/m3';
import { useSession, type ViewId } from '../../stores/session';
import { isTauri } from '../../services/transport';
import { HomeView } from '../views/HomeView';
import { SettingsView } from '../views/SettingsView';
import { ChatsView } from '../views/ChatsView';
import { CharactersView } from '../views/CharactersView';
import { PersonasView } from '../views/PersonasView';
import { ProvidersView } from '../views/ProvidersView';
import { LorebooksView } from '../views/LorebooksView';
import { SearchView } from '../views/SearchView';
import { StatsView } from '../views/StatsView';
import { CommandPalette, ShortcutsDialog } from './CommandPalette';
import { t, type TranslationKey } from '../../i18n/en';

const NAV: { id: ViewId; label: TranslationKey; icon: IconName }[] = [
  { id: 'home', label: 'nav.home', icon: 'home' },
  { id: 'chats', label: 'nav.chats', icon: 'chats' },
  { id: 'characters', label: 'nav.characters', icon: 'characters' },
  { id: 'personas', label: 'nav.personas', icon: 'personas' },
  { id: 'lorebooks', label: 'nav.lorebooks', icon: 'lorebooks' },
  { id: 'search', label: 'nav.search', icon: 'search' },
  { id: 'stats', label: 'nav.stats', icon: 'stats' },
  { id: 'providers', label: 'nav.providers', icon: 'providers' },
  { id: 'settings', label: 'nav.settings', icon: 'settings' },
];

export function AppShell() {
  const view = useSession((s) => s.view);
  const setView = useSession((s) => s.setView);
  const privacy = useSession((s) => s.privacy);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // M5.3: neutral window/tab title when hiding is on.
  useEffect(() => {
    const title = privacy.hideTitle ? 'Notes' : 'Hearth';
    document.title = title;
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(title).catch(() => {}),
      );
    }
  }, [privacy.hideTitle]);

  // M5.3: panic/boss key — Ctrl+Shift+H instantly hides the window (desktop)
  // or locks/jumps home (web companion, where a tab cannot hide itself).
  useEffect(() => {
    if (!privacy.panicKey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        const s = useSession.getState();
        if (privacy.lockOnPanic && s.pinRecord) s.setLockState('locked');
        if (isTauri()) {
          void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
            getCurrentWindow().hide().catch(() => {}),
          );
        } else if (!(privacy.lockOnPanic && s.pinRecord)) {
          s.setView('home');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [privacy.panicKey, privacy.lockOnPanic]);

  // Cross-view navigation signals (e.g. "Chat" on a character card)
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent<ViewId>).detail;
      if (target) setView(target);
    };
    window.addEventListener('hearth:navigate', handler);
    return () => window.removeEventListener('hearth:navigate', handler);
  }, [setView]);

  // Command palette: Ctrl/Cmd+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app-shell ${privacy.blurUntilHover ? 'privacy-blur' : ''}`.trim()}>
      <a href="#main-content" className="skip-link">
        {t('nav.skip')}
      </a>
      <nav className="m3-rail" aria-label="Primary">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={view === item.id ? 'm3-rail-item active' : 'm3-rail-item'}
            onClick={() => setView(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            <span>{t(item.label)}</span>
          </button>
        ))}
      </nav>
      <main id="main-content" className="app-content" tabIndex={-1}>
        {renderView(view)}
      </main>
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onShowShortcuts={() => setShortcutsOpen(true)}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

function renderView(view: ViewId) {
  switch (view) {
    case 'home':
      return <HomeView />;
    case 'settings':
      return <SettingsView />;
    case 'chats':
      return <ChatsView />;
    case 'characters':
      return <CharactersView />;
    case 'personas':
      return <PersonasView />;
    case 'providers':
      return <ProvidersView />;
    case 'lorebooks':
      return <LorebooksView />;
    case 'search':
      return <SearchView />;
    case 'stats':
      return <StatsView />;
    default:
      return (
        <section className="page">
          <h1>Coming soon</h1>
        </section>
      );
  }
}
