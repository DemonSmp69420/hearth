import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createLorebook,
  createLoreEntry,
  deleteLorebook,
  deleteLoreEntry,
  listLoreAttachments,
  listLorebooks,
  listLoreEntries,
  removeLoreAttachment,
  setLoreAttachment,
  type LoreEntryRow,
} from '../../services/db/queries';
import { listCharacters } from '../../services/db/queries';
import { Card } from '../components/m3';

/** Lorebooks view (§8 basic): books, keyword entries, and attachments. */
export function LorebooksView() {
  const queryClient = useQueryClient();
  const books = useQuery({ queryKey: ['lorebooks'], queryFn: listLorebooks });
  const attachments = useQuery({ queryKey: ['lore-attachments'], queryFn: listLoreAttachments });
  const characters = useQuery({ queryKey: ['characters'], queryFn: listCharacters });
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const entries = useQuery({
    queryKey: ['lore-entries', openBookId],
    queryFn: () => listLoreEntries(openBookId!),
    enabled: openBookId !== null,
  });

  const [newBookName, setNewBookName] = useState('');
  const [draft, setDraft] = useState<{ title: string; content: string; keywords: string; constant: boolean } | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['lorebooks'] });
    await queryClient.invalidateQueries({ queryKey: ['lore-entries'] });
    await queryClient.invalidateQueries({ queryKey: ['lore-attachments'] });
  };

  const addBook = async () => {
    if (!newBookName.trim()) return;
    const book = await createLorebook(newBookName.trim());
    setNewBookName('');
    await refresh();
    setOpenBookId(book.id);
  };

  const addEntry = async () => {
    if (!openBookId || !draft) return;
    await createLoreEntry({
      bookId: openBookId,
      title: draft.title.trim() || 'Lore',
      content: draft.content,
      keywordsPrimary: draft.keywords.split(',').map((s) => s.trim()).filter(Boolean),
      keywordsSecondary: [],
      regexes: [],
      constant: draft.constant,
      priority: 50,
      scanDepth: 2,
    });
    setDraft(null);
    await refresh();
  };

  const attach = async (bookId: string, scope: 'global' | 'character', scopeId: string | null) => {
    await setLoreAttachment(bookId, scope, scopeId);
    await refresh();
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Lorebooks</h1>
        <div className="page-head-actions">
          <input
            type="text"
            placeholder="New lorebook name"
            value={newBookName}
            onChange={(e) => setNewBookName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addBook();
            }}
          />
          <button type="button" className="m3-button m3-button-filled" onClick={() => void addBook()} disabled={!newBookName.trim()}>
            New lorebook
          </button>
        </div>
      </div>
      <p className="field-hint">
        Entries trigger when their keywords appear in recent messages; triggered entries are injected into the prompt
        (visible in the Inspector). Attach a book globally or to a character.
      </p>

      <div className="char-grid">
        {books.data?.map((b) => {
          const bookAttachments = attachments.data?.filter((a) => a.book_id === b.id) ?? [];
          return (
            <Card key={b.id} variant="elevated" className="char-card">
              <div className="char-card-head">
                <div className="char-avatar" aria-hidden="true">📖</div>
                <div>
                  <h3 style={{ margin: 0, font: 'var(--md-sys-typescale-title-md)' }}>{b.name}</h3>
                  <span className="char-tokens">{b.entry_count} entries</span>
                </div>
              </div>
              <div className="char-tags">
                {bookAttachments.map((a) => (
                  <span key={a.id} className="chip">
                    {a.scope === 'global' ? 'global' : `character: ${characters.data?.find((c) => c.id === a.scope_id)?.name ?? a.scope_id}`}
                    <button
                      type="button"
                      className="chip-remove"
                      aria-label="Remove attachment"
                      onClick={() => {
                        void removeLoreAttachment(a.id).then(refresh);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {bookAttachments.length === 0 && <span className="field-hint">Not attached anywhere yet.</span>}
              </div>
              <div className="page-head-actions">
                <select
                  aria-label={`Attach ${b.name}`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value === 'global') void attach(b.id, 'global', null);
                    else if (e.target.value) void attach(b.id, 'character', e.target.value);
                  }}
                >
                  <option value="">Attach to…</option>
                  <option value="global">🌐 Global (all chats)</option>
                  {characters.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="char-card-actions">
                <button
                  type="button"
                  className="m3-button m3-button-tonal"
                  onClick={() => setOpenBookId(openBookId === b.id ? null : b.id)}
                >
                  {openBookId === b.id ? 'Close' : 'Open entries'}
                </button>
                <button
                  type="button"
                  className="m3-button m3-button-text char-delete"
                  onClick={() => {
                    if (confirm(`Delete lorebook ${b.name} and all its entries?`)) {
                      void deleteLorebook(b.id).then(refresh);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {openBookId && (
        <section className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: 0 }}>Entries</h2>
            <button
              type="button"
              className="m3-button m3-button-filled"
              onClick={() => setDraft({ title: '', content: '', keywords: '', constant: false })}
            >
              + Add entry
            </button>
          </div>
          {draft && (
            <Card variant="outlined" className="settings-section">
              <label className="field">
                <span className="field-label">Title</span>
                <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Content (injected when triggered)</span>
                <textarea rows={4} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Keywords (comma-separated)</span>
                <input type="text" value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} placeholder="bridge, ravine" />
              </label>
              <label className="m3-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.constant}
                  onChange={(e) => setDraft({ ...draft, constant: e.target.checked })}
                />
                <span className="m3-switch-track" aria-hidden="true"><span className="m3-switch-thumb" /></span>
                <span className="m3-switch-label">Always on (constant)</span>
              </label>
              <div className="dialog-actions">
                <button type="button" className="m3-button m3-button-text" onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button type="button" className="m3-button m3-button-filled" onClick={() => void addEntry()} disabled={!draft.content.trim()}>
                  Save entry
                </button>
              </div>
            </Card>
          )}
          <ul className="memory-list">
            {entries.data?.map((e: LoreEntryRow) => (
              <li key={e.id} className="memory-item">
                <span className="memory-text">
                  <strong>{e.title}</strong> · {e.content}
                  <span className="field-tokens">
                    {' '}
                    {e.constant ? '· constant' : `· keywords ${e.keywords_primary}`}
                  </span>
                </span>
                <button
                  type="button"
                  className="m3-button m3-button-text char-delete"
                  aria-label={`Delete ${e.title}`}
                  onClick={() => void deleteLoreEntry(e.id).then(refresh)}
                >
                  ✕
                </button>
              </li>
            ))}
            {entries.data?.length === 0 && <li className="field-hint">No entries yet.</li>}
          </ul>
        </section>
      )}
    </section>
  );
}
