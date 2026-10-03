import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession, type ViewId, type ThemeMode } from '../../stores/session';
import { useChat } from '../../stores/chat';
import { listCharacters, listLorebooks } from '../../services/db/queries';
import { THEME_PRESETS } from '../../theme/presets';

interface Item {
  id: string;
  label: string;
  hint: string;
  group: 'Go to' | 'Chats' | 'Characters' | 'Theme' | 'Actions' | 'Help';
  run: () => void;
}

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'chats', label: 'Chats' },
  { id: 'characters', label: 'Characters' },
  { id: 'personas', label: 'Personas' },
  { id: 'lorebooks', label: 'Lorebooks' },
  { id: 'providers', label: 'Providers' },
  { id: 'settings', label: 'Settings' },
];

const MODES: ThemeMode[] = ['system', 'light', 'dark', 'amoled'];

/**
 * Command palette (M4.2): Ctrl/Cmd+K — jump to anything, switch themes,
 * quick actions. Filter is a simple startsWith > includes rank.
 */
export function CommandPalette({ onClose, onShowShortcuts }: { onClose: () => void; onShowShortcuts: () => void }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const chats = useChat((s) => s.chats);
  const characters = useQuery({ queryKey: ['palette-characters'], queryFn: listCharacters });
  const lorebooks = useQuery({ queryKey: ['palette-lorebooks'], queryFn: listLorebooks });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [];
    const session = useSession.getState();

    for (const v of VIEWS) {
      all.push({
        id: `view:${v.id}`,
        label: v.label,
        hint: 'Go to',
        group: 'Go to',
        run: () => session.setView(v.id),
      });
    }

    for (const chat of chats) {
      all.push({
        id: `chat:${chat.id}`,
        label: chat.title,
        hint: 'Open chat',
        group: 'Chats',
        run: () => {
          void useChat.getState().openChat(chat.id);
          session.setView('chats');
        },
      });
    }

    for (const c of characters.data ?? []) {
      all.push({
        id: `char:${c.id}`,
        label: `New chat with ${c.name}`,
        hint: 'Character',
        group: 'Characters',
        run: () => {
          void useChat.getState().startChat(c.id, null).then(() => session.setView('chats'));
        },
      });
    }

    for (const lb of lorebooks.data ?? []) {
      all.push({
        id: `lore:${lb.id}`,
        label: lb.name,
        hint: 'Lorebook',
        group: 'Go to',
        run: () => session.setView('lorebooks'),
      });
    }

    for (const mode of MODES) {
      all.push({
        id: `mode:${mode}`,
        label: `Theme: ${mode}`,
        hint: 'Appearance',
        group: 'Theme',
        run: () => session.setThemeMode(mode),
      });
    }
    for (const preset of THEME_PRESETS) {
      all.push({
        id: `seed:${preset.seed}`,
        label: `Theme: ${preset.name}`,
        hint: 'Color scheme',
        group: 'Theme',
        run: () => session.setThemeSeed(preset.seed),
      });
    }

    all.push({
      id: 'action:summaries',
      label: 'Summarize current chat now',
      hint: 'Memory',
      group: 'Actions',
      run: () => {
        void useChat.getState().summarizeNow();
      },
    });

    all.push({
      id: 'help:shortcuts',
      label: 'Keyboard shortcuts',
      hint: 'Help',
      group: 'Help',
      run: onShowShortcuts,
    });

    return all;
  }, [chats, characters.data, lorebooks.data, onShowShortcuts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const starts: Item[] = [];
    const includes: Item[] = [];
    for (const item of items) {
      const label = item.label.toLowerCase();
      if (label.startsWith(q)) starts.push(item);
      else if (label.includes(q)) includes.push(item);
    }
    return [...starts, ...includes];
  }, [items, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const commit = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    setQuery('');
    item.run();
  };

  return (
    <div className="palette-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="Jump to… (chats, characters, themes, actions)"
          aria-label="Command palette search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              commit(filtered[cursor]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul className="palette-list" ref={listRef}>
          {filtered.length === 0 && <li className="palette-empty">No matches</li>}
          {filtered.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                className="palette-item"
                data-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => commit(item)}
              >
                <span>{item.label}</span>
                <span className="palette-hint">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl / Cmd + K', 'Command palette'],
  ['Enter', 'Send message'],
  ['Shift + Enter', 'New line in composer'],
  ['Escape', 'Close dialogs and panels'],
  ['‹ n / n ›', 'Swipe between reply alternatives'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="palette-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette shortcuts" role="dialog" aria-label="Keyboard shortcuts">
        <h2 style={{ margin: '0 0 8px', font: 'var(--md-sys-typescale-title-lg)' }}>Keyboard shortcuts</h2>
        <ul className="shortcuts-list">
          {SHORTCUTS.map(([key, action]) => (
            <li key={key}>
              <kbd>{key}</kbd>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
