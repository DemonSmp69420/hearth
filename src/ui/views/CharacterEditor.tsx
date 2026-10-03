import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { estimator } from '../../domain/tokens/estimator';
import {
  createCharacter,
  setCharacterAvatar,
  updateCharacter,
  type CharacterInput,
} from '../../services/db/queries';
import { fileToAvatarDataUrl } from '../../services/images';

// D-022: the first-party editor stays deliberately simple — five fields.
// Imported cards may carry more (description, system overrides, …); those are
// preserved on import and consumed by the prompt, just not surfaced here.
const FIELDS: { key: keyof CharacterInput; label: string; rows?: number; hint?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'personality', label: 'Personality', rows: 4, hint: 'Who they are and how they behave' },
  { key: 'scenario', label: 'Scenario', rows: 3, hint: 'The situation the chat starts in' },
  { key: 'example_dialogue', label: 'Example dialogue', rows: 4, hint: 'Optional — how they talk' },
  { key: 'first_message', label: 'First message', rows: 4, hint: 'Their opening line' },
];

export function CharacterEditor({
  characterId,
  initial,
  avatarPath,
  onClose,
}: {
  characterId: string | null;
  initial: CharacterInput;
  avatarPath: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState<CharacterInput>(initial);
  const [avatar, setAvatar] = useState<string | null>(avatarPath);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof CharacterInput, value: string) =>
    setInput((prev) => ({ ...prev, [key]: value }));

  const pickAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      setAvatar(await fileToAvatarDataUrl(file));
    } catch (e) {
      setError(`Could not read that image: ${String(e)}`);
    }
  };

  const save = async () => {
    if (!input.name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let id = characterId;
      if (id) await updateCharacter(id, input);
      else id = (await createCharacter(input)).id;
      await setCharacterAvatar(id, avatar);
      await queryClient.invalidateQueries({ queryKey: ['characters'] });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label="Character editor">
      <div className="dialog">
        <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 12px' }}>
          {characterId ? 'Edit character' : 'New character'}
        </h2>
        <div className="dialog-body">
          <div className="avatar-picker-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => void pickAvatar(e.target.files)}
            />
            <button
              type="button"
              className="char-avatar avatar-pick"
              onClick={() => fileRef.current?.click()}
              title="Choose an avatar image"
              aria-label="Choose avatar image"
            >
              {avatar ? <img src={avatar} alt="" /> : '+'}
            </button>
            <div className="avatar-picker-text">
              <strong>Avatar</strong>
              <span className="field-hint">
                {avatar ? 'Click to replace — resized and stored locally.' : 'Optional image, stored locally on your machine.'}
              </span>
              {avatar && (
                <button type="button" className="m3-button m3-button-text char-delete" onClick={() => setAvatar(null)}>
                  Remove image
                </button>
              )}
            </div>
          </div>
          {FIELDS.map((f) => (
            <label key={String(f.key)} className="field">
              <span className="field-label">
                {f.label}
                <span className="field-tokens">≈ {estimator.estimate(String(input[f.key] ?? ''))} tok</span>
              </span>
              {f.rows ? (
                <textarea
                  value={String(input[f.key] ?? '')}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={f.rows}
                />
              ) : (
                <input
                  type="text"
                  value={String(input[f.key] ?? '')}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {f.hint && <span className="field-hint">{f.hint}</span>}
            </label>
          ))}
          {error && <p role="alert" className="field-error">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="m3-button m3-button-text" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="m3-button m3-button-filled" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
