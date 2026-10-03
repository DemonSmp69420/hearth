import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createProviderProfile,
  getModelSlots,
  listProviderProfiles,
  setModelSlot,
  softDeleteProviderProfile,
  updateProviderProfile,
} from '../../services/db/queries';
import {
  listModels,
  PROVIDER_PRESETS,
  setSecret,
  testConnection,
  type TestResult,
} from '../../services/providers/providers';
import { Card } from '../components/m3';
import type { ModelSlot, ProviderType } from '../../domain/types';

interface Draft {
  id: string | null;
  name: string;
  type: ProviderType;
  base_url: string;
  default_model: string;
  apiKey: string;
}

export function ProvidersView() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: listProviderProfiles });
  const slots = useQuery({ queryKey: ['slots'], queryFn: getModelSlots });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: softDeleteProviderProfile,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profiles'] }),
  });

  const startNew = (presetId?: string) => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
    setTest(null);
    setModels([]);
    setError(null);
    setDraft({
      id: null,
      name: preset?.label ?? '',
      type: preset?.type ?? 'openai_compat',
      base_url: preset?.baseUrl ?? '',
      default_model: '',
      apiKey: '',
    });
  };

  const startEdit = async (id: string) => {
    const p = profiles.data?.find((x) => x.id === id);
    if (!p) return;
    setTest(null);
    setModels([]);
    setError(null);
    setDraft({
      id: p.id,
      name: p.name,
      type: p.type,
      base_url: p.base_url,
      default_model: p.default_model ?? '',
      apiKey: '',
    });
  };

  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.base_url.trim()) {
      setError('Name and base URL are required.');
      return;
    }
    const payload = {
      name: draft.name.trim(),
      type: draft.type,
      base_url: draft.base_url.trim(),
      default_model: draft.default_model.trim() || null,
    };
    let profileId = draft.id;
    if (profileId) {
      await updateProviderProfile(profileId, payload);
    } else {
      const created = await createProviderProfile(payload);
      profileId = created.id;
    }
    if (draft.apiKey.trim()) await setSecret(profileId, draft.apiKey.trim());
    await queryClient.invalidateQueries({ queryKey: ['profiles'] });
    setDraft(null);
  };

  const runTest = async () => {
    if (!draft) return;
    setError(null);
    setTest(null);
    const result = await testConnection(draft.type, draft.base_url.trim(), draft.apiKey.trim() || draft.id);
    setTest(result);
  };

  const fetchModels = async () => {
    if (!draft) return;
    setError(null);
    try {
      setModels(await listModels(draft.type, draft.base_url.trim(), draft.apiKey.trim() || draft.id));
    } catch (e) {
      setError(String(e));
    }
  };

  const saveSlot = async (slot: ModelSlot, profileId: string, model: string) => {
    await setModelSlot(slot, profileId || null, model.trim() || null);
    await queryClient.invalidateQueries({ queryKey: ['slots'] });
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Providers</h1>
        <div className="page-head-actions">
          {PROVIDER_PRESETS.map((p) => (
            <button key={p.id} type="button" className="m3-button m3-button-tonal" onClick={() => startNew(p.id)}>
              + {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="field-hint">
        API keys are stored in the OS keychain — never in the database, exports, or logs. They are
        read by the Rust core at call time and never touch the interface layer.
      </p>

      {draft && (
        <Card variant="elevated" className="provider-editor">
          <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: '0 0 8px' }}>
            {draft.id ? `Edit ${draft.name}` : 'New provider profile'}
          </h2>
          <div className="provider-grid-2">
            <label className="field">
              <span className="field-label">Name</span>
              <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Type</span>
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ProviderType })}>
                <option value="openai_compat">OpenAI-compatible</option>
                <option value="anthropic">Anthropic (native)</option>
                <option value="gemini">Google Gemini (native)</option>
                <option value="mock">Mock (offline)</option>
              </select>
            </label>
            <label className="field span-2">
              <span className="field-label">Base URL</span>
              <input type="text" value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">API key {draft.id && '(leave blank to keep)'}</span>
              <input
                type="password"
                value={draft.apiKey}
                placeholder={draft.id ? '••••••••' : 'sk-…'}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Default model</span>
              <input
                type="text"
                list="model-list"
                value={draft.default_model}
                onChange={(e) => setDraft({ ...draft, default_model: e.target.value })}
              />
              <datalist id="model-list">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="page-head-actions">
            <button type="button" className="m3-button m3-button-tonal" onClick={() => void runTest()}>
              Test connection
            </button>
            <button type="button" className="m3-button m3-button-tonal" onClick={() => void fetchModels()}>
              Fetch models
            </button>
            <span className="field-tokens">{models.length > 0 ? `${models.length} models found` : ''}</span>
          </div>
          {test && (
            <p className={test.ok ? 'field-hint' : 'field-error'} role="status">
              {test.ok ? '✓ ' : '✕ '}
              {test.detail}
            </p>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="m3-button m3-button-text" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" className="m3-button m3-button-filled" onClick={() => void save()}>
              Save
            </button>
          </div>
        </Card>
      )}

      <h2 style={{ font: 'var(--md-sys-typescale-title-md)' }}>Model slots</h2>
      <p className="field-hint">
        Main = chat. Utility = summaries, titles, and the future Director sidecar (M3).
      </p>
      {(['main', 'utility'] as ModelSlot[]).map((slot) => {
        const row = slots.data?.find((s) => s.slot === slot);
        return (
          <SlotRow
            key={slot}
            slot={slot}
            profileId={row?.profile_id ?? ''}
            model={row?.model ?? ''}
            profiles={profiles.data ?? []}
            onSave={saveSlot}
          />
        );
      })}

      <h2 style={{ font: 'var(--md-sys-typescale-title-md)' }}>Profiles</h2>
      <div className="provider-list">
        {profiles.data?.map((p) => (
          <Card key={p.id} variant="outlined" className="provider-row">
            <div>
              <strong>{p.name}</strong>
              <span className="field-tokens">
                {' '}
                {p.type} · {p.base_url}
                {p.default_model ? ` · ${p.default_model}` : ''}
              </span>
            </div>
            <div className="page-head-actions">
              <button type="button" className="m3-button m3-button-tonal" onClick={() => void startEdit(p.id)}>
                Edit
              </button>
              <button
                type="button"
                className="m3-button m3-button-text char-delete"
                onClick={() => {
                  if (confirm(`Disable profile ${p.name}?`)) remove.mutate(p.id);
                }}
              >
                Disable
              </button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function SlotRow({
  slot,
  profileId,
  model,
  profiles,
  onSave,
}: {
  slot: ModelSlot;
  profileId: string;
  model: string;
  profiles: { id: string; name: string }[];
  onSave: (slot: ModelSlot, profileId: string, model: string) => Promise<void>;
}) {
  const [pid, setPid] = useState(profileId);
  const [m, setM] = useState(model);
  useEffect(() => {
    setPid(profileId);
    setM(model);
  }, [profileId, model]);
  return (
    <div className="provider-row provider-slot">
      <strong style={{ width: 70 }}>{slot}</strong>
      <select value={pid} onChange={(e) => setPid(e.target.value)} aria-label={`${slot} profile`}>
        <option value="">(none)</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={m}
        placeholder="model id"
        onChange={(e) => setM(e.target.value)}
        aria-label={`${slot} model`}
        style={{ flex: 1 }}
      />
      <button type="button" className="m3-button m3-button-tonal" onClick={() => void onSave(slot, pid, m)}>
        Set
      </button>
    </div>
  );
}
