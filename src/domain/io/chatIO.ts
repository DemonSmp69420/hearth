import type { Message, Role } from '../types';

// ---- Export formats ----
// Markdown / plain text for reading, JSON for lossless Hearth backups,
// SillyTavern JSONL for interop with other tools.

export interface ChatExportMeta {
  title: string;
  characterName: string;
  personaName: string | null;
}

export interface ChatExportMessage {
  role: Role;
  content: string;
}

export interface HearthChatJson {
  app: 'hearth';
  version: 1;
  kind: 'chat';
  exported_at: number;
  chat: ChatExportMeta;
  messages: HearthChatJsonMessage[];
}

export interface HearthChatJsonMessage {
  id: string;
  parent_id: string | null;
  ord: number;
  role: Role;
  content: string;
  created_at: number;
}

function exportDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function stDate(ts: number): string {
  const d = new Date(ts);
  // SillyTavern's send_date shape: 2025-1-3@21h57m04s000ms
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}@${d.getHours()}h${d.getMinutes()}m${d.getSeconds()}s${String(d.getMilliseconds()).padStart(3, '0')}ms`;
}

function roleLabel(meta: ChatExportMeta, role: Role): string {
  switch (role) {
    case 'user':
      return meta.personaName ?? 'You';
    case 'assistant':
      return meta.characterName;
    case 'narrator':
      return 'Narrator';
    default:
      return 'System';
  }
}

export function chatToMarkdown(meta: ChatExportMeta, messages: ChatExportMessage[]): string {
  const head = [
    `# ${meta.title}`,
    '',
    `> Character: **${meta.characterName}** · Persona: ${meta.personaName ?? 'none'} · Exported ${exportDate(Date.now())}`,
    '',
    '---',
    '',
  ];
  const body = messages.map((m) => {
    const label = roleLabel(meta, m.role);
    if (m.role === 'narrator' || m.role === 'system') {
      return `*${label}:* ${m.content}`;
    }
    return `**${label}**\n\n${m.content}`;
  });
  return [...head, body.join('\n\n---\n\n'), ''].join('\n');
}

export function chatToText(meta: ChatExportMeta, messages: ChatExportMessage[]): string {
  const head = [
    meta.title,
    `Character: ${meta.characterName} | Persona: ${meta.personaName ?? 'none'} | Exported ${exportDate(Date.now())}`,
    '',
  ];
  const body = messages.map((m) => `${roleLabel(meta, m.role)}:\n${m.content}`);
  return [...head, body.join('\n\n'), ''].join('\n');
}

export function chatToJson(
  meta: ChatExportMeta,
  messages: Array<Pick<Message, 'id' | 'parent_id' | 'ord' | 'role' | 'content' | 'created_at'>>,
): string {
  const payload: HearthChatJson = {
    app: 'hearth',
    version: 1,
    kind: 'chat',
    exported_at: Date.now(),
    chat: meta,
    messages: messages.map((m) => ({
      id: m.id,
      parent_id: m.parent_id,
      ord: m.ord,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export interface StTurn {
  name: string;
  is_user: boolean;
  is_system: boolean;
  send_date: string;
  mes: string;
}

export function chatToStJsonl(meta: ChatExportMeta, messages: ChatExportMessage[]): string {
  const header = {
    user_name: meta.personaName ?? 'You',
    character_name: meta.characterName,
    create_date: stDate(Date.now()),
    chat_metadata: {},
  };
  const lines: string[] = [JSON.stringify(header)];
  for (const m of messages) {
    const turn: StTurn = {
      name: roleLabel(meta, m.role),
      is_user: m.role === 'user',
      is_system: m.role === 'system' || m.role === 'narrator',
      send_date: stDate(Date.now()),
      mes: m.content,
    };
    lines.push(JSON.stringify(turn));
  }
  return lines.join('\n') + '\n';
}

// ---- Import parsers ----

export interface ParsedImportTurn {
  /** Original message id in the source file (Hearth JSON only). */
  ref?: string;
  parentRef?: string | null;
  role: Role;
  content: string;
}

export interface ParsedImport {
  format: 'hearth-json' | 'st-jsonl';
  title: string;
  characterName: string;
  personaName: string | null;
  turns: ParsedImportTurn[];
}

export class ImportError extends Error {}

function roleFromStTurn(turn: { name?: unknown; is_user?: unknown; is_system?: unknown }): Role {
  if (turn.is_user === true) return 'user';
  if (turn.is_system === true || turn.name === 'System') return 'system';
  return 'assistant';
}

/** Parse a SillyTavern chat export (.jsonl) — header line + one turn per line. */
export function parseStChatLog(contents: string): ParsedImport {
  const lines = contents
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new ImportError('File has no chat messages.');
  let header: { user_name?: unknown; character_name?: unknown };
  try {
    header = JSON.parse(lines[0] ?? '{}') as typeof header;
  } catch {
    throw new ImportError('Not a SillyTavern chat log (bad header line).');
  }
  if (typeof header.user_name === 'undefined' && typeof header.character_name === 'undefined') {
    throw new ImportError('Not a SillyTavern chat log (missing header).');
  }
  const turns: ParsedImportTurn[] = [];
  for (const line of lines.slice(1)) {
    let turn: StTurn;
    try {
      turn = JSON.parse(line) as StTurn;
    } catch {
      throw new ImportError('Not a SillyTavern chat log (bad message line).');
    }
    if (typeof turn.mes !== 'string') continue;
    turns.push({ role: roleFromStTurn(turn), content: turn.mes });
  }
  if (turns.length === 0) throw new ImportError('File has no chat messages.');
  return {
    format: 'st-jsonl',
    title: typeof header.character_name === 'string' ? `${header.character_name} (imported)` : 'Imported chat',
    characterName: typeof header.character_name === 'string' ? header.character_name : 'Unknown',
    personaName: typeof header.user_name === 'string' ? header.user_name : null,
    turns,
  };
}

/** Parse a Hearth chat backup (the JSON produced by chatToJson). */
export function parseHearthChatJson(contents: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(contents) as unknown;
  } catch {
    throw new ImportError('Not a Hearth chat backup (invalid JSON).');
  }
  const d = data as Partial<HearthChatJson>;
  if (d.app !== 'hearth' || d.kind !== 'chat' || !Array.isArray(d.messages)) {
    throw new ImportError('Not a Hearth chat backup (missing hearth/chat marker).');
  }
  const turns: ParsedImportTurn[] = [];
  for (const m of d.messages) {
    if (!m || typeof m.content !== 'string' || typeof m.role !== 'string') continue;
    turns.push({
      ref: typeof m.id === 'string' ? m.id : undefined,
      parentRef: typeof m.parent_id === 'string' ? m.parent_id : null,
      role: m.role as Role,
      content: m.content,
    });
  }
  if (turns.length === 0) throw new ImportError('Backup has no messages.');
  return {
    format: 'hearth-json',
    title: d.chat?.title ? `${d.chat.title} (imported)` : 'Imported chat',
    characterName: d.chat?.characterName ?? 'Unknown',
    personaName: d.chat?.personaName ?? null,
    turns,
  };
}

/** Detect the format of an imported chat file. */
export function parseChatFile(contents: string): ParsedImport {
  try {
    return parseHearthChatJson(contents);
  } catch {
    return parseStChatLog(contents);
  }
}
