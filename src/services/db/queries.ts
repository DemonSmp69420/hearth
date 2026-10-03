import { db } from './client';
import type {
  Chat,
  ChatGenSettings,
  ChatOverrides,
  ChatMember,
  Chapter,
  CharacterCard,
  Message,
  ModelSlot,
  ModelSlotRow,
  ProviderProfile,
  Persona,
  PromptPresetData,
} from '../../domain/types';
import { uuidv7 } from '../../domain/util/id';

// Row shapes as they come out of SQLite (JSON columns as strings).
type DbCharacter = Omit<CharacterCard, 'alt_greetings' | 'tags' | 'avatar_path'> & {
  alt_greetings: string;
  tags: string;
  avatar_path: string | null;
};

export interface SearchFilters {
  characterId?: string;
  role?: 'user' | 'assistant' | 'system' | 'narrator';
  bookmarkedOnly?: boolean;
  /** Inclusive lower bound, ms epoch. */
  after?: number;
  /** Inclusive upper bound, ms epoch. */
  before?: number;
}

export interface SearchHit {
  id: string;
  chat_id: string;
  chat_title: string;
  character_name: string;
  role: string;
  content: string;
  snippet: string;
  created_at: number;
}

/** Escape a plain query into a safe FTS5 phrase list ("t1" "t2"). */
export function ftsQuery(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replaceAll('"', '""')}"`)
    .join(' ');
}

export async function searchMessages(query: string, filters: SearchFilters = {}): Promise<SearchHit[]> {
  const fts = ftsQuery(query);
  if (!fts) return [];
  const where: string[] = ['messages_fts MATCH ?', 'm.deleted_at IS NULL', 'c.deleted_at IS NULL'];
  const binds: unknown[] = [fts];
  if (filters.characterId) {
    where.push('c.character_id = ?');
    binds.push(filters.characterId);
  }
  if (filters.role) {
    where.push('m.role = ?');
    binds.push(filters.role);
  }
  if (filters.bookmarkedOnly) {
    where.push('m.pinned = 1');
  }
  if (filters.after !== undefined) {
    where.push('m.created_at >= ?');
    binds.push(filters.after);
  }
  if (filters.before !== undefined) {
    where.push('m.created_at <= ?');
    binds.push(filters.before);
  }
  binds.push(100);
  return db().select<SearchHit>(
    `SELECT m.id, m.chat_id, c.title AS chat_title, ch.name AS character_name,
            m.role, m.content, m.created_at,
            snippet(messages_fts, 0, '«', '»', ' … ', 14) AS snippet
     FROM messages_fts
     JOIN messages m ON m.rowid = messages_fts.rowid
     JOIN chats c ON c.id = m.chat_id
     JOIN characters ch ON ch.id = c.character_id
     WHERE ${where.join(' AND ')}
     ORDER BY bm25(messages_fts)
     LIMIT ?`,
    binds,
  );
}

function toCharacter(row: DbCharacter): CharacterCard {
  return {
    ...row,
    alt_greetings: JSON.parse(row.alt_greetings || '[]') as string[],
    tags: JSON.parse(row.tags || '[]') as string[],
  };
}

function now(): number {
  return Date.now();
}

// ---- Characters ----

const CHARACTER_SELECT = `
  SELECT ch.*, ca.path AS avatar_path
  FROM characters ch
  LEFT JOIN character_assets ca ON ca.id = ch.avatar_asset_id`;

export async function listCharacters(): Promise<CharacterCard[]> {
  const rows = await db().select<DbCharacter>(
    `${CHARACTER_SELECT} WHERE ch.deleted_at IS NULL ORDER BY ch.updated_at DESC`,
  );
  return rows.map(toCharacter);
}

export async function getCharacter(id: string): Promise<CharacterCard | null> {
  const rows = await db().select<DbCharacter>(`${CHARACTER_SELECT} WHERE ch.id = ?`, [id]);
  const row = rows[0];
  return row ? toCharacter(row) : null;
}

export interface CharacterInput {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_message: string;
  alt_greetings: string[];
  example_dialogue: string;
  system_prompt_override: string | null;
  post_history_instructions: string | null;
  tags: string[];
  creator_notes: string | null;
}

export async function createCharacter(input: CharacterInput): Promise<CharacterCard> {
  const id = uuidv7();
  const ts = now();
  await db().execute(
    `INSERT INTO characters (id, name, description, personality, scenario, first_message,
       alt_greetings, example_dialogue, system_prompt_override, post_history_instructions,
       tags, creator_notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.description,
      input.personality,
      input.scenario,
      input.first_message,
      JSON.stringify(input.alt_greetings),
      input.example_dialogue,
      input.system_prompt_override,
      input.post_history_instructions,
      JSON.stringify(input.tags),
      input.creator_notes,
      ts,
      ts,
    ],
  );
  const created = await getCharacter(id);
  if (!created) throw new Error('character insert failed');
  return created;
}

export async function updateCharacter(
  id: string,
  input: CharacterInput,
): Promise<CharacterCard | null> {
  await db().execute(
    `UPDATE characters SET name = ?, description = ?, personality = ?, scenario = ?,
       first_message = ?, alt_greetings = ?, example_dialogue = ?, system_prompt_override = ?,
       post_history_instructions = ?, tags = ?, creator_notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name,
      input.description,
      input.personality,
      input.scenario,
      input.first_message,
      JSON.stringify(input.alt_greetings),
      input.example_dialogue,
      input.system_prompt_override,
      input.post_history_instructions,
      JSON.stringify(input.tags),
      input.creator_notes,
      now(),
      id,
    ],
  );
  return getCharacter(id);
}

export async function softDeleteCharacter(id: string): Promise<void> {
  await db().execute('UPDATE characters SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now(),
    now(),
    id,
  ]);
}

/**
 * Sets (or clears) a character's avatar. Stored as a resized data URL in
 * character_assets (D-023) — no filesystem paths, works in every transport.
 */
export async function setCharacterAvatar(
  characterId: string,
  dataUrl: string | null,
): Promise<void> {
  const d = db();
  const rows = await d.select<{ avatar_asset_id: string | null }>(
    'SELECT avatar_asset_id FROM characters WHERE id = ?',
    [characterId],
  );
  const assetId = rows[0]?.avatar_asset_id ?? null;
  if (dataUrl === null) {
    await d.execute(
      'UPDATE characters SET avatar_asset_id = NULL, updated_at = ? WHERE id = ?',
      [now(), characterId],
    );
    if (assetId) await d.execute('DELETE FROM character_assets WHERE id = ?', [assetId]);
    return;
  }
  if (assetId) {
    await d.execute('UPDATE character_assets SET path = ? WHERE id = ?', [dataUrl, assetId]);
  } else {
    const id = uuidv7();
    await d.execute(
      `INSERT INTO character_assets (id, character_id, kind, path, meta, created_at)
       VALUES (?, ?, 'avatar', ?, '{}', ?)`,
      [id, characterId, dataUrl, now()],
    );
    await d.execute('UPDATE characters SET avatar_asset_id = ?, updated_at = ? WHERE id = ?', [
      id,
      now(),
      characterId,
    ]);
  }
}

// ---- Personas ----

export async function listPersonas(): Promise<Persona[]> {
  return db().select<Persona>(
    'SELECT * FROM personas ORDER BY is_default DESC, name ASC',
  );
}

export interface PersonaInput {
  name: string;
  pronouns: string | null;
  role: string | null;
  appearance: string | null;
  personality: string | null;
  backstory: string | null;
  preferences: string | null;
  is_default: number;
}

export async function createPersona(input: PersonaInput): Promise<Persona> {
  const id = uuidv7();
  const ts = now();
  if (input.is_default) await db().execute('UPDATE personas SET is_default = 0');
  await db().execute(
    `INSERT INTO personas (id, name, pronouns, role, appearance, personality, backstory,
       preferences, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.pronouns,
      input.role,
      input.appearance,
      input.personality,
      input.backstory,
      input.preferences,
      input.is_default,
      ts,
      ts,
    ],
  );
  const rows = await db().select<Persona>('SELECT * FROM personas WHERE id = ?', [id]);
  const row = rows[0];
  if (!row) throw new Error('persona insert failed');
  return row;
}

export async function updatePersona(id: string, input: PersonaInput): Promise<void> {
  if (input.is_default) await db().execute('UPDATE personas SET is_default = 0');
  await db().execute(
    `UPDATE personas SET name = ?, pronouns = ?, role = ?, appearance = ?, personality = ?,
       backstory = ?, preferences = ?, is_default = ?, updated_at = ? WHERE id = ?`,
    [
      input.name,
      input.pronouns,
      input.role,
      input.appearance,
      input.personality,
      input.backstory,
      input.preferences,
      input.is_default,
      now(),
      id,
    ],
  );
}

export async function deletePersona(id: string): Promise<void> {
  await db().execute('DELETE FROM personas WHERE id = ?', [id]);
}

// ---- Chats ----

export interface ChatSummary extends Chat {
  character_name: string;
  persona_name: string | null;
  tags: string[];
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export async function listChats(): Promise<ChatSummary[]> {
  const rows = await db().select<ChatSummary & { tags: string }>(
    `SELECT c.id, c.title, c.character_id, c.persona_id, c.active_leaf_id,
            c.pinned, c.archived, c.folder_id, c.tags,
            c.created_at, c.updated_at, c.last_message_at,
            ch.name AS character_name, p.name AS persona_name
     FROM chats c
     JOIN characters ch ON ch.id = c.character_id
     LEFT JOIN personas p ON p.id = c.persona_id
     WHERE c.deleted_at IS NULL
     ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC`,
  );
  return rows.map((r) => ({ ...r, tags: parseTags(r.tags) }));
}

export type ChatFlags = { pinned?: boolean; archived?: boolean; folder_id?: string | null };

export async function setChatFlags(
  chatId: string,
  flags: ChatFlags,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (flags.pinned !== undefined) {
    sets.push('pinned = ?');
    values.push(flags.pinned ? 1 : 0);
  }
  if (flags.archived !== undefined) {
    sets.push('archived = ?');
    values.push(flags.archived ? 1 : 0);
  }
  if (flags.folder_id !== undefined) {
    sets.push('folder_id = ?');
    values.push(flags.folder_id);
  }
  sets.push('updated_at = ?');
  values.push(now());
  values.push(chatId);
  await db().execute(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function setChatTags(chatId: string, tags: string[]): Promise<void> {
  await db().execute('UPDATE chats SET tags = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(tags),
    now(),
    chatId,
  ]);
}

// ---- Folders ----

export type FolderKind = 'chat' | 'character';

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  kind: FolderKind;
  sort: number;
}

export async function listFolders(kind: FolderKind): Promise<Folder[]> {
  return db().select<Folder>(
    'SELECT id, name, parent_id, kind, sort FROM folders WHERE kind = ? ORDER BY sort, name COLLATE NOCASE',
    [kind],
  );
}

export async function createFolder(name: string, kind: FolderKind): Promise<string> {
  const id = uuidv7();
  await db().execute('INSERT INTO folders (id, name, parent_id, kind, sort) VALUES (?, ?, NULL, ?, 0)', [
    id,
    name,
    kind,
  ]);
  return id;
}

export async function deleteFolder(id: string): Promise<void> {
  await db().execute('DELETE FROM folders WHERE id = ?', [id]);
}

export async function getChat(id: string): Promise<Chat | null> {
  const rows = await db().select<Chat>('SELECT * FROM chats WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function createChat(
  characterId: string,
  personaId: string | null,
  greetings: string[],
): Promise<Chat> {
  const id = uuidv7();
  const ts = now();
  await db().execute(
    'INSERT INTO chats (id, title, character_id, persona_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, 'New chat', characterId, personaId, ts, ts],
  );
  // D-007: greetings are sibling assistant nodes under the implicit root;
  // the active leaf starts on the first greeting.
  let firstId: string | null = null;
  for (let i = 0; i < greetings.length; i++) {
    const g = greetings[i];
    if (!g?.trim()) continue;
    const mid = uuidv7();
    await db().execute(
      `INSERT INTO messages (id, chat_id, parent_id, ord, role, content, status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'assistant', ?, 'complete', ?, ?)`,
      [mid, id, i, g, ts, ts],
    );
    firstId ??= mid;
  }
  if (firstId) {
    await db().execute('UPDATE chats SET active_leaf_id = ? WHERE id = ?', [firstId, id]);
  }
  const chat = await getChat(id);
  if (!chat) throw new Error('chat insert failed');
  return chat;
}

export async function setActiveLeaf(chatId: string, leafId: string): Promise<void> {
  await db().execute('UPDATE chats SET active_leaf_id = ?, updated_at = ? WHERE id = ?', [
    leafId,
    now(),
    chatId,
  ]);
}

export async function setChatPersona(chatId: string, personaId: string | null): Promise<void> {
  await db().execute('UPDATE chats SET persona_id = ?, updated_at = ? WHERE id = ?', [
    personaId,
    now(),
    chatId,
  ]);
}

export async function renameChat(chatId: string, title: string): Promise<void> {
  await db().execute('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?', [
    title,
    now(),
    chatId,
  ]);
}

export async function softDeleteChat(chatId: string): Promise<void> {
  await db().execute('UPDATE chats SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now(),
    now(),
    chatId,
  ]);
}

// ---- Usage dashboard (M4.9) ----

export interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  messages: number;
}

export interface UsageByDay {
  /** Epoch day (ms / 86400000). */
  day: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface UsageByProvider {
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface UsageByChat {
  chat_id: string;
  character_name: string;
  title: string;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface UsageSummary {
  totals: UsageTotals;
  byDay: UsageByDay[];
  byProvider: UsageByProvider[];
  byChat: UsageByChat[];
}

// ---- App settings (key-value rows in the settings table) ----

export async function getSetting<T>(key: string): Promise<T | null> {
  const rows = await db().select<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  const row = rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db().execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
}

export async function deleteSetting(key: string): Promise<void> {
  await db().execute('DELETE FROM settings WHERE key = ?', [key]);
}

// ---- Statistics (M5.8) ----

export interface StatsSnapshot {
  totalChats: number;
  totalMessages: number;
  userMessages: number;
  aiMessages: number;
  totalCharacters: number;
  totalPersonas: number;
  totalTokensIn: number;
  totalTokensOut: number;
  /** Tokens (in+out) per local day, oldest first, last 14 days with usage. */
  tokensByDay: { day: string; tokens: number }[];
  byPurpose: { purpose: string; calls: number; tokens: number }[];
  topChats: { title: string; messages: number }[];
}

export async function getStats(): Promise<StatsSnapshot> {
  const one = async (sql: string, params: (string | number)[] = []): Promise<number> => {
    const rows = await db().select<{ n: number }>(sql, params);
    return rows[0]?.n ?? 0;
  };
  const [
    totalChats,
    totalMessages,
    userMessages,
    aiMessages,
    totalCharacters,
    totalPersonas,
    totalTokensIn,
    totalTokensOut,
  ] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM chats WHERE deleted_at IS NULL'),
    one('SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL'),
    one("SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL AND role = 'user'"),
    one("SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL AND role = 'assistant'"),
    one('SELECT COUNT(*) AS n FROM characters WHERE deleted_at IS NULL'),
    one('SELECT COUNT(*) AS n FROM personas WHERE deleted_at IS NULL'),
    one('SELECT COALESCE(SUM(prompt_tokens), 0) AS n FROM usage_log'),
    one('SELECT COALESCE(SUM(completion_tokens), 0) AS n FROM usage_log'),
  ]);

  const dayRows = await db().select<{ day: string; tokens: number }>(
    `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day,
            SUM(prompt_tokens + completion_tokens) AS tokens
     FROM usage_log
     WHERE ts >= ?
     GROUP BY day ORDER BY day ASC`,
    [Date.now() - 14 * 24 * 3600 * 1000],
  );

  const byPurpose = await db().select<{ purpose: string; calls: number; tokens: number }>(
    `SELECT purpose, COUNT(*) AS calls, SUM(prompt_tokens + completion_tokens) AS tokens
     FROM usage_log GROUP BY purpose ORDER BY tokens DESC`,
  );

  const topChats = await db().select<{ title: string; messages: number }>(
    `SELECT c.title AS title, COUNT(m.id) AS messages
     FROM chats c JOIN messages m ON m.chat_id = c.id AND m.deleted_at IS NULL
     WHERE c.deleted_at IS NULL
     GROUP BY c.id ORDER BY messages DESC LIMIT 5`,
  );

  return {
    totalChats,
    totalMessages,
    userMessages,
    aiMessages,
    totalCharacters,
    totalPersonas,
    totalTokensIn,
    totalTokensOut,
    tokensByDay: dayRows,
    byPurpose,
    topChats,
  };
}

// ---- Group chat members (M5.2) ----

export async function listChatMembers(chatId: string): Promise<ChatMember[]> {
  return db().select<ChatMember>(
    'SELECT id, chat_id, character_id, mute, color, sort FROM chat_members WHERE chat_id = ? ORDER BY sort ASC, created_at ASC',
    [chatId],
  );
}

export async function addChatMember(chatId: string, characterId: string): Promise<void> {
  const existing = await db().select<{ max: number | null }>(
    'SELECT MAX(sort) AS max FROM chat_members WHERE chat_id = ?',
    [chatId],
  );
  await db().execute(
    'INSERT INTO chat_members (id, chat_id, character_id, mute, color, sort, created_at) VALUES (?, ?, ?, 0, NULL, ?, ?) ON CONFLICT(chat_id, character_id) DO NOTHING',
    [uuidv7(), chatId, characterId, (existing[0]?.max ?? 0) + 1, now()],
  );
}

export async function removeChatMember(memberId: string): Promise<void> {
  await db().execute('DELETE FROM chat_members WHERE id = ?', [memberId]);
}

export async function setMemberMute(memberId: string, mute: boolean): Promise<void> {
  await db().execute('UPDATE chat_members SET mute = ? WHERE id = ?', [mute ? 1 : 0, memberId]);
}

// ---- Chapters (M5.4) ----

const CHAPTER_COLS = 'id, chat_id, title, anchor_message_id, summary, ord';

export async function listChapters(chatId: string): Promise<Chapter[]> {
  return db().select<Chapter>(
    `SELECT ${CHAPTER_COLS} FROM chapters WHERE chat_id = ? ORDER BY ord ASC, created_at ASC`,
    [chatId],
  );
}

export async function createChapter(
  chatId: string,
  title: string,
  anchorMessageId: string,
  ord: number,
): Promise<Chapter> {
  const id = uuidv7();
  await db().execute(
    `INSERT INTO chapters (id, chat_id, title, anchor_message_id, summary, ord, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    [id, chatId, title, anchorMessageId, ord, now()],
  );
  const rows = await db().select<Chapter>(`SELECT ${CHAPTER_COLS} FROM chapters WHERE id = ?`, [id]);
  const row = rows[0];
  if (!row) throw new Error('chapter insert failed');
  return row;
}

export async function renameChapter(chapterId: string, title: string): Promise<void> {
  await db().execute('UPDATE chapters SET title = ? WHERE id = ?', [title, chapterId]);
}

export async function setChapterSummary(chapterId: string, summary: string | null): Promise<void> {
  await db().execute('UPDATE chapters SET summary = ? WHERE id = ?', [summary, chapterId]);
}

export async function deleteChapter(chapterId: string): Promise<void> {
  await db().execute('DELETE FROM chapters WHERE id = ?', [chapterId]);
}

// ---- Advanced prompt entries (F17 / M4.10) ----

export interface PromptEntryRow {
  id: string;
  scope: 'global' | 'character' | 'chat';
  scope_id: string | null;
  name: string;
  content: string;
  role: 'system' | 'user' | 'assistant';
  enabled: number;
  locked: number;
  anchor: string;
  depth: number | null;
  timing: 'always' | 'once' | 'every_n';
  period: number;
  phase: number;
  token_budget: number | null;
  trim_priority: number;
  sort: number;
}

export async function listPromptEntries(): Promise<PromptEntryRow[]> {
  return db().select<PromptEntryRow>(
    'SELECT * FROM prompt_entries WHERE deleted_at IS NULL ORDER BY sort ASC, created_at ASC',
  );
}

export interface NewPromptEntry {
  scope: PromptEntryRow['scope'];
  scope_id: string | null;
  name: string;
  content?: string;
  role?: PromptEntryRow['role'];
  anchor?: string;
  depth?: number | null;
  timing?: PromptEntryRow['timing'];
  period?: number;
  phase?: number;
  trim_priority?: number;
}

export async function createPromptEntry(input: NewPromptEntry): Promise<string> {
  const id = uuidv7();
  const ts = now();
  const existing = await db().select<{ max: number | null }>(
    'SELECT MAX(sort) AS max FROM prompt_entries WHERE deleted_at IS NULL',
  );
  await db().execute(
    `INSERT INTO prompt_entries (id, scope, scope_id, name, content, role, anchor, depth, timing, period, phase, trim_priority, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.scope,
      input.scope_id,
      input.name,
      input.content ?? '',
      input.role ?? 'system',
      input.anchor ?? 'before:history',
      input.depth ?? null,
      input.timing ?? 'always',
      input.period ?? 1,
      input.phase ?? 0,
      input.trim_priority ?? 50,
      (existing[0]?.max ?? 0) + 1,
      ts,
      ts,
    ],
  );
  return id;
}

export async function updatePromptEntry(
  id: string,
  patch: Partial<
    Pick<
      PromptEntryRow,
      | 'name'
      | 'content'
      | 'role'
      | 'enabled'
      | 'locked'
      | 'anchor'
      | 'depth'
      | 'timing'
      | 'period'
      | 'phase'
      | 'token_budget'
      | 'trim_priority'
      | 'sort'
    >
  >,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    values.push(v);
  }
  sets.push('updated_at = ?');
  values.push(now());
  values.push(id);
  await db().execute(`UPDATE prompt_entries SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function softDeletePromptEntry(id: string): Promise<void> {
  await db().execute('UPDATE prompt_entries SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now(),
    now(),
    id,
  ]);
}

export async function reorderPromptEntries(orderedIds: string[]): Promise<void> {
  const ts = now();
  for (let i = 0; i < orderedIds.length; i++) {
    await db().execute('UPDATE prompt_entries SET sort = ?, updated_at = ? WHERE id = ?', [
      i,
      ts,
      orderedIds[i],
    ]);
  }
}

export async function usageSummary(days = 14): Promise<UsageSummary> {
  const sinceDay = Math.floor(Date.now() / 86400000) - (days - 1);
  const [totals] = await db().select<UsageTotals>(
    `SELECT COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COUNT(*) AS messages
     FROM messages
     WHERE role = 'assistant' AND deleted_at IS NULL AND completion_tokens IS NOT NULL`,
  );
  const byDay = await db().select<UsageByDay>(
    `SELECT created_at / 86400000 AS day,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens
     FROM messages
     WHERE role = 'assistant' AND deleted_at IS NULL AND completion_tokens IS NOT NULL
       AND created_at / 86400000 >= ?
     GROUP BY day ORDER BY day ASC`,
    [sinceDay],
  );
  const byProvider = await db().select<UsageByProvider>(
    `SELECT COALESCE(pp.name, '(unknown)') AS provider,
            COALESCE(SUM(m.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(m.completion_tokens), 0) AS completion_tokens
     FROM messages m
     LEFT JOIN provider_profiles pp ON pp.id = m.provider_profile_id
     WHERE m.role = 'assistant' AND m.deleted_at IS NULL AND m.completion_tokens IS NOT NULL
     GROUP BY provider ORDER BY completion_tokens DESC`,
  );
  const byChat = await db().select<UsageByChat>(
    `SELECT m.chat_id, ch.name AS character_name, c.title,
            COALESCE(SUM(m.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(m.completion_tokens), 0) AS completion_tokens
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     JOIN characters ch ON ch.id = c.character_id
     WHERE m.role = 'assistant' AND m.deleted_at IS NULL AND m.completion_tokens IS NOT NULL
     GROUP BY m.chat_id
     ORDER BY completion_tokens DESC
     LIMIT 8`,
  );
  return { totals: totals ?? { prompt_tokens: 0, completion_tokens: 0, messages: 0 }, byDay, byProvider, byChat };
}

// ---- Messages ----

export async function listMessages(chatId: string): Promise<Message[]> {
  return db().select<Message>(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, ord ASC',
    [chatId],
  );
}

export async function insertMessage(
  partial: Pick<Message, 'chat_id' | 'parent_id' | 'role'> &
    Partial<
      Pick<Message, 'content' | 'status' | 'model' | 'provider_profile_id' | 'ord' | 'speaker_character_id'>
    >,
): Promise<Message> {
  const id = uuidv7();
  const ts = now();
  await db().execute(
    `INSERT INTO messages (id, chat_id, parent_id, ord, role, speaker_character_id, content, status, model,
       provider_profile_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      partial.chat_id,
      partial.parent_id,
      partial.ord ?? 0,
      partial.role,
      partial.speaker_character_id ?? null,
      partial.content ?? '',
      partial.status ?? 'complete',
      partial.model ?? null,
      partial.provider_profile_id ?? null,
      ts,
      ts,
    ],
  );
  const rows = await db().select<Message>('SELECT * FROM messages WHERE id = ?', [id]);
  const row = rows[0];
  if (!row) throw new Error('message insert failed');
  return row;
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  await db().execute('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?', [
    content,
    now(),
    id,
  ]);
}

export async function setMessageStatus(
  id: string,
  status: Message['status'],
  extra?: { prompt_tokens?: number; completion_tokens?: number; latency_ms?: number; finish_reason?: string; model?: string },
): Promise<void> {
  await db().execute(
    `UPDATE messages SET status = ?,
       prompt_tokens = COALESCE(?, prompt_tokens),
       completion_tokens = COALESCE(?, completion_tokens),
       latency_ms = COALESCE(?, latency_ms),
       finish_reason = COALESCE(?, finish_reason),
       model = COALESCE(?, model),
       updated_at = ?
     WHERE id = ?`,
    [
      status,
      extra?.prompt_tokens ?? null,
      extra?.completion_tokens ?? null,
      extra?.latency_ms ?? null,
      extra?.finish_reason ?? null,
      extra?.model ?? null,
      now(),
      id,
    ],
  );
}

export async function softDeleteMessage(id: string): Promise<void> {
  await db().execute('UPDATE messages SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now(),
    now(),
    id,
  ]);
}

export async function softDeleteMessages(ids: string[]): Promise<void> {
  for (const chunk of chunks(ids, 50)) {
    await db().execute(
      `UPDATE messages SET deleted_at = ?, updated_at = ? WHERE id IN (${chunk.map(() => '?').join(',')})`,
      [now(), now(), ...chunk],
    );
  }
}

export async function restoreMessages(ids: string[]): Promise<void> {
  for (const chunk of chunks(ids, 50)) {
    await db().execute(
      `UPDATE messages SET deleted_at = NULL, updated_at = ? WHERE id IN (${chunk.map(() => '?').join(',')})`,
      [now(), ...chunk],
    );
  }
}

export async function hardDeleteMessages(ids: string[]): Promise<void> {
  for (const chunk of chunks(ids, 50)) {
    await db().execute(
      `DELETE FROM messages WHERE id IN (${chunk.map(() => '?').join(',')})`,
      [...chunk],
    );
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function recordEdit(messageId: string, priorContent: string): Promise<void> {
  await db().execute(
    'INSERT INTO message_edits (id, message_id, prior_content, edited_at) VALUES (?, ?, ?, ?)',
    [uuidv7(), messageId, priorContent, now()],
  );
}

export async function setMessageBookmark(messageId: string, bookmarked: boolean): Promise<void> {
  await db().execute('UPDATE messages SET bookmarked = ?, updated_at = ? WHERE id = ?', [
    bookmarked ? 1 : 0,
    now(),
    messageId,
  ]);
}

// ---- Provider profiles & slots ----

export async function listProviderProfiles(): Promise<ProviderProfile[]> {
  return db().select<ProviderProfile>(
    'SELECT * FROM provider_profiles WHERE enabled = 1 ORDER BY name ASC',
  );
}

export interface ProviderProfileInput {
  name: string;
  type: ProviderProfile['type'];
  base_url: string;
  default_model: string | null;
}

export async function createProviderProfile(input: ProviderProfileInput): Promise<ProviderProfile> {
  const id = uuidv7();
  const ts = now();
  await db().execute(
    `INSERT INTO provider_profiles (id, name, type, base_url, default_model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.type, input.base_url, input.default_model, ts, ts],
  );
  const rows = await db().select<ProviderProfile>(
    'SELECT * FROM provider_profiles WHERE id = ?',
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('profile insert failed');
  return row;
}

export async function updateProviderProfile(
  id: string,
  input: ProviderProfileInput,
): Promise<void> {
  await db().execute(
    `UPDATE provider_profiles SET name = ?, type = ?, base_url = ?, default_model = ?, updated_at = ?
     WHERE id = ?`,
    [input.name, input.type, input.base_url, input.default_model, now(), id],
  );
}

export async function softDeleteProviderProfile(id: string): Promise<void> {
  await db().execute('UPDATE provider_profiles SET enabled = 0, updated_at = ? WHERE id = ?', [
    now(),
    id,
  ]);
}

export async function getModelSlots(): Promise<ModelSlotRow[]> {
  return db().select<ModelSlotRow>('SELECT slot, profile_id, model FROM model_slots');
}

export async function setModelSlot(
  slot: ModelSlot,
  profileId: string | null,
  model: string | null,
): Promise<void> {
  await db().execute(
    `INSERT INTO model_slots (slot, profile_id, model) VALUES (?, ?, ?)
     ON CONFLICT(slot) DO UPDATE SET profile_id = excluded.profile_id, model = excluded.model`,
    [slot, profileId, model],
  );
}

// ---- Per-chat generation config (Proxy panel) ----

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function loadChatConfig(chatId: string): Promise<{
  settings: ChatGenSettings;
  overrides: ChatOverrides;
}> {
  const rows = await db().select<{ settings: string; slot_overrides: string | null }>(
    'SELECT settings, slot_overrides FROM chats WHERE id = ?',
    [chatId],
  );
  const row = rows[0];
  return {
    settings: parseJson<ChatGenSettings>(row?.settings ?? '{}', {}),
    overrides: parseJson<ChatOverrides>(row?.slot_overrides, {}),
  };
}

export async function saveChatSettings(chatId: string, settings: ChatGenSettings): Promise<void> {
  await db().execute('UPDATE chats SET settings = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(settings),
    now(),
    chatId,
  ]);
}

export async function saveChatOverrides(
  chatId: string,
  overrides: ChatOverrides,
): Promise<void> {
  await db().execute('UPDATE chats SET slot_overrides = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(overrides),
    now(),
    chatId,
  ]);
}

// ---- Named prompts (presets.kind='prompt', D-020/D-025) ----
// One concept in the UI: a named prompt whose content replaces the chat's
// default intro while selected. The prompt_entries table (F17) stays in the
// schema for M2's structured prompt manager.

export interface PromptPresetRow {
  id: string;
  name: string;
  data: PromptPresetData;
}

export async function listPromptPresets(): Promise<PromptPresetRow[]> {
  const rows = await db().select<{ id: string; name: string; data: string }>(
    "SELECT id, name, data FROM presets WHERE kind = 'prompt' ORDER BY name ASC",
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    data: parseJson<PromptPresetData>(r.data, { content: '' }),
  }));
}

export async function createPromptPreset(name: string, content: string): Promise<PromptPresetRow> {
  const id = uuidv7();
  await db().execute(
    "INSERT INTO presets (id, name, kind, data, builtin) VALUES (?, ?, 'prompt', ?, 0)",
    [id, name, JSON.stringify({ content } satisfies PromptPresetData)],
  );
  return { id, name, data: { content } };
}

export async function updatePromptPreset(
  id: string,
  patch: { name?: string; content?: string },
): Promise<void> {
  const rows = await db().select<{ data: string }>(
    "SELECT data FROM presets WHERE id = ? AND kind = 'prompt'",
    [id],
  );
  const row = rows[0];
  if (!row) return;
  const data = parseJson<PromptPresetData>(row.data, { content: '' });
  const next: PromptPresetData = { content: patch.content ?? data.content ?? '' };
  await db().execute('UPDATE presets SET data = ?, name = COALESCE(?, name) WHERE id = ?', [
    JSON.stringify(next),
    patch.name ?? null,
    id,
  ]);
}

export async function deletePromptPreset(id: string): Promise<void> {
  await db().execute("DELETE FROM presets WHERE id = ? AND kind = 'prompt'", [id]);
}

// ---- Memory items (pinned facts; layered memory §7) ----

export interface MemoryItemRow {
  id: string;
  scope: 'global' | 'persona' | 'character' | 'chat';
  scope_id: string | null;
  text: string;
  importance: number;
  enabled: number;
  pinned: number;
  source: string;
  created_at: number;
  updated_at: number;
}

export async function listMemoryItems(scopes: { scope: MemoryItemRow['scope']; scopeId: string | null }[]): Promise<MemoryItemRow[]> {
  if (scopes.length === 0) return [];
  const clauses = scopes.map(() => '(scope = ? AND (scope_id IS ? OR ? IS NULL))').join(' OR ');
  const binds: unknown[] = [];
  for (const s of scopes) {
    binds.push(s.scope, s.scopeId, s.scopeId);
  }
  return db().select<MemoryItemRow>(
    `SELECT * FROM memory_items WHERE enabled = 1 AND deleted_at IS NULL AND (${clauses})
     ORDER BY importance DESC, created_at ASC`,
    binds,
  );
}

export async function createMemoryItem(input: {
  scope: MemoryItemRow['scope'];
  scopeId: string | null;
  text: string;
  importance: number;
}): Promise<MemoryItemRow> {
  const id = uuidv7();
  const ts = now();
  await db().execute(
    `INSERT INTO memory_items (id, scope, scope_id, kind, text, enabled, pinned, importance, source, created_at, updated_at)
     VALUES (?, ?, ?, 'fact', ?, 1, 1, ?, 'user', ?, ?)`,
    [id, input.scope, input.scopeId, input.text, input.importance, ts, ts],
  );
  const rows = await db().select<MemoryItemRow>('SELECT * FROM memory_items WHERE id = ?', [id]);
  const row = rows[0];
  if (!row) throw new Error('memory insert failed');
  return row;
}

export async function updateMemoryItem(
  id: string,
  patch: { text?: string; importance?: number; enabled?: boolean },
): Promise<void> {
  await db().execute(
    `UPDATE memory_items SET
       text = COALESCE(?, text),
       importance = COALESCE(?, importance),
       enabled = COALESCE(?, enabled),
       updated_at = ?
     WHERE id = ?`,
    [patch.text ?? null, patch.importance ?? null, patch.enabled === undefined ? null : patch.enabled ? 1 : 0, now(), id],
  );
}

export async function deleteMemoryItem(id: string): Promise<void> {
  await db().execute('UPDATE memory_items SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now(),
    now(),
    id,
  ]);
}

// ---- Lorebooks (§8 basic) ----

export interface LorebookRow {
  id: string;
  name: string;
  description: string | null;
}

export interface LoreEntryRow {
  id: string;
  book_id: string;
  title: string;
  content: string;
  keywords_primary: string;
  keywords_secondary: string;
  regexes: string;
  constant: number;
  enabled: number;
  priority: number;
  scan_depth: number;
}

export async function listLorebooks(): Promise<(LorebookRow & { entry_count: number })[]> {
  return db().select<LorebookRow & { entry_count: number }>(
    `SELECT b.*, (SELECT COUNT(*) FROM lore_entries e WHERE e.book_id = b.id AND e.deleted_at IS NULL) AS entry_count
     FROM lorebooks b ORDER BY b.created_at DESC`,
  );
}

export async function createLorebook(name: string): Promise<LorebookRow> {
  const id = uuidv7();
  await db().execute('INSERT INTO lorebooks (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    id,
    name,
    now(),
    now(),
  ]);
  const rows = await db().select<LorebookRow>('SELECT * FROM lorebooks WHERE id = ?', [id]);
  const row = rows[0];
  if (!row) throw new Error('lorebook insert failed');
  return row;
}

export async function deleteLorebook(id: string): Promise<void> {
  await db().execute('DELETE FROM lorebooks WHERE id = ?', [id]);
}

export async function listLoreEntries(bookId: string): Promise<LoreEntryRow[]> {
  return db().select<LoreEntryRow>(
    'SELECT * FROM lore_entries WHERE book_id = ? AND deleted_at IS NULL ORDER BY priority DESC, created_at ASC',
    [bookId],
  );
}

export interface LoreEntryInput {
  bookId: string;
  title: string;
  content: string;
  keywordsPrimary: string[];
  keywordsSecondary: string[];
  regexes: string[];
  constant: boolean;
  priority: number;
  scanDepth: number;
}

export async function createLoreEntry(input: LoreEntryInput): Promise<void> {
  await db().execute(
    `INSERT INTO lore_entries (id, book_id, title, content, keywords_primary, keywords_secondary,
       regexes, constant, enabled, priority, position, scan_depth, probability, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'before_char', ?, 100, ?, ?)`,
    [
      uuidv7(),
      input.bookId,
      input.title,
      input.content,
      JSON.stringify(input.keywordsPrimary),
      JSON.stringify(input.keywordsSecondary),
      JSON.stringify(input.regexes),
      input.constant ? 1 : 0,
      input.priority,
      input.scanDepth,
      now(),
      now(),
    ],
  );
}

export async function deleteLoreEntry(id: string): Promise<void> {
  await db().execute('UPDATE lore_entries SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now(),
    now(),
    id,
  ]);
}

export async function setLoreAttachment(
  bookId: string,
  scope: 'global' | 'character' | 'chat',
  scopeId: string | null,
): Promise<void> {
  const d = db();
  // one attachment per (book, scope, scopeId)
  const existing = await d.select<{ id: string }>(
    'SELECT id FROM lore_attachments WHERE book_id = ? AND scope = ? AND (scope_id IS ? OR ? IS NULL)',
    [bookId, scope, scopeId, scopeId],
  );
  if (existing.length > 0) return;
  await d.execute('INSERT INTO lore_attachments (id, book_id, scope, scope_id) VALUES (?, ?, ?, ?)', [
    uuidv7(),
    bookId,
    scope,
    scopeId,
  ]);
}

export async function removeLoreAttachment(attachmentId: string): Promise<void> {
  await db().execute('DELETE FROM lore_attachments WHERE id = ?', [attachmentId]);
}

export interface LoreAttachmentRow {
  id: string;
  book_id: string;
  scope: 'global' | 'character' | 'chat';
  scope_id: string | null;
  book_name: string;
}

export async function listLoreAttachments(): Promise<LoreAttachmentRow[]> {
  return db().select<LoreAttachmentRow>(
    `SELECT a.*, b.name AS book_name FROM lore_attachments a
     JOIN lorebooks b ON b.id = a.book_id ORDER BY a.scope`,
  );
}

/** Entries of every lorebook attached globally, to this character, or to this chat. */
export async function loreEntriesForContext(
  characterId: string,
  chatId: string,
): Promise<LoreEntryRow[]> {
  return db().select<LoreEntryRow>(
    `SELECT DISTINCT e.* FROM lore_entries e
     JOIN lore_attachments a ON a.book_id = e.book_id
     WHERE e.enabled = 1 AND e.deleted_at IS NULL
       AND (
         (a.scope = 'global')
         OR (a.scope = 'character' AND a.scope_id = ?)
         OR (a.scope = 'chat' AND a.scope_id = ?)
       )
     ORDER BY e.priority DESC`,
    [characterId, chatId],
  );
}

// ---- Rolling summaries + usage log ----

export interface SummaryRow {
  id: string;
  chat_id: string;
  anchor_message_id: string;
  content: string;
  model: string | null;
  created_at: number;
}

export async function latestSummary(chatId: string): Promise<SummaryRow | null> {
  const rows = await db().select<SummaryRow>(
    'SELECT * FROM summaries WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
    [chatId],
  );
  return rows[0] ?? null;
}

export async function createSummary(input: {
  chatId: string;
  anchorMessageId: string;
  content: string;
  model: string | null;
}): Promise<void> {
  await db().execute(
    'INSERT INTO summaries (id, chat_id, anchor_message_id, content, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [uuidv7(), input.chatId, input.anchorMessageId, input.content, input.model, 'ready', now(), now()],
  );
}

export async function deleteSummary(id: string): Promise<void> {
  await db().execute('UPDATE summaries SET deleted_at = ? WHERE id = ?', [now(), id]);
}

export async function logUsage(input: {
  purpose: 'chat' | 'summary' | 'director' | 'title' | 'suggest' | 'embedding' | 'test';
  profileId: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  chatId: string | null;
}): Promise<void> {
  await db().execute(
    'INSERT INTO usage_log (id, ts, purpose, profile_id, model, prompt_tokens, completion_tokens, chat_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [uuidv7(), now(), input.purpose, input.profileId, input.model, input.promptTokens, input.completionTokens, input.chatId],
  );
}

// ---- Story ledger (§9, event-sourced) ----

export interface LedgerEventRow {
  id: string;
  chat_id: string;
  seq: number;
  anchor_message_id: string;
  event_type: 'thread_create' | 'thread_update' | 'thread_merge' | 'thread_delete' | 'scene_set' | 'detector_run';
  payload: string;
  source: 'user' | 'ai' | 'heuristic';
  confidence: number | null;
  created_at: number;
}

export async function listLedgerEvents(chatId: string): Promise<LedgerEventRow[]> {
  return db().select<LedgerEventRow>(
    'SELECT * FROM ledger_events WHERE chat_id = ? ORDER BY created_at ASC, seq ASC',
    [chatId],
  );
}

export async function appendLedgerEvent(input: {
  chatId: string;
  anchorMessageId: string;
  eventType: LedgerEventRow['event_type'];
  payload: unknown;
  source: LedgerEventRow['source'];
  confidence?: number;
}): Promise<void> {
  const rows = await db().select<{ maxSeq: number | null }>(
    'SELECT MAX(seq) AS maxSeq FROM ledger_events WHERE chat_id = ?',
    [input.chatId],
  );
  await db().execute(
    'INSERT INTO ledger_events (id, chat_id, seq, anchor_message_id, event_type, payload, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      uuidv7(),
      input.chatId,
      (rows[0]?.maxSeq ?? -1) + 1,
      input.anchorMessageId,
      input.eventType,
      JSON.stringify(input.payload),
      input.source,
      input.confidence ?? null,
      now(),
    ],
  );
}

// ---- Suggestions inbox (§7) ----

export interface SuggestionRow {
  id: string;
  chat_id: string;
  kind: 'memory' | 'thread';
  payload: string;
  status: 'pending' | 'saved' | 'edited' | 'dismissed';
  created_at: number;
}

export async function addSuggestion(input: {
  chatId: string;
  kind: SuggestionRow['kind'];
  payload: unknown;
}): Promise<void> {
  await db().execute(
    "INSERT INTO suggestions (id, chat_id, anchor_message_id, kind, payload, status, created_at) VALUES (?, ?, NULL, ?, ?, 'pending', ?)",
    [uuidv7(), input.chatId, input.kind, JSON.stringify(input.payload), now()],
  );
}

export async function listSuggestions(chatId: string, pendingOnly = true): Promise<SuggestionRow[]> {
  return db().select<SuggestionRow>(
    `SELECT * FROM suggestions WHERE chat_id = ? ${pendingOnly ? "AND status = 'pending'" : ''} ORDER BY created_at DESC`,
    [chatId],
  );
}

export async function setSuggestionStatus(id: string, status: SuggestionRow['status']): Promise<void> {
  await db().execute('UPDATE suggestions SET status = ? WHERE id = ?', [status, id]);
}
