import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPersona,
  deletePersona,
  listPersonas,
  updatePersona,
  type PersonaInput,
} from '../../services/db/queries';
import { Card } from '../components/m3';

const EMPTY: PersonaInput = {
  name: '',
  pronouns: null,
  role: null,
  appearance: null,
  personality: null,
  backstory: null,
  preferences: null,
  is_default: 0,
};

export function PersonasView() {
  const queryClient = useQueryClient();
  const personas = useQuery({ queryKey: ['personas'], queryFn: listPersonas });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PersonaInput>(EMPTY);

  const startNew = () => {
    setEditingId('new');
    setDraft(EMPTY);
  };
  const startEdit = (p: Awaited<ReturnType<typeof listPersonas>>[number]) => {
    setEditingId(p.id);
    setDraft({
      name: p.name,
      pronouns: p.pronouns,
      role: p.role,
      appearance: p.appearance,
      personality: p.personality,
      backstory: p.backstory,
      preferences: p.preferences,
      is_default: p.is_default,
    });
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    if (editingId === 'new') await createPersona(draft);
    else if (editingId) await updatePersona(editingId, draft);
    await queryClient.invalidateQueries({ queryKey: ['personas'] });
    setEditingId(null);
  };

  const remove = async (id: string) => {
    await deletePersona(id);
    await queryClient.invalidateQueries({ queryKey: ['personas'] });
  };

  const set = (key: keyof PersonaInput, value: string) =>
    setDraft((d) => ({ ...d, [key]: value === '' ? null : value }));

  return (
    <section className="page">
      <div className="page-head">
        <h1>Personas</h1>
        <button type="button" className="m3-button m3-button-filled" onClick={startNew}>
          New persona
        </button>
      </div>

      {editingId && (
        <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label="Persona editor">
          <div className="dialog">
            <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 12px' }}>
              {editingId === 'new' ? 'New persona' : 'Edit persona'}
            </h2>
            <div className="dialog-body">
              <label className="field">
                <span className="field-label">{'Name (the {{user}} macro resolves to this)'}</span>
                <input type="text" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </label>
              {(['pronouns', 'role', 'appearance', 'personality', 'backstory', 'preferences'] as const).map((key) => (
                <label key={key} className="field">
                  <span className="field-label">{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                  {key === 'appearance' || key === 'backstory' ? (
                    <textarea rows={3} value={String(draft[key] ?? '')} onChange={(e) => set(key, e.target.value)} />
                  ) : (
                    <input type="text" value={String(draft[key] ?? '')} onChange={(e) => set(key, e.target.value)} />
                  )}
                </label>
              ))}
              <label className="m3-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.is_default === 1}
                  onChange={(e) => setDraft((d) => ({ ...d, is_default: e.target.checked ? 1 : 0 }))}
                />
                <span className="m3-switch-track" aria-hidden="true"><span className="m3-switch-thumb" /></span>
                <span className="m3-switch-label">Default persona</span>
              </label>
            </div>
            <div className="dialog-actions">
              <button type="button" className="m3-button m3-button-text" onClick={() => setEditingId(null)}>Cancel</button>
              <button type="button" className="m3-button m3-button-filled" onClick={() => void save()}>Save</button>
            </div>
          </div>
        </div>
      )}

      <div className="persona-grid">
        {personas.data?.map((p) => (
          <Card key={p.id} variant="outlined" className="persona-card">
            <div className="page-head-actions">
              <div>
                <h3 style={{ margin: 0, font: 'var(--md-sys-typescale-title-md)' }}>
                  {p.name} {p.is_default === 1 && <span className="chip">default</span>}
                </h3>
                {p.pronouns && <span className="char-tokens">{p.pronouns}</span>}
              </div>
            </div>
            {p.role && <p style={{ margin: '8px 0 0' }}>{p.role}</p>}
            <div className="char-card-actions">
              <button type="button" className="m3-button m3-button-tonal" onClick={() => startEdit(p)}>Edit</button>
              <button type="button" className="m3-button m3-button-text char-delete" onClick={() => void remove(p.id)}>Delete</button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
