import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useChat } from '../../stores/chat';
import {
  createFolder,
  deleteFolder,
  getChat,
  listCharacters,
  listFolders,
  listMessages,
  renameChat,
  type ChatSummary,
} from '../../services/db/queries';
import { openTextFile, saveTextFile } from '../../services/files';
import { activePath } from '../../domain/tree/tree';
import {
  chatToJson,
  chatToMarkdown,
  chatToStJsonl,
  chatToText,
  parseChatFile,
  type ChatExportMeta,
  type ParsedImport,
} from '../../domain/io/chatIO';
import { ChatView } from '../chat/ChatView';
import { Card, FilledButton } from '../components/m3';

type Tab = 'all' | 'pinned' | 'archived';
type ExportFormat = 'md' | 'txt' | 'json' | 'st';

const EXPORT_ITEMS: { format: ExportFormat; label: string; ext: string }[] = [
  { format: 'md', label: 'Markdown', ext: 'md' },
  { format: 'txt', label: 'Plain text', ext: 'txt' },
  { format: 'json', label: 'Hearth JSON (backup)', ext: 'json' },
  { format: 'st', label: 'SillyTavern JSONL', ext: 'jsonl' },
];

function fileBase(title: string): string {
  return title.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'chat';
}

function timeAgo(ts: number | null): string {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ChatsView() {
  const { chats, activeChatId, refreshChats, openChat, deleteChat, setChatFlags, setChatTags } = useChat();
  const [tab, setTab] = useState<Tab>('all');
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [tagsId, setTagsId] = useState<string | null>(null);
  const [tagsDraft, setTagsDraft] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [importState, setImportState] = useState<{ parsed: ParsedImport } | null>(null);
  const [importCharId, setImportCharId] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const folders = useQuery({ queryKey: ['folders', 'chat'], queryFn: () => listFolders('chat') });
  const characters = useQuery({ queryKey: ['characters'], queryFn: listCharacters });
  const folderNameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of folders.data ?? []) m.set(f.id, f.name);
    return m;
  }, [folders.data]);

  useEffect(() => {
    void refreshChats();
  }, [refreshChats]);

  const visible = useMemo(() => {
    let list = chats;
    if (tab === 'archived') list = list.filter((c) => c.archived === 1);
    else list = list.filter((c) => c.archived !== 1).filter((c) => (tab === 'pinned' ? c.pinned === 1 : true));
    if (folderFilter === 'none') list = list.filter((c) => !c.folder_id);
    else if (folderFilter !== 'all') list = list.filter((c) => c.folder_id === folderFilter);
    return [...list].sort(
      (a, b) => b.pinned - a.pinned || (b.last_message_at ?? b.updated_at) - (a.last_message_at ?? a.updated_at),
    );
  }, [chats, tab, folderFilter]);

  const closeMenu = () => setMenuFor(null);

  const startRename = (id: string, current: string) => {
    setRenamingId(id);
    setRenameDraft(current);
    closeMenu();
  };

  const startTags = (id: string, current: string[]) => {
    setTagsId(id);
    setTagsDraft(current.join(', '));
    closeMenu();
  };

  const saveRename = () => {
    if (renamingId && renameDraft.trim()) {
      void renameChat(renamingId, renameDraft.trim()).then(() => refreshChats());
    }
    setRenamingId(null);
  };

  const saveTags = () => {
    if (tagsId) {
      const tags = tagsDraft.split(',').map((t) => t.trim()).filter(Boolean);
      void setChatTags(tagsId, [...new Set(tags)]);
    }
    setTagsId(null);
  };

  const addFolder = () => {
    const name = folderName.trim();
    if (!name) {
      setAddingFolder(false);
      return;
    }
    void createFolder(name, 'chat').then(() => {
      void folders.refetch();
      setFolderName('');
      setAddingFolder(false);
    });
  };

  const removeFolder = (id: string) => {
    void deleteFolder(id).then(() => {
      if (folderFilter === id) setFolderFilter('all');
      void folders.refetch();
      void refreshChats();
    });
  };

  const doExport = async (c: ChatSummary, format: ExportFormat) => {
    closeMenu();
    const [chat, msgs] = await Promise.all([getChat(c.id), listMessages(c.id)]);
    if (!chat) return;
    const meta: ChatExportMeta = {
      title: c.title,
      characterName: c.character_name,
      personaName: c.persona_name,
    };
    const live = msgs.filter((m) => !m.deleted_at);
    const item = EXPORT_ITEMS.find((e) => e.format === format);
    let contents: string;
    if (format === 'json') {
      contents = chatToJson(meta, live);
    } else {
      const pathMsgs = activePath(live, chat.active_leaf_id).map((m) => ({ role: m.role, content: m.content }));
      contents =
        format === 'md'
          ? chatToMarkdown(meta, pathMsgs)
          : format === 'txt'
            ? chatToText(meta, pathMsgs)
            : chatToStJsonl(meta, pathMsgs);
    }
    await saveTextFile(`${fileBase(c.title)}.${item?.ext ?? 'txt'}`, contents);
  };

  const startImport = async () => {
    setImportError(null);
    const file = await openTextFile(['json', 'jsonl']);
    if (!file) return;
    try {
      const parsed = parseChatFile(file.contents);
      setImportCharId(characters.data?.[0]?.id ?? '');
      setImportState({ parsed });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const confirmImport = () => {
    if (!importState || !importCharId) return;
    const { parsed } = importState;
    void useChat
      .getState()
      .importChat({
        characterId: importCharId,
        personaId: null,
        title: parsed.title,
        turns: parsed.turns,
      })
      .then(() => {
        setImportState(null);
      });
  };

  return (
    <div className="chats-layout">
      <aside className="chat-list-pane" aria-label="Chat list">
        <div className="pane-head">
          <h2 style={{ font: 'var(--md-sys-typescale-title-md)', margin: 0 }}>Chats</h2>
          <span className="pane-head-actions">
            <FilledButton variant="text" onClick={() => void startImport()}>
              Import
            </FilledButton>
            <FilledButton variant="text" onClick={() => useChat.getState().closeChat()}>
              + New
            </FilledButton>
          </span>
        </div>

        <div className="chat-filters">
          <div className="m3-segmented" role="radiogroup" aria-label="Chat filter">
            {(
              [
                ['all', 'All'],
                ['pinned', 'Pinned'],
                ['archived', 'Archived'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={tab === v}
                className={tab === v ? 'm3-segment selected' : 'm3-segment'}
                onClick={() => setTab(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="chat-folder-row">
            <select
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
              aria-label="Filter by folder"
            >
              <option value="all">All folders</option>
              <option value="none">(no folder)</option>
              {(folders.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {folderFilter !== 'all' && folderFilter !== 'none' && (
              <button
                type="button"
                className="chat-list-delete"
                title="Delete this folder (chats inside keep, unfiled)"
                aria-label="Delete folder"
                onClick={() => removeFolder(folderFilter)}
              >
                ✕
              </button>
            )}
            <button
              type="button"
              className="pill-add"
              title="New folder"
              onClick={() => setAddingFolder(true)}
            >
              + Folder
            </button>
          </div>
          {addingFolder && (
            <div className="chat-folder-row">
              <input
                type="text"
                autoFocus
                placeholder="Folder name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addFolder();
                  if (e.key === 'Escape') setAddingFolder(false);
                }}
              />
              <button type="button" className="m3-button m3-button-filled" onClick={addFolder}>
                ✓
              </button>
            </div>
          )}
        </div>

        {importError && (
          <p role="alert" style={{ margin: '0 12px', font: 'var(--md-sys-typescale-body-sm)', color: 'var(--md-sys-color-error)' }}>
            {importError}
          </p>
        )}

        {visible.length === 0 && (
          <Card variant="outlined" className="chat-list-empty">
            {tab === 'archived'
              ? 'No archived chats.'
              : tab === 'pinned'
                ? 'No pinned chats. Use the ⋯ menu on a chat to pin it.'
                : 'No chats yet. Pick a character and press Chat to start one.'}
          </Card>
        )}
        <ul className="chat-list">
          {visible.map((c) => (
            <li key={c.id} className="chat-list-row">
              <button
                type="button"
                className={c.id === activeChatId ? 'chat-list-item active' : 'chat-list-item'}
                onClick={() => void openChat(c.id)}
              >
                <span className="chat-list-title">
                  {c.pinned === 1 && <span className="chat-flag" title="Pinned">▸</span>}
                  {c.title}
                </span>
                <span className="chat-list-sub">
                  {c.character_name}
                  {c.persona_name ? ` · as ${c.persona_name}` : ''} · {timeAgo(c.last_message_at ?? c.updated_at)}
                </span>
                {(c.folder_id || c.tags.length > 0) && (
                  <span className="chat-list-sub">
                    {c.folder_id && folderNameOf.get(c.folder_id) ? `${folderNameOf.get(c.folder_id)}` : ''}
                    {c.folder_id && c.tags.length > 0 ? ' · ' : ''}
                    {c.tags.length > 0 ? `#${c.tags.join(' #')}` : ''}
                  </span>
                )}
              </button>
              <span className="chat-list-side">
                <button
                  type="button"
                  className="chat-list-delete"
                  title="More"
                  aria-label={`Actions for ${c.title}`}
                  onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
                >
                  ⋯
                </button>
                <button
                  type="button"
                  className="chat-list-delete"
                  title="Delete chat"
                  aria-label={`Delete chat ${c.title}`}
                  onClick={() => void deleteChat(c.id)}
                >
                  ✕
                </button>
              </span>
              {menuFor === c.id && (
                <span className="msg-menu chat-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { void setChatFlags(c.id, { pinned: c.pinned !== 1 }); closeMenu(); }}>
                    {c.pinned === 1 ? 'Unpin' : 'Pin'}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { void setChatFlags(c.id, { archived: c.archived !== 1 }); closeMenu(); }}>
                    {c.archived === 1 ? 'Unarchive' : 'Archive'}
                  </button>
                  <button type="button" role="menuitem" onClick={() => startRename(c.id, c.title)}>
                    Rename…
                  </button>
                  <button type="button" role="menuitem" onClick={() => startTags(c.id, c.tags)}>
                    Tags…
                  </button>
                  <span className="chat-menu-group">Export</span>
                  {EXPORT_ITEMS.map((e) => (
                    <button key={e.format} type="button" role="menuitem" onClick={() => void doExport(c, e.format)}>
                      {e.label}
                    </button>
                  ))}
                  <span className="chat-menu-group">Move to folder</span>
                  <button type="button" role="menuitem" onClick={() => { void setChatFlags(c.id, { folder_id: null }); closeMenu(); }}>
                    (no folder)
                  </button>
                  {(folders.data ?? []).map((f) => (
                    <button key={f.id} type="button" role="menuitem" onClick={() => { void setChatFlags(c.id, { folder_id: f.id }); closeMenu(); }}>
                      {f.name}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </aside>
      <section className="chat-detail-pane">
        {activeChatId ? (
          <ChatView />
        ) : (
          <div className="chat-detail-empty">
            <Card variant="elevated">
              <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 8px' }}>
                Select a chat
              </h2>
              <p style={{ margin: 0 }}>
                Or start a new one from the <strong>Characters</strong> page.
              </p>
            </Card>
          </div>
        )}
        {(renamingId || tagsId || importState) && (
          <div className="chat-detail-empty chat-dialog-overlay">
            <Card variant="elevated" className="inline-editor-card">
              {renamingId ? (
                <>
                  <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 12px' }}>Rename chat</h2>
                  <input
                    type="text"
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    aria-label="Chat title"
                  />
                  <div className="dialog-actions">
                    <button type="button" className="m3-button m3-button-text" onClick={() => setRenamingId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="m3-button m3-button-filled" onClick={saveRename}>
                      Save
                    </button>
                  </div>
                </>
              ) : tagsId ? (
                <>
                  <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 12px' }}>Tags</h2>
                  <p style={{ margin: '0 0 12px', color: 'var(--md-sys-color-on-surface-variant)' }}>
                    Comma-separated, e.g. <code>romance, slow-burn</code>.
                  </p>
                  <input
                    type="text"
                    autoFocus
                    value={tagsDraft}
                    onChange={(e) => setTagsDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTags();
                      if (e.key === 'Escape') setTagsId(null);
                    }}
                    aria-label="Tags"
                  />
                  <div className="dialog-actions">
                    <button type="button" className="m3-button m3-button-text" onClick={() => setTagsId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="m3-button m3-button-filled" onClick={saveTags}>
                      Save
                    </button>
                  </div>
                </>
              ) : importState ? (
                <>
                  <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 8px' }}>Import chat</h2>
                  <p style={{ margin: '0 0 12px', color: 'var(--md-sys-color-on-surface-variant)' }}>
                    {importState.parsed.format === 'hearth-json' ? 'Hearth backup' : 'SillyTavern log'} ·{' '}
                    {importState.parsed.turns.length} messages · character {importState.parsed.characterName}
                  </p>
                  <label className="field">
                    <span className="field-label">Play as character</span>
                    <select value={importCharId} onChange={(e) => setImportCharId(e.target.value)}>
                      {(characters.data ?? []).map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="field-hint" style={{ marginTop: 0 }}>
                    Title: {importState.parsed.title}
                  </p>
                  <div className="dialog-actions">
                    <button
                      type="button"
                      className="m3-button m3-button-text"
                      onClick={() => setImportState(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="m3-button m3-button-filled"
                      disabled={!importCharId}
                      onClick={confirmImport}
                    >
                      Import
                    </button>
                  </div>
                </>
              ) : null}
            </Card>
          </div>
        )}
      </section>
    </div>
  );
}
