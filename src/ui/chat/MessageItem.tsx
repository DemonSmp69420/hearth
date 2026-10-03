import { useEffect, useState } from 'react';
import type { Message } from '../../domain/types';
import { renderRoleplay } from './roleplay';
import { useChat } from '../../stores/chat';
import { useSession } from '../../stores/session';
import { RewriteRow } from './RewriteRow';

function formatTokens(n: number | null): string | null {
  return n === null || n === undefined ? null : `~${n} tok`;
}

/** M5.2: display info for the group member who spoke an assistant message. */
export interface SpeakerInfo {
  name: string;
  color: string;
  avatar: string | null;
}

export function MessageItem({
  message,
  siblings,
  siblingIndex,
  streamText,
  chips = [],
  speaker = null,
}: {
  message: Message;
  siblings: number;
  siblingIndex: number;
  streamText?: string;
  chips?: string[];
  speaker?: SpeakerInfo | null;
}) {
  const { editMessage, deleteMessage, branchFrom, forkToNewChat, switchToSibling, regenerateMessage, toggleBookmark, stream, startChapterAt } =
    useChat();
  const character = useChat((s) => s.character);
  const typewriter = useSession((s) => s.reading.typewriter);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [revealed, setRevealed] = useState(0);

  // Typewriter pacing (M4.5): clamp-reveal the in-flight text over time.
  const live = streamText !== undefined && typewriter > 0;
  useEffect(() => {
    if (!live) {
      setRevealed(0);
      return;
    }
    const total = streamText?.length ?? 0;
    setRevealed((r) => Math.min(r, total));
    const step = typewriter === 1 ? 4 : 2;
    const id = window.setInterval(() => {
      setRevealed((r) => (r >= total ? r : Math.min(total, r + step)));
    }, 30);
    return () => window.clearInterval(id);
  }, [live, streamText, typewriter]);

  const full = streamText ?? message.content;
  const content = live ? full.slice(0, revealed) : full;
  const busy = stream !== null;

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };

  return (
    <article className={`msg msg-${message.role} ${message.deleted_at ? 'msg-deleted' : ''}`}>
      <div className="msg-avatar" aria-hidden="true">
        {message.role === 'user'
          ? 'You'
          : (speaker?.avatar ?? character?.avatar_path)
            ? <img src={speaker?.avatar ?? character?.avatar_path ?? ''} alt="" />
            : (speaker?.name ?? 'AI').slice(0, 1).toUpperCase()}
      </div>
      <div className="msg-body">
        {speaker && (
          <div className="msg-speaker" style={{ color: speaker.color }}>
            {speaker.name}
          </div>
        )}
        {editing ? (
          <div className="msg-edit">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(12, draft.split('\n').length + 2)}
              aria-label="Edit message"
            />
            <RewriteRow text={draft} onResult={setDraft} />
            <div className="msg-edit-actions">
              <button type="button" className="m3-button m3-button-filled" disabled={busy} onClick={() => { void editMessage(message.id, draft, false); setEditing(false); }}>
                Save
              </button>
              <button type="button" className="m3-button m3-button-tonal" disabled={busy} onClick={() => { void editMessage(message.id, draft, true); setEditing(false); }}>
                Save as new branch
              </button>
              <button type="button" className="m3-button m3-button-text" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="msg-content">{renderRoleplay(content)}</div>
        )}

        {chips.length > 0 && (
          <div className="msg-ledger-chips">
            {chips.map((chip, i) => (
              <span key={i} className="chip">{chip}</span>
            ))}
          </div>
        )}

        <div className="msg-footer">
          {siblings > 1 && (
            <span className="msg-swipes">
              <button type="button" aria-label="Previous swipe" disabled={siblingIndex <= 0 || busy} onClick={() => void switchToSibling(message.id, -1)}>‹</button>
              <span>{siblingIndex + 1}/{siblings}</span>
              <button type="button" aria-label="Next swipe" disabled={siblingIndex >= siblings - 1 || busy} onClick={() => void switchToSibling(message.id, 1)}>›</button>
            </span>
          )}
          <span className="msg-meta">
            {message.model && <span>{message.model}</span>}
            {formatTokens(message.prompt_tokens) && <span>{formatTokens(message.prompt_tokens)} in</span>}
            {formatTokens(message.completion_tokens) && <span>{formatTokens(message.completion_tokens)} out</span>}
            {message.latency_ms !== null && <span>{(message.latency_ms / 1000).toFixed(1)}s</span>}
            {message.status === 'interrupted' && <span className="msg-warn">interrupted</span>}
            {message.status === 'failed' && <span className="msg-error">failed</span>}
          </span>
          {!editing && (
            <span className="msg-actions">
              <button type="button" title="Edit" disabled={busy} onClick={startEdit}>Edit</button>
              {message.role === 'assistant' && (
                <button
                  type="button"
                  title="Regenerate as a new swipe (keeps this reply on its own branch)"
                  disabled={busy}
                  onClick={() => void regenerateMessage(message.id)}
                >
                  Regenerate
                </button>
              )}
              <span className="msg-menu-anchor">
                <button type="button" title="Bookmark" className={message.bookmarked ? 'msg-bookmarked' : undefined} onClick={() => void toggleBookmark(message.id, message.bookmarked !== 1)}>
                  {message.bookmarked ? '★' : '☆'}
                </button>
                <button type="button" title="More" onClick={() => setMenuOpen((v) => !v)}>⋯</button>
                {menuOpen && (
                  <span className="msg-menu" role="menu">
                    <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); void branchFrom(message.id); }}>
                      Branch from here
                    </button>
                    <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); void forkToNewChat(message.id); }}>
                      Fork into new chat
                    </button>
                    <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); void startChapterAt(message.id); }}>
                      Start a new chapter here
                    </button>
                    <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); void deleteMessage(message.id, false); }}>
                      Delete message
                    </button>
                    <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); void deleteMessage(message.id, true); }}>
                      Delete from here down
                    </button>
                  </span>
                )}
              </span>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
