import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../../stores/session';
import { useChat } from '../../stores/chat';
import { listCharacters, searchMessages, type SearchFilters } from '../../services/db/queries';

/**
 * Global search (M4.3): FTS5 across every chat with filters — character,
 * role, bookmarked-only, date range. Click a hit to open that chat at the
 * message.
 */
export function SearchView() {
  const [query, setQuery] = useState('');
  const [characterId, setCharacterId] = useState('');
  const [role, setRole] = useState('');
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [after, setAfter] = useState('');
  const [before, setBefore] = useState('');

  const characters = useQuery({ queryKey: ['search-characters'], queryFn: listCharacters });

  const filters = useMemo<SearchFilters>(() => ({
    characterId: characterId || undefined,
    role: role ? (role as SearchFilters['role']) : undefined,
    bookmarkedOnly,
    after: after ? new Date(after).getTime() : undefined,
    before: before ? new Date(before).getTime() + 24 * 3600 * 1000 - 1 : undefined,
  }), [characterId, role, bookmarkedOnly, after, before]);

  const trimmed = query.trim();
  const hits = useQuery({
    queryKey: ['search', trimmed, filters],
    queryFn: () => searchMessages(trimmed, filters),
    enabled: trimmed.length > 0,
  });

  const openHit = (chatId: string, messageId: string) => {
    void useChat.getState().openChat(chatId).then(() => useChat.getState().jumpToNode(messageId));
    useSession.getState().setView('chats');
  };

  return (
    <section className="page search-view">
      <h1>Search</h1>
      <input
        className="search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search every conversation…"
        aria-label="Search messages"
        autoFocus
      />

      <div className="search-filters">
        <select value={characterId} onChange={(e) => setCharacterId(e.target.value)} aria-label="Filter by character">
          <option value="">Any character</option>
          {(characters.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
          <option value="">Any role</option>
          <option value="user">User</option>
          <option value="assistant">AI</option>
          <option value="narrator">Narrator</option>
          <option value="system">System</option>
        </select>
        <label className="search-filter-check">
          <input type="checkbox" checked={bookmarkedOnly} onChange={(e) => setBookmarkedOnly(e.target.checked)} />
          <span>Bookmarked only</span>
        </label>
        <label>
          From
          <input type="date" value={after} onChange={(e) => setAfter(e.target.value)} aria-label="From date" />
        </label>
        <label>
          To
          <input type="date" value={before} onChange={(e) => setBefore(e.target.value)} aria-label="To date" />
        </label>
      </div>

      <div className="search-results">
        {trimmed.length === 0 && (
          <p className="field-hint">Type to search across all chats. Results show the matching passage in context.</p>
        )}
        {trimmed.length > 0 && hits.isLoading && <p className="field-hint">Searching…</p>}
        {hits.data?.length === 0 && <p className="field-hint">No matches.</p>}
        {(hits.data ?? []).map((hit) => (
          <button key={hit.id} type="button" className="search-hit" onClick={() => openHit(hit.chat_id, hit.id)}>
            <span className="search-hit-meta">
              <strong>{hit.character_name}</strong>
              <span> · {hit.chat_title} · {hit.role} · {new Date(hit.created_at).toLocaleDateString()}</span>
            </span>
            <span
              className="search-hit-snippet"
              // Snippets come from our own SQLite via snippet(); markers «» are
              // inserted by that function around matches.
              dangerouslySetInnerHTML={{
                __html: hit.snippet
                  .replaceAll('&', '&amp;')
                  .replaceAll('<', '&lt;')
                  .replaceAll('>', '&gt;')
                  .replaceAll('«', '<mark>')
                  .replaceAll('»', '</mark>'),
              }}
            />
          </button>
        ))}
      </div>
    </section>
  );
}
