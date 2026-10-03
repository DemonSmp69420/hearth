import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OutputRule } from '../../domain/types';
import { uuidv7 } from '../../domain/util/id';
import { listProviderProfiles } from '../../services/db/queries';
import { useChat } from '../../stores/chat';
import { Switch } from '../components/m3/Switch';
import { useSheetA11y } from '../../hooks/useSheetA11y';

/**
 * The "Proxy" pill's side sheet: per-chat aggregator/model override,
 * generation params, context budget, and named prompts (D-025 — one prompt
 * concept: pills, tap to select, edit button, ✓ marks the active one).
 */
export function ProxyPanel({ onClose }: { onClose: () => void }) {
  const sheetRef = useSheetA11y(onClose);
  const {
    character,
    genSettings,
    modelOverride,
    prompts,
    activePromptId,
    members,
    saveGenParams,
    saveContextTokens,
    saveModelOverride,
    saveAccent,
    setTurnOrder,
    saveOutputRules,
    setNextBeatsEnabled,
    setConsistencyEnabled,
    refreshPrompts,
    addPrompt,
    updatePrompt,
    deletePrompt,
    selectPrompt,
  } = useChat();

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: listProviderProfiles });
  const [modelDraft, setModelDraft] = useState(modelOverride?.model ?? '');
  const [overrideProfileId, setOverrideProfileId] = useState(modelOverride?.profile_id ?? '');
  const [addingName, setAddingName] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    void refreshPrompts();
  }, [refreshPrompts]);

  const params = genSettings.params ?? {};
  const contextTokens = genSettings.context_tokens ?? 0;
  const editing = prompts.find((p) => p.id === editingId) ?? null;

  const openEditor = (id: string) => {
    // read from the store, not the render closure — this often runs right
    // after a prompt was created and the component hasn't re-rendered yet
    const prompt = useChat.getState().prompts.find((p) => p.id === id);
    if (!prompt) return;
    setEditingId(id);
    setEditName(prompt.name);
    setEditContent(prompt.data.content ?? '');
  };

  const saveEditor = () => {
    if (!editingId) return;
    void updatePrompt(editingId, {
      name: editName.trim() || 'Prompt',
      content: editContent,
    });
    setEditingId(null);
  };

  const confirmAdd = () => {
    if (!addingName?.trim()) {
      setAddingName(null);
      return;
    }
    void addPrompt(addingName.trim()).then((id) => {
      if (id) openEditor(id);
    });
    setAddingName(null);
  };

  return (
    <div className="proxy-backdrop" onClick={onClose}>
      <aside
        ref={sheetRef}
        tabIndex={-1}
        className="proxy-sheet"
        role="dialog"
        aria-label="Chat model and prompt settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="proxy-head">
          <h2>Proxy</h2>
          <button type="button" className="m3-button m3-button-text" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <section className="proxy-section">
          <h3>Aggregator &amp; model</h3>
          <p className="field-hint">
            Overrides the global main slot for this chat only. Empty = use the global default.
          </p>
          <label className="field">
            <span className="field-label">Provider</span>
            <select
              value={overrideProfileId}
              onChange={(e) => {
                setOverrideProfileId(e.target.value);
                void saveModelOverride(e.target.value || null, modelDraft);
              }}
            >
              <option value="">(global default)</option>
              {profiles.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <input
              type="text"
              value={modelDraft}
              placeholder="(profile default)"
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={() => void saveModelOverride(overrideProfileId || null, modelDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
        </section>

        <section className="proxy-section">
          <h3>Generation</h3>
          <label className="field">
            <span className="field-label">
              Temperature <span className="field-tokens">{params.temperature ?? 0.8}</span>
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={params.temperature ?? 0.8}
              onChange={(e) => void saveGenParams({ temperature: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span className="field-label">
              Top P <span className="field-tokens">{params.top_p ?? 1}</span>
            </span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={params.top_p ?? 1}
              onChange={(e) => void saveGenParams({ top_p: Number(e.target.value) })}
            />
          </label>
          <div className="proxy-grid-2">
            <label className="field">
              <span className="field-label">Max reply tokens</span>
              <input
                type="number"
                min={16}
                step={16}
                value={params.max_tokens ?? ''}
                placeholder="(provider default)"
                onChange={(e) =>
                  void saveGenParams({
                    max_tokens: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Context limit (tokens)</span>
              <input
                type="number"
                min={0}
                step={256}
                value={contextTokens || ''}
                placeholder="(no limit)"
                onChange={(e) => void saveContextTokens(Number(e.target.value) || 0)}
              />
            </label>
          </div>
          <p className="field-hint">
            Context limit trims oldest history to fit (estimate); 0 = send everything.
          </p>
        </section>

        {members.length > 0 && (
          <section className="proxy-section">
            <h3>Group</h3>
            <label className="field">
              <span className="field-label">Turn order</span>
              <select
                value={genSettings.group?.turnOrder ?? 'round-robin'}
                onChange={(e) => void setTurnOrder(e.target.value as 'manual' | 'round-robin' | 'auto')}
              >
                <option value="round-robin">Round-robin (take turns)</option>
                <option value="auto">Auto (@Name mention, else turns)</option>
                <option value="manual">Manual (you pick who speaks)</option>
              </select>
            </label>
            <p className="field-hint">
              One cast member replies per message. Mute or remove members from the cast bar above
              the chat; in Manual mode use the “Who speaks next” chips by the composer. Start a
              message with <code>@Name</code> in Auto mode to call on someone specific.
            </p>
          </section>
        )}

        <OutputRulesSection
          rules={genSettings.outputRules ?? []}
          onSave={saveOutputRules}
          speakers={[
            { id: character?.id ?? '', name: `${character?.name ?? 'Character'} (lead)` },
            ...members.map((m) => ({ id: m.character_id, name: m.name })),
          ].filter((s) => s.id)}
        />

        <section className="proxy-section">
          <h3>Appearance</h3>
          <Switch
            checked={genSettings.accent?.enabled === true}
            onChange={(v) => void saveAccent(v)}
            label="Character accent color"
          />
          <Switch
            checked={genSettings.nextBeats?.enabled === true}
            onChange={(v) => void setNextBeatsEnabled(v)}
            label="Suggest next beats (chips above the composer)"
          />
          <Switch
            checked={genSettings.consistency?.enabled !== false}
            onChange={(v) => void setConsistencyEnabled(v)}
            label="Consistency guard (warn on contradictions)"
          />
          <p className="field-hint">
            Tints this chat's buttons and highlights with a color derived from{' '}
            <strong>{character?.name ?? 'the character'}</strong>'s name. Off = use the app theme.
          </p>
        </section>

        <section className="proxy-section">
          <h3>Prompts</h3>
          <p className="field-hint">
            Tap a prompt to use it in this chat (✓ = active, replaces the default intro — the
            character card is always included). Tap again to go back to the default.{' '}
            <button type="button" className="pill-add" onClick={() => setAddingName('')}>
              + Add
            </button>
          </p>
          {addingName !== null && (
            <div className="pill-add-row">
              <input
                type="text"
                autoFocus
                placeholder="Prompt name"
                value={addingName}
                onChange={(e) => setAddingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmAdd();
                  if (e.key === 'Escape') setAddingName(null);
                }}
              />
              <button type="button" className="m3-button m3-button-filled" onClick={confirmAdd}>
                ✓
              </button>
            </div>
          )}
          <div className="prompt-pills">
            {prompts.map((p) => {
              const active = p.id === activePromptId;
              return (
                <span key={p.id} className="prompt-pill-wrap">
                  <button
                    type="button"
                    className={active ? 'prompt-pill active' : 'prompt-pill'}
                    onClick={() => void selectPrompt(active ? null : p.id)}
                    aria-pressed={active}
                    title={active ? 'Active — tap to stop using it' : 'Tap to use in this chat'}
                  >
                    {active && <span className="pill-check" aria-hidden="true">✓</span>}
                    {p.name}
                  </button>
                  <button
                    type="button"
                    className="pill-edit"
                    aria-label={`Edit ${p.name}`}
                    title="Edit prompt"
                    onClick={() => openEditor(p.id)}
                  >
                    ✎
                  </button>
                </span>
              );
            })}
            {prompts.length === 0 && (
              <span className="field-hint">No prompts yet — add one above.</span>
            )}
          </div>

          {editing && (
            <div className="prompt-editor">
              <label className="field">
                <span className="field-label">Name</span>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  Content <span className="field-tokens">macros like {'{{char}}'} / {'{{user}}'} work</span>
                </span>
                <textarea
                  rows={8}
                  value={editContent}
                  placeholder="e.g. You are {{char}}. Keep replies short, poetic, and always end with a question…"
                  onChange={(e) => setEditContent(e.target.value)}
                />
              </label>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="m3-button m3-button-text char-delete"
                  onClick={() => {
                    void deletePrompt(editing.id);
                    setEditingId(null);
                  }}
                >
                  Delete
                </button>
                <button type="button" className="m3-button m3-button-text" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
                <button type="button" className="m3-button m3-button-filled" onClick={saveEditor}>
                  Save
                </button>
              </div>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

/** M5.6: ordered find/replace rewrites applied to AI output / user input. */
function OutputRulesSection({
  rules,
  onSave,
  speakers,
}: {
  rules: OutputRule[];
  onSave: (rules: OutputRule[]) => Promise<void>;
  speakers: { id: string; name: string }[];
}) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [regex, setRegex] = useState(false);
  const [direction, setDirection] = useState<'out' | 'in'>('out');

  const patch = (id: string, over: Partial<OutputRule>) => {
    void onSave(rules.map((r) => (r.id === id ? { ...r, ...over } : r)));
  };

  const add = () => {
    if (!find.trim()) return;
    void onSave([
      ...rules,
      {
        id: uuidv7(),
        find: find.trim(),
        replace,
        regex,
        direction,
        characterId: null,
        enabled: true,
      },
    ]);
    setFind('');
    setReplace('');
  };

  return (
    <section className="proxy-section">
      <h3>Output rules</h3>
      {rules.length === 0 ? (
        <p className="field-hint" style={{ marginTop: 0 }}>
          No rules. Add one to auto-fix the AI's (or your) text on every message — e.g. swap a
          wrong name or censor a phrase.
        </p>
      ) : (
        <div className="rule-list">
          {rules.map((r) => (
            <div key={r.id} className={r.enabled ? 'rule-item' : 'rule-item disabled'}>
              <code className="rule-match">{r.find || '(empty)'}</code>
              <span aria-hidden="true">→</span>
              <code className="rule-match">{r.replace || '(nothing)'}</code>
              <select
                value={r.direction}
                aria-label="Apply to"
                onChange={(e) => patch(r.id, { direction: e.target.value as 'out' | 'in' })}
              >
                <option value="out">AI output</option>
                <option value="in">My messages</option>
              </select>
              <select
                value={r.characterId ?? ''}
                aria-label="Speaker scope"
                onChange={(e) => patch(r.id, { characterId: e.target.value || null })}
              >
                <option value="">Any speaker</option>
                {speakers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="m3-button m3-button-text"
                title={r.enabled ? 'Disable rule' : 'Enable rule'}
                onClick={() => patch(r.id, { enabled: !r.enabled })}
              >
                {r.enabled ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                className="m3-button m3-button-text char-delete"
                aria-label="Delete rule"
                onClick={() => void onSave(rules.filter((x) => x.id !== r.id))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="rule-add">
        <input
          placeholder={regex ? 'Find (regex)…' : 'Find…'}
          value={find}
          onChange={(e) => setFind(e.target.value)}
          aria-label="Find text"
        />
        <input placeholder="Replace with…" value={replace} onChange={(e) => setReplace(e.target.value)} aria-label="Replace with" />
        <label className="rule-regex">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> regex
        </label>
        <select value={direction} aria-label="Apply to" onChange={(e) => setDirection(e.target.value as 'out' | 'in')}>
          <option value="out">AI output</option>
          <option value="in">My messages</option>
        </select>
        <button type="button" className="m3-button m3-button-tonal" disabled={!find.trim()} onClick={add}>
          Add rule
        </button>
      </div>
      <p className="field-hint">
        Rules run top to bottom on every message. “AI output” rewrites replies when they finish
        (speaker scope only matters in group chats); “My messages” rewrites your text as you send.
      </p>
    </section>
  );
}
