import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { estimator } from '../../domain/tokens/estimator';
import {
  createCharacter,
  listCharacters,
  softDeleteCharacter,
  type CharacterInput,
} from '../../services/db/queries';
import { exportCardJson, exportCardPng, parseCardJson, parsePngCard, downloadJson } from '../../services/cards';
import { fetchCharacterFromLink, type LinkImportError } from '../../services/linkImport';
import { useChat } from '../../stores/chat';
import { Card } from '../components/m3';
import { CharacterEditor } from './CharacterEditor';

type LinkState =
  | { phase: 'closed' }
  | { phase: 'open'; link: string }
  | { phase: 'fetching'; link: string }
  | { phase: 'error'; link: string; error: LinkImportError };

const ERROR_TEXT: Record<LinkImportError['kind'], string> = {
  'bad-link': 'That doesn\u2019t look like a JanitorAI character link. It should look like https://janitorai.com/characters/\u2026',
  unsupported: 'Link import works in the Hearth desktop app (and paired phones), not in the browser preview.',
  fetch: 'Sorry! We couldn\u2019t fetch the bot details.',
};

export function CharactersView() {
  const queryClient = useQueryClient();
  const characters = useQuery({ queryKey: ['characters'], queryFn: listCharacters });
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<
    { id: string | null; input: CharacterInput; avatar: string | null } | 'new' | null
  >(null);

  const remove = useMutation({
    mutationFn: softDeleteCharacter,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['characters'] }),
  });

  const [linkState, setLinkState] = useState<LinkState>({ phase: 'closed' });

  const fetchLink = async (link: string) => {
    setLinkState({ phase: 'fetching', link });
    try {
      const parsed = await fetchCharacterFromLink(link);
      await createCharacter(parsed.input);
      await queryClient.invalidateQueries({ queryKey: ['characters'] });
      setLinkState({ phase: 'closed' });
    } catch (e) {
      setLinkState({ phase: 'error', link, error: e as LinkImportError });
    }
  };

  const handleImport = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const parsed = file.name.toLowerCase().endsWith('.png')
          ? parsePngCard(new Uint8Array(await file.arrayBuffer()))
          : parseCardJson(await file.text());
        await createCharacter(parsed.input);
      } catch (e) {
        alert(`Import failed for ${file.name}: ${String(e)}`);
      }
    }
    await queryClient.invalidateQueries({ queryKey: ['characters'] });
  };

  const startChat = async (id: string) => {
    await useChat.getState().startChat(id, null);
    // navigation to Chats happens via store → AppShell view switch
    window.dispatchEvent(new CustomEvent('hearth:navigate', { detail: 'chats' }));
  };

  return (
    <section className="page page-wide">
      <div className="page-head">
        <h1>Characters</h1>
        <div className="page-head-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.png"
            multiple
            hidden
            onChange={(e) => void handleImport(e.target.files)}
          />
          <button type="button" className="m3-button m3-button-tonal" onClick={() => fileRef.current?.click()}>
            Import card (JSON / PNG)
          </button>
          <button
            type="button"
            className="m3-button m3-button-tonal"
            onClick={() => setLinkState({ phase: 'open', link: '' })}
          >
            Import from link
          </button>
          <button type="button" className="m3-button m3-button-filled" onClick={() => setEditing('new')}>
            New character
          </button>
        </div>
      </div>

      <div className="char-grid">
        {characters.data?.map((c) => {
          const permanentTokens =
            estimator.estimate(c.personality) +
            estimator.estimate(c.scenario) +
            estimator.estimate(c.first_message) +
            estimator.estimate(c.example_dialogue);
          const blurb = c.personality || c.scenario || '(no personality or scenario yet)';
          return (
            <Card key={c.id} variant="elevated" className="char-card">
              <div className="char-card-head">
                <div className="char-avatar" aria-hidden="true">
                  {c.avatar_path ? <img src={c.avatar_path} alt="" /> : c.name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h3 style={{ margin: 0, font: 'var(--md-sys-typescale-title-md)' }}>{c.name}</h3>
                  <span className="char-tokens">card ≈ {permanentTokens} tokens</span>
                </div>
              </div>
              <p className="char-desc">{blurb.slice(0, 180)}</p>
              <div className="char-card-actions">
                <button type="button" className="m3-button m3-button-filled" onClick={() => void startChat(c.id)}>
                  Chat
                </button>
                <button type="button" className="m3-button m3-button-tonal" onClick={() => setEditing({ id: c.id, input: toInput(c), avatar: c.avatar_path })}>
                  Edit
                </button>
                <button
                  type="button"
                  className="m3-button m3-button-text"
                  onClick={() => downloadJson(`${c.name || 'character'}.json`, exportCardJson(c))}
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  className="m3-button m3-button-text"
                  onClick={() => void exportCardPng(c, c.avatar_path)}
                >
                  Export PNG
                </button>
                <button
                  type="button"
                  className="m3-button m3-button-text char-delete"
                  onClick={() => {
                    if (confirm(`Delete ${c.name}? Chats stay but the character is hidden.`)) {
                      remove.mutate(c.id);
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

      {linkState.phase !== 'closed' && (
        <div className="chat-detail-empty chat-dialog-overlay link-dialog">
          <Card variant="elevated" className="inline-editor-card">
            <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 8px' }}>
              Import from link
            </h2>
            <p style={{ margin: '0 0 12px', color: 'var(--md-sys-color-on-surface-variant)' }}>
              Paste a JanitorAI character link (janitorai.com/characters/…). Hearth fetches the
              card from the JannyAI mirror.
            </p>
            <input
              type="url"
              autoFocus
              placeholder="https://janitorai.com/characters/…"
              value={linkState.link}
              disabled={linkState.phase === 'fetching'}
              onChange={(e) => setLinkState({ ...linkState, link: e.target.value } as LinkState)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && linkState.link.trim() && linkState.phase !== 'fetching') {
                  void fetchLink(linkState.link.trim());
                }
                if (e.key === 'Escape') setLinkState({ phase: 'closed' });
              }}
              aria-label="Character link"
            />
            {linkState.phase === 'fetching' && (
              <p role="status" style={{ margin: '8px 0 0' }}>
                Fetching the bot’s card…
              </p>
            )}
            {linkState.phase === 'error' && (
              <div className="link-error" role="alert">
                <p style={{ margin: 0, fontWeight: 600 }}>{ERROR_TEXT[linkState.error.kind]}</p>
                {linkState.error.kind === 'fetch' && (
                  <p style={{ margin: '4px 0 0', font: 'var(--md-sys-typescale-body-sm)' }}>
                    The bot may not be in the JannyAI dataset yet, or the mirror is briefly
                    unreachable.
                  </p>
                )}
                <details className="link-help">
                  <summary>Still want the bot? Add it yourself</summary>
                  <ol>
                    <li>
                      Open the bot’s page in your browser and replace{' '}
                      <code>janitorai.com</code> with <code>jannyai.com</code> in the address bar.
                    </li>
                    <li>
                      If the definition shows up, use that site’s download button to save the
                      card as PNG or JSON.
                    </li>
                    <li>
                      Come back here and use <strong>Import card (JSON / PNG)</strong> to pick the
                      file you saved.
                    </li>
                  </ol>
                  <p style={{ margin: '4px 0 0', font: 'var(--md-sys-typescale-body-sm)' }}>
                    If the bot isn’t on JannyAI either, its definition is hidden on JanitorAI and
                    there’s no way to fetch it automatically — JannyAI is a fan-made mirror with
                    no public way to request additions.
                  </p>
                </details>
              </div>
            )}
            <div className="dialog-actions">
              <button type="button" className="m3-button m3-button-text" onClick={() => setLinkState({ phase: 'closed' })}>
                Close
              </button>
              <button
                type="button"
                className="m3-button m3-button-filled"
                disabled={!linkState.link.trim() || linkState.phase === 'fetching'}
                onClick={() => void fetchLink(linkState.link.trim())}
              >
                {linkState.phase === 'fetching' ? 'Fetching…' : 'Fetch card'}
              </button>
            </div>
          </Card>
        </div>
      )}

      {editing && (
        <CharacterEditor
          characterId={editing === 'new' ? null : editing.id}
          initial={editing === 'new' ? emptyInput() : editing.input}
          avatarPath={editing === 'new' ? null : editing.avatar}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function toInput(c: Awaited<ReturnType<typeof listCharacters>>[number]): CharacterInput {
  return {
    name: c.name,
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    first_message: c.first_message,
    alt_greetings: c.alt_greetings,
    example_dialogue: c.example_dialogue,
    system_prompt_override: c.system_prompt_override,
    post_history_instructions: c.post_history_instructions,
    tags: c.tags,
    creator_notes: c.creator_notes,
  };
}

function emptyInput(): CharacterInput {
  return {
    name: '',
    description: '',
    personality: '',
    scenario: '',
    first_message: '',
    alt_greetings: [],
    example_dialogue: '',
    system_prompt_override: null,
    post_history_instructions: null,
    tags: [],
    creator_notes: null,
  };
}
