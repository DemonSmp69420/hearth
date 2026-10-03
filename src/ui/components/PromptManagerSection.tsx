import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Switch } from './m3/Switch';
import {
  createPromptEntry,
  listCharacters,
  listPromptEntries,
  reorderPromptEntries,
  softDeletePromptEntry,
  updatePromptEntry,
  type PromptEntryRow,
} from '../../services/db/queries';

const ANCHOR_BLOCKS = ['system', 'character', 'persona', 'memory', 'lore', 'summary', 'example', 'history'];

function anchorLabel(a: string): string {
  if (a === 'depth') return 'At depth N from the end';
  const [side, target = 'history'] = a.split(':');
  return `${side === 'before' ? 'Before' : 'After'} ${target}`;
}

function scopeLabel(r: PromptEntryRow): string {
  if (r.scope === 'global') return 'Global';
  return r.scope === 'character' ? 'Character' : 'Chat';
}

/**
 * M4.10: manager for advanced prompt entries (F17 / §8.6) — drag-reorder,
 * enable/lock, anchor & depth positioning, timed effects, trim priority.
 */
export function PromptManagerSection() {
  const entries = useQuery({ queryKey: ['promptEntries'], queryFn: listPromptEntries });
  const characters = useQuery({ queryKey: ['characters'], queryFn: listCharacters });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<'global' | 'character'>('global');
  const [newScopeChar, setNewScopeChar] = useState('');

  const rows = entries.data ?? [];

  useEffect(() => {
    if (newScope === 'character' && !newScopeChar && characters.data?.[0]) {
      setNewScopeChar(characters.data[0].id);
    }
  }, [newScope, newScopeChar, characters.data]);

  const persistOrder = async (ordered: PromptEntryRow[]) => {
    try {
      await reorderPromptEntries(ordered.map((r) => r.id));
      await entries.refetch();
    } catch (e) {
      setError(String(e));
    }
  };

  const move = (id: string, dir: -1 | 1) => {
    const at = rows.findIndex((r) => r.id === id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [item] = next.splice(at, 1);
    next.splice(to, 0, item!);
    void persistOrder(next);
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const from = rows.findIndex((r) => r.id === dragId);
    const to = rows.findIndex((r) => r.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    const next = [...rows];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    void persistOrder(next);
  };

  const addEntry = () => {
    const name = newName.trim() || 'New entry';
    const scopeId = newScope === 'global' ? null : newScope === 'character' ? newScopeChar : null;
    void createPromptEntry({ scope: newScope, scope_id: scopeId, name })
      .then((id) => {
        setNewName('');
        setShowNew(false);
        setEditingId(id);
        return entries.refetch();
      })
      .catch((e) => setError(String(e)));
  };

  return (
    <div className="pm-section">
      <p style={{ margin: '0 0 12px', color: 'var(--md-sys-color-on-surface-variant)' }}>
        Extra notes you can drop into the AI's instructions — with your own order (drag ⠿), position,
        and schedule. Locked entries are never trimmed out.
      </p>

      <div className="pm-toolbar">
        <button type="button" className="pill-add" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'Cancel' : '+ Add entry'}
        </button>
      </div>
      {showNew && (
        <div className="pm-new">
          <input
            type="text"
            placeholder="Entry name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addEntry();
            }}
            aria-label="New entry name"
          />
          <select
            value={newScope}
            onChange={(e) => setNewScope(e.target.value as 'global' | 'character')}
            aria-label="Scope"
          >
            <option value="global">Global</option>
            <option value="character">Per character</option>
          </select>
          {newScope === 'character' && (
            <select value={newScopeChar} onChange={(e) => setNewScopeChar(e.target.value)} aria-label="Character">
              {(characters.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="m3-button m3-button-filled" onClick={addEntry}>
            Add
          </button>
        </div>
      )}

      {rows.length === 0 && (
        <p className="field-hint" style={{ marginTop: 4 }}>
          No entries yet. Entries apply on top of the character card.
        </p>
      )}
      <ul className="pm-list">
        {rows.map((r, i) => (
          <li
            key={r.id}
            className={dragId === r.id ? 'pm-row dragging' : 'pm-row'}
            draggable
            onDragStart={() => setDragId(r.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(r.id)}
            onDragEnd={() => setDragId(null)}
          >
            <span className="pm-grip" title="Drag to reorder" aria-hidden="true">
              ⠿
            </span>
            <button
              type="button"
              className="pm-arrow"
              aria-label={`Move ${r.name} up`}
              disabled={i === 0}
              onClick={() => move(r.id, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="pm-arrow"
              aria-label={`Move ${r.name} down`}
              disabled={i === rows.length - 1}
              onClick={() => move(r.id, 1)}
            >
              ↓
            </button>
            <span className={r.enabled ? 'pm-name' : 'pm-name pm-off'}>
              {r.locked ? '🔒 ' : ''}
              {r.name}
              <span className="pm-meta">
                {scopeLabel(r)} · {anchorLabel(r.anchor)}
                {r.anchor === 'depth' ? ` ${r.depth ?? 0}` : ''}
                {r.timing !== 'always' ? (r.timing === 'once' ? ' · once' : ` · every ${r.period}`) : ''}
              </span>
            </span>
            <Switch checked={r.enabled === 1} onChange={(v) => void updatePromptEntry(r.id, { enabled: v ? 1 : 0 }).then(() => entries.refetch())} label={`Enable ${r.name}`} />
            <button
              type="button"
              className="m3-button m3-button-text"
              onClick={() => setEditingId(editingId === r.id ? null : r.id)}
            >
              {editingId === r.id ? 'Close' : 'Edit'}
            </button>
            {editingId === r.id && (
              <div className="pm-editor">
                <label className="field">
                  <span className="field-label">Name</span>
                  <input
                    type="text"
                    defaultValue={r.name}
                    onBlur={(e) => void updatePromptEntry(r.id, { name: e.target.value }).then(() => entries.refetch())}
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    Content <span className="field-tokens">macros like {'{{char}}'} / {'{{user}}'} work</span>
                  </span>
                  <textarea
                    rows={4}
                    defaultValue={r.content}
                    onBlur={(e) => void updatePromptEntry(r.id, { content: e.target.value }).then(() => entries.refetch())}
                  />
                </label>
                <div className="pm-grid">
                  <label className="field">
                    <span className="field-label">Position</span>
                    <select
                      defaultValue={r.anchor}
                      onChange={(e) => void updatePromptEntry(r.id, { anchor: e.target.value }).then(() => entries.refetch())}
                    >
                      {ANCHOR_BLOCKS.map((b) => (
                        <option key={b} value={`before:${b}`}>
                          Before {b}
                        </option>
                      ))}
                      {ANCHOR_BLOCKS.map((b) => (
                        <option key={`after-${b}`} value={`after:${b}`}>
                          After {b}
                        </option>
                      ))}
                      <option value="depth">At depth N from the end</option>
                    </select>
                  </label>
                  {r.anchor === 'depth' && (
                    <label className="field">
                      <span className="field-label">Depth (messages after it)</span>
                      <input
                        type="number"
                        min={0}
                        defaultValue={r.depth ?? 0}
                        onBlur={(e) =>
                          void updatePromptEntry(r.id, { depth: Math.max(0, Number(e.target.value) || 0) }).then(() =>
                            entries.refetch(),
                          )
                        }
                      />
                    </label>
                  )}
                  {r.anchor !== 'depth' && (
                    <label className="field">
                      <span className="field-label">Role</span>
                      <select
                        defaultValue={r.role}
                        onChange={(e) =>
                          void updatePromptEntry(r.id, { role: e.target.value as PromptEntryRow['role'] }).then(() =>
                            entries.refetch(),
                          )
                        }
                      >
                        <option value="system">system</option>
                        <option value="user">user</option>
                        <option value="assistant">assistant</option>
                      </select>
                    </label>
                  )}
                </div>
                <div className="pm-grid">
                  <label className="field">
                    <span className="field-label">Timing</span>
                    <select
                      defaultValue={r.timing}
                      onChange={(e) =>
                        void updatePromptEntry(r.id, { timing: e.target.value as PromptEntryRow['timing'] }).then(() =>
                          entries.refetch(),
                        )
                      }
                    >
                      <option value="always">Always</option>
                      <option value="once">Only once (at turn N)</option>
                      <option value="every_n">Every N turns</option>
                    </select>
                  </label>
                  {r.timing === 'once' && (
                    <label className="field">
                      <span className="field-label">At turn</span>
                      <input
                        type="number"
                        min={0}
                        defaultValue={r.phase}
                        onBlur={(e) => void updatePromptEntry(r.id, { phase: Math.max(0, Number(e.target.value) || 0) }).then(() => entries.refetch())}
                      />
                    </label>
                  )}
                  {r.timing === 'every_n' && (
                    <>
                      <label className="field">
                        <span className="field-label">Every N turns</span>
                        <input
                          type="number"
                          min={1}
                          defaultValue={r.period}
                          onBlur={(e) => void updatePromptEntry(r.id, { period: Math.max(1, Number(e.target.value) || 1) }).then(() => entries.refetch())}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Starting at turn</span>
                        <input
                          type="number"
                          min={0}
                          defaultValue={r.phase}
                          onBlur={(e) => void updatePromptEntry(r.id, { phase: Math.max(0, Number(e.target.value) || 0) }).then(() => entries.refetch())}
                        />
                      </label>
                    </>
                  )}
                  <label className="field">
                    <span className="field-label">Token budget (0 = none)</span>
                    <input
                      type="number"
                      min={0}
                      defaultValue={r.token_budget ?? 0}
                      onBlur={(e) =>
                        void updatePromptEntry(r.id, { token_budget: Number(e.target.value) > 0 ? Number(e.target.value) : null }).then(() =>
                          entries.refetch(),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Trim priority (low = trimmed first)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={r.trim_priority}
                      onBlur={(e) =>
                        void updatePromptEntry(r.id, { trim_priority: Number(e.target.value) || 0 }).then(() => entries.refetch())
                      }
                    />
                  </label>
                </div>
                <div className="pm-editor-actions">
                  <Switch
                    checked={r.locked === 1}
                    onChange={(v) => void updatePromptEntry(r.id, { locked: v ? 1 : 0 }).then(() => entries.refetch())}
                    label="Locked (never trimmed)"
                  />
                  <button
                    type="button"
                    className="m3-button m3-button-text char-delete"
                    onClick={() =>
                      void softDeletePromptEntry(r.id)
                        .then(() => {
                          setEditingId(null);
                          return entries.refetch();
                        })
                        .catch((e) => setError(String(e)))
                    }
                  >
                    Delete entry
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" style={{ color: 'var(--md-sys-color-error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
