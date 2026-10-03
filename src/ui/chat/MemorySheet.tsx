import { useMemo, useState } from 'react';
import { useChat } from '../../stores/chat';
import { estimator } from '../../domain/tokens/estimator';
import { activePath } from '../../domain/tree/tree';
import { foldLedger, threadsForDisplay, type ThreadStatus } from '../../domain/ledger/fold';
import { useSheetA11y } from '../../hooks/useSheetA11y';

/** Layered-memory side sheet (§7/§9.5): pinned facts, ledger, summaries. */
export function MemorySheet({ onClose }: { onClose: () => void }) {
  const sheetRef = useSheetA11y(onClose);
  const {
    memoryItems,
    summary,
    persona,
    addMemory,
    updateMemory,
    deleteMemory,
    summarizeNow,
    deleteSummaryRow,
    setThreadStatus,
    deleteThread,
    updateScene,
    setLedgerEnabled,
    resolveSuggestion,
    suggestions,
    genSettings,
    busy,
    chapters,
    renameChapter,
    deleteChapter,
    summarizeChapter,
    summarizeMissingChapters,
    checkConsistency,
  } = useChat();
  const messages = useChat((s) => s.messages);
  const activeLeafId = useChat((s) => s.activeLeafId);
  const ledgerEvents = useChat((s) => s.ledgerEvents);
  const [newFact, setNewFact] = useState('');
  const [importance, setImportance] = useState(2);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [newThread, setNewThread] = useState('');
  const { addThreadManual } = useChat.getState();

  const fold = useMemo(
    () => foldLedger(ledgerEvents, activePath(messages, activeLeafId).map((m) => m.id)),
    [ledgerEvents, messages, activeLeafId],
  );
  const threads = threadsForDisplay(fold).filter((t) =>
    filter === 'open' ? t.status === 'pending' || t.status === 'active' || t.status === 'suggested' : true,
  );

  const personaFacts = persona
    ? [
        persona.role && `Role: ${persona.role}`,
        persona.personality && `Personality: ${persona.personality}`,
        persona.backstory && `Backstory: ${persona.backstory}`,
        persona.preferences && `Preferences: ${persona.preferences}`,
      ].filter(Boolean)
    : [];

  const statusButton = (threadId: string, status: ThreadStatus, label: string) => (
    <button
      type="button"
      className="m3-button m3-button-tonal"
      onClick={() => void setThreadStatus(threadId, status)}
    >
      {label}
    </button>
  );

  return (
    <div className="proxy-backdrop" onClick={onClose}>
      <aside
        ref={sheetRef}
        tabIndex={-1}
        className="proxy-sheet"
        role="dialog"
        aria-label="Memory"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="proxy-head">
          <h2>Memory</h2>
          <button type="button" className="m3-button m3-button-text" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <section className="proxy-section">
          <h3>Persona (from the persona card)</h3>
          {personaFacts.length > 0 ? (
            <ul className="memory-list">
              {personaFacts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : (
            <span className="field-hint">No persona selected — switch one in the header.</span>
          )}
        </section>

        <section className="proxy-section">
          <h3>Pinned facts (this chat)</h3>
          <p className="field-hint">Always sent to the model. Never trimmed.</p>
          <ul className="memory-list">
            {memoryItems.map((m) => (
              <li key={m.id} className="memory-item">
                <input
                  type="checkbox"
                  role="switch"
                  checked={m.enabled === 1}
                  onChange={(e) => void updateMemory(m.id, { enabled: e.target.checked })}
                  aria-label={`Enable ${m.text.slice(0, 30)}`}
                />
                <span className={m.enabled === 1 ? 'memory-text' : 'memory-text disabled'}>
                  {m.text} <span className="field-tokens">≈ {estimator.estimate(m.text)} tok · {m.scope}</span>
                </span>
                <select
                  value={m.importance}
                  onChange={(e) => void updateMemory(m.id, { importance: Number(e.target.value) })}
                  aria-label="Importance"
                >
                  <option value={1}>low</option>
                  <option value={2}>normal</option>
                  <option value={3}>high</option>
                </select>
                <button
                  type="button"
                  className="m3-button m3-button-text char-delete"
                  aria-label="Delete fact"
                  onClick={() => void deleteMemory(m.id)}
                >
                  ✕
                </button>
              </li>
            ))}
            {memoryItems.length === 0 && <li className="field-hint">No pinned facts yet.</li>}
          </ul>
          <div className="proxy-add-row">
            <input
              type="text"
              placeholder='e.g. "Sam is the knight-captain of Vale"'
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFact.trim()) {
                  void addMemory(newFact, importance);
                  setNewFact('');
                }
              }}
            />
            <select value={importance} onChange={(e) => setImportance(Number(e.target.value))} aria-label="Importance">
              <option value={1}>low</option>
              <option value={2}>normal</option>
              <option value={3}>high</option>
            </select>
            <button
              type="button"
              className="m3-button m3-button-tonal"
              disabled={!newFact.trim()}
              onClick={() => {
                void addMemory(newFact, importance);
                setNewFact('');
              }}
            >
              Pin
            </button>
          </div>
        </section>

        <section className="proxy-section">
          <h3>Chapters</h3>
          {chapters.length === 0 ? (
            <span className="field-hint">
              No chapters yet — open the ⋯ menu on any message and pick “Start a new chapter here”.
            </span>
          ) : (
            <div className="chapter-list">
              {chapters.map((c) => (
                <div key={c.id} className="chapter-item">
                  <input
                    className="chapter-title"
                    defaultValue={c.title}
                    aria-label="Chapter title"
                    onBlur={(e) => {
                      const t = e.target.value.trim();
                      if (t && t !== c.title) void renameChapter(c.id, t);
                    }}
                  />
                  <p className="chapter-summary">{c.summary ?? 'No summary yet.'}</p>
                  <div className="chapter-actions">
                    <button
                      type="button"
                      className="m3-button m3-button-tonal"
                      disabled={busy}
                      title="Generate (or refresh) this chapter's summary with the utility model"
                      onClick={() => void summarizeChapter(c.id)}
                    >
                      {c.summary ? 'Refresh summary' : 'Summarize'}
                    </button>
                    <button
                      type="button"
                      className="m3-button m3-button-text char-delete"
                      aria-label={`Delete ${c.title}`}
                      onClick={() => void deleteChapter(c.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {chapters.some((c) => !c.summary) && (
            <button
              type="button"
              className="m3-button m3-button-tonal"
              disabled={busy}
              onClick={() => void summarizeMissingChapters()}
            >
              Previously on… (fill missing summaries)
            </button>
          )}
          <button
            type="button"
            className="m3-button m3-button-text"
            disabled={busy}
            title="Re-scan the latest reply against pinned facts (no AI call)"
            onClick={() => void checkConsistency()}
          >
            Check consistency now
          </button>
          {chapters.some((c) => c.summary) && (
            <details className="chapter-recap">
              <summary>Previously on…</summary>
              <div className="chapter-recap-body">
                {chapters
                  .filter((c) => c.summary)
                  .map((c) => (
                    <p key={c.id}>
                      <strong>{c.title}.</strong> {c.summary}
                    </p>
                  ))}
              </div>
            </details>
          )}
        </section>

        <section className="proxy-section">
          <h3>Story ledger</h3>
          <div className="settings-row">
            <label className="m3-switch">
              <input
                type="checkbox"
                role="switch"
                checked={genSettings.ledger?.enabled !== false}
                onChange={(e) => void setLedgerEnabled(e.target.checked)}
              />
              <span className="m3-switch-track" aria-hidden="true"><span className="m3-switch-thumb" /></span>
              <span className="m3-switch-label">Threads &amp; quests enabled</span>
            </label>
            <span className="field-hint">
              {genSettings.ledger?.enabled === false
                ? 'Off — threads are hidden from the AI and not tracked. Nothing is deleted.'
                : 'On — open threads are sent to the AI and tracked automatically.'}
            </span>
          </div>
          <div className="settings-row">
            <div className="m3-segmented" role="radiogroup" aria-label="Thread filter">
              {(['open', 'all'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={filter === f}
                  className={filter === f ? 'm3-segment selected' : 'm3-segment'}
                  onClick={() => setFilter(f)}
                >
                  {f === 'open' ? 'Open' : 'All'}
                </button>
              ))}
            </div>
          </div>
          <ul className="memory-list">
            {threads.map((t) => (
              <li key={t.id} className="memory-item ledger-thread">
                <span className="memory-text">
                  <strong>{t.displayId}</strong> {t.title}{' '}
                  <span className="field-tokens">
                    {t.kind} · {t.status} · importance {t.importance}
                  </span>
                  {t.evidence && <span className="field-hint"> — {t.evidence}</span>}
                </span>
                <span className="page-head-actions">
                  {t.status !== 'fulfilled' && statusButton(t.id, 'fulfilled', 'Resolve')}
                  {t.status !== 'abandoned' && statusButton(t.id, 'abandoned', 'Drop')}
                  <button
                    type="button"
                    className="m3-button m3-button-text char-delete"
                    aria-label={`Delete ${t.title}`}
                    onClick={() => void deleteThread(t.id)}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
            {threads.length === 0 && (
              <li className="field-hint">
                {filter === 'open' ? 'No open threads.' : 'No threads yet — they appear when the story makes promises or sets goals.'}
              </li>
            )}
          </ul>
          <div className="proxy-add-row">
            <input
              type="text"
              placeholder='Add a thread manually, e.g. "Return the crown"'
              value={newThread}
              onChange={(e) => setNewThread(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newThread.trim()) {
                  void addThreadManual(newThread);
                  setNewThread('');
                }
              }}
            />
            <button
              type="button"
              className="m3-button m3-button-tonal"
              disabled={!newThread.trim()}
              onClick={() => {
                void addThreadManual(newThread);
                setNewThread('');
              }}
            >
              Add
            </button>
          </div>
          {Object.keys(fold.scene).length > 0 && (
            <div className="scene-fields">
              <span className="field-label">Scene</span>
              {Object.entries(fold.scene).map(([field, value]) => (
                <label key={field} className="scene-field">
                  <span className="field-tokens">{field}</span>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => void updateScene(field, e.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
        </section>

        {suggestions.length > 0 && (
          <section className="proxy-section">
            <h3>Suggestions from the Director</h3>
            <ul className="memory-list">
              {suggestions.map((s) => {
                const payload = (() => {
                  try { return JSON.parse(s.payload) as { text?: string }; } catch { return {}; }
                })();
                return (
                  <li key={s.id} className="memory-item">
                    <span className="memory-text">{payload.text ?? '(suggestion)'}</span>
                    <button type="button" className="m3-button m3-button-tonal" onClick={() => void resolveSuggestion(s.id, true)}>
                      Save
                    </button>
                    <button type="button" className="m3-button m3-button-text char-delete" onClick={() => void resolveSuggestion(s.id, false)}>
                      Dismiss
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="proxy-section">
          <h3>Rolling summary</h3>
          {summary ? (
            <>
              <p className="memory-summary">{summary.content}</p>
              <div className="page-head-actions">
                <button type="button" className="m3-button m3-button-tonal" disabled={busy} onClick={() => void summarizeNow()}>
                  {busy ? 'Summarizing…' : 'Regenerate'}
                </button>
                <button type="button" className="m3-button m3-button-text char-delete" onClick={() => void deleteSummaryRow()}>
                  Delete
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="field-hint">
                None yet. A summary compresses older history so long chats stay in budget.
              </span>
              <button type="button" className="m3-button m3-button-tonal" disabled={busy} onClick={() => void summarizeNow()}>
                {busy ? 'Summarizing…' : 'Summarize now'}
              </button>
            </>
          )}
          <span className="field-hint">Uses the utility model slot (set it in Providers).</span>
        </section>
      </aside>
    </div>
  );
}
