import { create } from 'zustand';
import type {
  Chapter,
  CharacterCard,
  ChatGenSettings,
  ChatOverrides,
  ChatMember,
  Message,
  OutputRule,
  Persona,
} from '../domain/types';
import { applyRules } from '../domain/text/rules';
import { activePath, deepestLeaf, descendantIds, nearestSurvivingAncestor, nextOrd } from '../domain/tree/tree';
import { buildPrompt, visibleHistory, type BuiltPrompt } from '../domain/prompt/builder';
import { fireLore, type LoreEntryLike } from '../domain/lore/trigger';
import { uuidv7 } from '../domain/util/id';
import { transport } from '../services/transport';
import {
  createChat,
  getChat,
  insertMessage,
  listChatMembers,
  addChatMember,
  removeChatMember,
  setMemberMute,
  listChapters,
  createChapter,
  renameChapter as dbRenameChapter,
  setChapterSummary,
  deleteChapter as dbDeleteChapter,
  listChats,
  listMessages,
  loadChatConfig,
  recordEdit,
  renameChat,
  setChatFlags,
  setChatTags,
  saveChatOverrides,
  saveChatSettings,
  setActiveLeaf,
  setChatPersona,
  setMessageBookmark,
  setMessageStatus,
  softDeleteChat,
  softDeleteMessage,
  softDeleteMessages,
  restoreMessages,
  hardDeleteMessages,
  updateMessageContent,
  type ChatFlags,
  type ChatSummary,
  createPromptPreset,
  deletePromptPreset as dbDeletePromptPreset,
  listPromptPresets,
  updatePromptPreset,
  type PromptPresetRow,
  listMemoryItems,
  loreEntriesForContext,
  latestSummary,
  createSummary,
  deleteSummary,
  createMemoryItem,
  updateMemoryItem,
  deleteMemoryItem,
  logUsage,
  appendLedgerEvent,
  listLedgerEvents,
  addSuggestion,
  listSuggestions,
  setSuggestionStatus,
  type LedgerEventRow,
  type MemoryItemRow,
  type SuggestionRow,
  type SummaryRow,
} from '../services/db/queries';
import { foldLedger, buildLedgerBlock, threadsForDisplay, type ThreadStatus } from '../domain/ledger/fold';
import { gateDirectorCall, messagesSinceLastRun } from '../domain/ledger/heuristics';
import { extractJsonCandidate, validateDirectorOutput } from '../domain/ledger/director';
import { checkConsistency, type ConsistencyWarning } from '../domain/consistency/guard';
import { getCharacter, getModelSlots, listProviderProfiles } from '../services/db/queries';
import { listPersonas } from '../services/db/queries';
import { listPromptEntries } from '../services/db/queries';
import type { ParsedImportTurn } from '../domain/io/chatIO';
import type { PromptEntryLike } from '../domain/prompt/builder';

export interface ImportChatInput {
  characterId: string;
  personaId: string | null;
  title: string;
  turns: ParsedImportTurn[];
}

interface StreamState {
  /** Null when the stream is not writing a message row (impersonate). */
  messageId: string | null;
  text: string;
  baseContent: string;
  startedAt: number;
}

interface ChatStore {
  chats: ChatSummary[];
  activeChatId: string | null;
  character: CharacterCard | null;
  personas: Persona[];
  persona: Persona | null;
  messages: Message[];
  activeLeafId: string | null;
  /** Per-chat generation config (Proxy panel). */
  genSettings: ChatGenSettings;
  modelOverride: ChatOverrides['main'] | null;
  /** All named prompts; one is active per chat (D-025). */
  prompts: PromptPresetRow[];
  activePromptId: string | null;
  /** Layered-memory facts in scope for this chat (global + character + chat). */
  memoryItems: MemoryItemRow[];
  /** Latest rolling summary for this chat. */
  summary: SummaryRow | null;
  /** Raw ledger events; the branch-aware fold derives from these + the path. */
  ledgerEvents: LedgerEventRow[];
  suggestions: SuggestionRow[];
  /** The most recent built prompt (token meter + Inspector read this). */
  lastBuild: BuiltPrompt | null;
  stream: StreamState | null;
  generationId: string | null;
  error: string | null;
  busy: boolean;
  /** M5.1 compare mode: parallel candidates, pick one (others become swipes). */
  compare: CompareState | null;
  /** M5.2 group chat cast (empty in 1:1 chats). */
  members: GroupMemberView[];
  /** M5.4 chapters anchored on messages (branch-aware via the anchor path). */
  chapters: Chapter[];
  /** M5.7 next-beat suggestion chips (best-effort, utility model). */
  nextBeats: string[];
  /** M5.9 consistency guard warnings for the latest reply (zero-token). */
  consistencyWarnings: ConsistencyWarning[];

  refreshChats(): Promise<void>;
  openChat(id: string): Promise<void>;
  closeChat(): void;
  startChat(characterId: string, personaId: string | null): Promise<void>;
  deleteChat(id: string): Promise<void>;
  setChatFlags(id: string, flags: ChatFlags): Promise<void>;
  setChatTags(id: string, tags: string[]): Promise<void>;
  importChat(input: ImportChatInput): Promise<void>;
  addMember(characterId: string): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  setMemberMute(memberId: string, mute: boolean): Promise<void>;
  setTurnOrder(mode: 'manual' | 'round-robin' | 'auto'): Promise<void>;
  speakAs(speakerCharacterId: string | null): Promise<void>;
  startChapterAt(messageId: string): Promise<void>;
  renameChapter(chapterId: string, title: string): Promise<void>;
  deleteChapter(chapterId: string): Promise<void>;
  summarizeChapter(chapterId: string): Promise<void>;
  summarizeMissingChapters(): Promise<number>;
  rewriteText(text: string, mode: RewriteMode): Promise<string>;
  sendOoc(text: string): Promise<void>;
  saveOutputRules(rules: OutputRule[]): Promise<void>;
  setNextBeatsEnabled(enabled: boolean): Promise<void>;
  generateNextBeats(): Promise<void>;
  checkConsistency(): Promise<void>;
  clearConsistencyWarnings(): void;
  setConsistencyEnabled(enabled: boolean): Promise<void>;
  send(text: string): Promise<void>;
  stop(): Promise<void>;
  startCompare(count?: number): Promise<void>;
  pickCandidate(index: number): Promise<void>;
  cancelCompare(): Promise<void>;
  regenerate(): Promise<void>;
  regenerateMessage(messageId: string): Promise<void>;
  continueLast(): Promise<void>;
  impersonate(): Promise<string | null>;
  editMessage(id: string, content: string, asBranch: boolean): Promise<void>;
  deleteMessage(id: string, withSubtree: boolean): Promise<void>;
  branchFrom(id: string): Promise<void>;
  forkToNewChat(id: string): Promise<void>;
  switchToSibling(messageId: string, dir: -1 | 1): Promise<void>;
  jumpToNode(messageId: string): Promise<void>;
  pruneBranch(messageId: string): Promise<string[]>;
  undoPrune(ids: string[]): Promise<void>;
  prunePermanently(): Promise<number>;
  setPersona(personaId: string | null): Promise<void>;
  toggleBookmark(messageId: string, bookmarked: boolean): Promise<void>;
  saveGenParams(params: ChatGenSettings['params']): Promise<void>;
  saveContextTokens(tokens: number): Promise<void>;
  saveAccent(enabled: boolean): Promise<void>;
  saveModelOverride(profileId: string | null, model: string | null): Promise<void>;
  refreshPrompts(): Promise<void>;
  addPrompt(name: string): Promise<string | null>;
  updatePrompt(id: string, patch: { name?: string; content?: string }): Promise<void>;
  deletePrompt(id: string): Promise<void>;
  selectPrompt(id: string | null): Promise<void>;
  refreshMemory(): Promise<void>;
  addMemory(text: string, importance: number): Promise<void>;
  updateMemory(id: string, patch: { text?: string; importance?: number; enabled?: boolean }): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  summarizeNow(): Promise<void>;
  deleteSummaryRow(): Promise<void>;
  previewBuild(): Promise<void>;
  setThreadStatus(threadId: string, status: ThreadStatus): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  addThreadManual(title: string): Promise<void>;
  updateScene(field: string, value: string): Promise<void>;
  setLedgerEnabled(enabled: boolean): Promise<void>;
  resolveSuggestion(suggestionId: string, accept: boolean): Promise<void>;
  runDirectorNow(): Promise<void>;
}

interface StreamEvent {
  type: 'delta' | 'usage' | 'done' | 'error';
  text?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  finish_reason?: string;
  message?: string;
}

export interface CompareCandidate {
  genId: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  message?: string;
  completionTokens?: number;
}

export interface CompareState {
  count: number;
  candidates: CompareCandidate[];
  /** True while at least one candidate is still streaming. */
  active: boolean;
  /** M5.2: the group member all candidates speak as (null/undefined = lead). */
  speakerCharacterId?: string | null;
}

/** M5.2: a chat_members row joined with its character for display. */
export interface GroupMemberView extends ChatMember {
  name: string;
  avatar_path: string | null;
}

export const useChat = create<ChatStore>()((set, get) => ({
  chats: [],  activeChatId: null,
  character: null,
  personas: [],
  persona: null,
  messages: [],
  activeLeafId: null,
  genSettings: {},
  modelOverride: null,
  prompts: [],
  activePromptId: null,
  memoryItems: [],
  summary: null,
  ledgerEvents: [],
  suggestions: [],
  lastBuild: null,
  stream: null,
  generationId: null,
  error: null,
  busy: false,
  compare: null,
  members: [],
  chapters: [],
  nextBeats: [],
  consistencyWarnings: [],

  async refreshChats() {
    set({ chats: await listChats(), personas: await listPersonas() });
  },

  async openChat(id) {
    if (get().stream || get().compare) return; // don't switch mid-generation
    const chat = await getChat(id);
    if (!chat) return;
    const [character, messages, personas, config] = await Promise.all([
      getCharacter(chat.character_id),
      listMessages(id),
      listPersonas(),
      loadChatConfig(id),
    ]);
    if (!character) return;
    const persona = personas.find((p) => p.id === chat.persona_id) ?? null;
    const [memoryItems, summary, ledgerEvents, suggestions, members, chapters] = await Promise.all([
      listMemoryItems([
        { scope: 'global', scopeId: null },
        { scope: 'character', scopeId: chat.character_id },
        { scope: 'chat', scopeId: id },
      ]),
      latestSummary(id),
      listLedgerEvents(id),
      listSuggestions(id),
      loadMembers(id),
      listChapters(id),
    ]);
    set({
      activeChatId: id,
      character,
      personas,
      persona,
      messages,
      activeLeafId: chat.active_leaf_id,
      genSettings: config.settings,
      modelOverride: config.overrides.main ?? null,
      prompts: await listPromptPresets(),
      activePromptId: config.settings.active_prompt_id ?? null,
      memoryItems,
      summary,
      ledgerEvents,
      suggestions,
      members,
      chapters,
      nextBeats: [],
      consistencyWarnings: [],
      lastBuild: null,
      error: null,
    });
    // M5.7: warm the beat chips when the feature is on for this chat.
    if (config.settings.nextBeats?.enabled) {
      void get().generateNextBeats();
    }
  },

  closeChat() {
    if (get().stream) return;
    set({
      activeChatId: null,
      character: null,
      messages: [],
      activeLeafId: null,
      stream: null,
      members: [],
      chapters: [],
      nextBeats: [],
      consistencyWarnings: [],
    });
  },

  async startChat(characterId, personaId) {
    const character = await getCharacter(characterId);
    if (!character) return;
    const greetings = [character.first_message, ...character.alt_greetings].filter((g) =>
      g.trim(),
    );
    const chat = await createChat(characterId, personaId, greetings);
    await renameChat(chat.id, character.name);
    await get().refreshChats();
    await get().openChat(chat.id);
  },

  async deleteChat(id) {
    if (get().stream) return;
    await softDeleteChat(id);
    if (get().activeChatId === id) get().closeChat();
    await get().refreshChats();
  },

  async setChatFlags(id, flags) {
    await setChatFlags(id, flags);
    await get().refreshChats();
  },

  async setChatTags(id, tags) {
    await setChatTags(id, tags);
    await get().refreshChats();
  },

  async importChat(input) {
    const chat = await createChat(input.characterId, input.personaId, []);
    await renameChat(chat.id, input.title);
    const idMap = new Map<string, string>();
    let prev: string | null = null;
    let ord = 0;
    let lastId: string | null = null;
    for (const turn of input.turns) {
      // Hearth backups carry explicit parents; other formats chain linearly.
      const parent =
        turn.parentRef !== undefined ? (turn.parentRef ? idMap.get(turn.parentRef) ?? null : null) : prev;
      const m = await insertMessage({
        chat_id: chat.id,
        parent_id: parent,
        ord: ord++,
        role: turn.role,
        content: turn.content,
      });
      if (turn.ref) idMap.set(turn.ref, m.id);
      prev = m.id;
      lastId = m.id;
    }
    if (lastId) await setActiveLeaf(chat.id, lastId);
    await get().refreshChats();
    await get().openChat(chat.id);
  },

  async send(text) {
    const { activeChatId, activeLeafId, stream, members, genSettings } = get();
    if (!activeChatId || stream || get().compare || !text.trim()) return;
    // M5.6: incoming rules rewrite user text before it is stored or sent.
    const processed = applyRules(text, genSettings.outputRules ?? [], { direction: 'in' });
    const msg = await insertMessage({
      chat_id: activeChatId,
      parent_id: activeLeafId,
      ord: nextOrd(get().messages, activeLeafId),
      role: 'user',
      content: processed,
    });
    await setActiveLeaf(activeChatId, msg.id);
    set({ activeLeafId: msg.id });
    set({ messages: await listMessages(activeChatId) });
    // M5.2: group chats route the reply to ONE cast member per turn
    // (manual mode stays silent — the user picks a speaker via the chips).
    const order = genSettings.group?.turnOrder ?? (members.length > 0 ? 'round-robin' : null);
    if (order && order !== 'manual') {
      const picked = resolveGroupSpeaker(members, order, genSettings.group?.cursor ?? 0, text);
      if (picked) {
        const merged = {
          ...genSettings,
          group: { ...genSettings.group, turnOrder: order, cursor: picked.nextCursor },
        };
        await saveChatSettings(activeChatId, merged);
        set({ genSettings: merged });
        await generateAssistant(set, get, msg.id, undefined, undefined, picked.speakerId);
        return;
      }
    }
    await generateAssistant(set, get, msg.id);
  },

  async stop() {
    const { generationId, stream } = get();
    if (!generationId || !stream) return;
    await transport.invoke('provider_cancel', { generation_id: generationId }).catch(() => {});
    await finalizeStream(set, get, 'interrupted');
  },

  async startCompare(count = 3) {
    const { stream, compare, activeChatId, activeLeafId } = get();
    if (stream || compare || !activeChatId) return;
    await runCompareInternal(set, get, count, activeLeafId);
  },

  async pickCandidate(index) {
    const { compare, activeChatId, activeLeafId, messages } = get();
    const picked = compare?.candidates[index];
    if (!compare || !activeChatId || !picked || picked.status !== 'done') return;
    // Stop anything still streaming, then materialize all candidates as
    // siblings (swipes) under the current leaf; the picked one becomes active.
    for (const c of compare.candidates) {
      if (c.status === 'streaming') {
        await transport.invoke('provider_cancel', { generation_id: c.genId }).catch(() => {});
      }
    }
    const base = nextOrd(messages, activeLeafId);
    let pickedId: string | null = null;
    for (const [i, c] of compare.candidates.entries()) {
      if (c.status !== 'done' || !c.text.trim()) continue;
      const m = await insertMessage({
        chat_id: activeChatId,
        parent_id: activeLeafId,
        ord: base + i,
        role: 'assistant',
        content: c.text,
        speaker_character_id: compare.speakerCharacterId ?? null,
      });
      if (i === index) pickedId = m.id;
    }
    cleanupCompareListeners();
    set({ compare: null });
    if (pickedId) {
      await setActiveLeaf(activeChatId, pickedId);
      set({ activeLeafId: pickedId });
    }
    set({ messages: await listMessages(activeChatId) });
    void useChat.getState().runDirectorNow().catch(() => {});
  },

  async cancelCompare() {
    const { compare } = get();
    if (!compare) return;
    for (const c of compare.candidates) {
      if (c.status === 'streaming') {
        await transport.invoke('provider_cancel', { generation_id: c.genId }).catch(() => {});
      }
    }
    cleanupCompareListeners();
    set({ compare: null });
  },

  // ---- M5.2 group chats ----

  async addMember(characterId) {
    const { activeChatId } = get();
    if (!activeChatId) return;
    await addChatMember(activeChatId, characterId);
    set({ members: await loadMembers(activeChatId) });
  },

  async removeMember(memberId) {
    await removeChatMember(memberId);
    const { activeChatId } = get();
    if (activeChatId) set({ members: await loadMembers(activeChatId) });
  },

  async setMemberMute(memberId, mute) {
    await setMemberMute(memberId, mute);
    const { activeChatId } = get();
    if (activeChatId) set({ members: await loadMembers(activeChatId) });
  },

  async setTurnOrder(mode) {
    const { activeChatId, genSettings } = get();
    if (!activeChatId) return;
    const merged = { ...genSettings, group: { ...genSettings.group, turnOrder: mode } };
    await saveChatSettings(activeChatId, merged);
    set({ genSettings: merged });
  },

  /** Manual mode: the named cast member (null = the lead) replies now. */
  async speakAs(speakerCharacterId) {
    const { activeChatId, activeLeafId, stream, compare } = get();
    if (!activeChatId || stream || compare) return;
    await generateAssistant(set, get, activeLeafId, undefined, undefined, speakerCharacterId);
  },

  // ---- M5.4 chapters ----

  async startChapterAt(messageId) {
    const { activeChatId, chapters, messages } = get();
    if (!activeChatId || !messages.some((m) => m.id === messageId)) return;
    const created = await createChapter(activeChatId, `Chapter ${chapters.length + 1}`, messageId, chapters.length + 1);
    const updated = [...chapters, created];
    set({ chapters: updated });
    // The chapter just closed is the previous one — auto-summarize it once
    // (best effort; a missing summary can always be generated later).
    const previous = updated[updated.length - 2];
    if (previous && !previous.summary) {
      void get()
        .summarizeChapter(previous.id)
        .catch(() => {});
    }
  },

  async renameChapter(chapterId, title) {
    if (!title.trim()) return;
    await dbRenameChapter(chapterId, title.trim());
    set({
      chapters: get().chapters.map((c) => (c.id === chapterId ? { ...c, title: title.trim() } : c)),
    });
  },

  async deleteChapter(chapterId) {
    await dbDeleteChapter(chapterId);
    set({ chapters: get().chapters.filter((c) => c.id !== chapterId) });
  },

  async summarizeChapter(chapterId) {
    const { activeChatId, activeLeafId, messages, chapters, stream } = get();
    if (!activeChatId || stream) return;
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) return;
    const path = activePath(messages, activeLeafId);
    if (!path.some((m) => m.id === chapter.anchor_message_id)) {
      set({ error: 'That chapter starts on a different branch — switch to it or delete the chapter.' });
      return;
    }
    const sorted = [...chapters].sort((a, b) => a.ord - b.ord);
    const idx = sorted.findIndex((c) => c.id === chapterId);
    const next = sorted[idx + 1];
    const anchorIdx = path.findIndex((m) => m.id === chapter.anchor_message_id);
    const endIdx = next ? path.findIndex((m) => m.id === next.anchor_message_id) : path.length;
    const span = path
      .slice(anchorIdx + 1, endIdx < 0 ? path.length : endIdx)
      .filter((m) => m.deleted_at === null && !m.hidden && m.role !== 'system');
    if (span.length === 0) {
      set({ error: 'Nothing to summarize in that chapter yet.' });
      return;
    }
    let profile, model;
    try {
      ({ profile, model } = await resolveProvider('utility'));
    } catch (e) {
      set({ error: String(e instanceof Error ? e.message : e) });
      return;
    }
    set({ busy: true, error: null });
    try {
      const transcript = span
        .slice(-80)
        .map((m) => `${m.role === 'assistant' ? 'AI' : m.role === 'user' ? 'USER' : 'NARRATOR'}: ${m.content}`)
        .join('\n');
      const wire = [
        {
          role: 'system' as const,
          content:
            'You summarize chapters of a roleplay story. Write at most 100 words of plain prose capturing what happened. No commentary.',
        },
        { role: 'user' as const, content: `Chapter "${chapter.title}" transcript:\n${transcript}` },
      ];
      const text = await streamCollect(wire, profile, model);
      await setChapterSummary(chapterId, text.trim());
      set({
        chapters: get().chapters.map((c) => (c.id === chapterId ? { ...c, summary: text.trim() } : c)),
      });
    } catch (e) {
      set({ error: String(e instanceof Error ? e.message : e) });
    } finally {
      set({ busy: false });
    }
  },

  /** "Previously on…" — generates any missing chapter summaries; returns how many were made. */
  async summarizeMissingChapters() {
    const { chapters, activeLeafId, messages } = get();
    const sorted = [...chapters].sort((a, b) => a.ord - b.ord);
    let made = 0;
    for (const c of sorted) {
      if (c.summary) continue;
      // Skip chapters whose anchor is not on the active path (can't span them).
      if (!activeLeafId || !messages.some((m) => m.id === c.anchor_message_id)) continue;
      await get().summarizeChapter(c.id);
      if (get().chapters.find((x) => x.id === c.id)?.summary) made += 1;
    }
    return made;
  },

  /** M5.6: scratchpad note — visible in the chat, never sent to the model. */
  async sendOoc(text) {
    const { activeChatId, activeLeafId, stream } = get();
    if (!activeChatId || stream || !text.trim()) return;
    await insertMessage({
      chat_id: activeChatId,
      parent_id: activeLeafId,
      ord: nextOrd(get().messages, activeLeafId),
      role: 'system',
      content: text,
    });
    set({ messages: await listMessages(activeChatId) });
  },

  /** M5.6: replace this chat's output-rule list (chats.settings JSON). */
  async saveOutputRules(rules) {
    const { activeChatId, genSettings } = get();
    if (!activeChatId) return;
    const merged = { ...genSettings, outputRules: rules };
    await saveChatSettings(activeChatId, merged);
    set({ genSettings: merged });
  },

  /** M5.7: toggle the next-beat chips for this chat. */
  async setNextBeatsEnabled(enabled) {
    const { activeChatId, genSettings } = get();
    if (!activeChatId) return;
    const merged = { ...genSettings, nextBeats: { ...genSettings.nextBeats, enabled } };
    await saveChatSettings(activeChatId, merged);
    set({ genSettings: merged, nextBeats: [] });
    if (enabled) void get().generateNextBeats();
  },

  /** M5.7: ask the utility model for 3 short next-beat suggestions (best-effort). */
  async generateNextBeats() {
    const { activeChatId, activeLeafId, messages, genSettings, busy, stream } = get();
    if (!activeChatId || busy || stream || genSettings.nextBeats?.enabled !== true) return;
    let profile, model;
    try {
      ({ profile, model } = await resolveProvider('utility'));
    } catch {
      return;
    }
    const recent = activePath(messages, activeLeafId)
      .filter((m) => m.role !== 'system' && m.deleted_at === null)
      .slice(-8);
    if (recent.length === 0) return;
    const transcript = recent
      .map((m) => `${m.role === 'assistant' ? 'AI' : m.role === 'user' ? 'USER' : 'N'}: ${m.content.slice(0, 600)}`)
      .join('\n');
    set({ busy: true });
    try {
      const wire = [
        {
          role: 'system' as const,
          content:
            'Suggest exactly 3 short next actions the USER could take to move the story forward. One per line, at most 8 words each, no numbering, no quotes, no commentary.',
        },
        { role: 'user' as const, content: transcript },
      ];
      const text = await streamCollect(wire, profile, model);
      const beats = text
        .split('\n')
        .map((l) => l.replace(/^[\d.)\-\s*]+/, '').trim())
        .filter(Boolean)
        .slice(0, 3);
      set({ nextBeats: beats });
    } catch {
      // chips are best-effort — a failure leaves the previous ones in place
    } finally {
      set({ busy: false });
    }
  },

  /** M5.9: zero-token scan of the latest reply against pinned memory facts. */
  async checkConsistency() {
    const { activeChatId, messages, activeLeafId, memoryItems, genSettings } = get();
    if (!activeChatId || genSettings.consistency?.enabled === false) return;
    const lastReply = activePath(messages, activeLeafId)
      .filter((m) => m.role === 'assistant' && m.deleted_at === null)
      .at(-1);
    if (!lastReply) return;
    const facts = memoryItems.filter((m) => m.pinned === 1 && m.enabled === 1).map((m) => m.text);
    set({ consistencyWarnings: checkConsistency({ reply: lastReply.content, facts }) });
  },

  clearConsistencyWarnings() {
    set({ consistencyWarnings: [] });
  },

  /** M5.9: toggle the consistency guard for this chat. */
  async setConsistencyEnabled(enabled) {
    const { activeChatId, genSettings } = get();
    if (!activeChatId) return;
    const merged = { ...genSettings, consistency: { ...genSettings.consistency, enabled } };
    await saveChatSettings(activeChatId, merged);
    set({ genSettings: merged });
    if (!enabled) set({ consistencyWarnings: [] });
  },

  /** M5.5 writing aid: rewrite a draft/message via the utility model. */
  async rewriteText(text, mode) {
    if (!text.trim()) throw new Error('nothing to rewrite');
    let profile, model;
    try {
      ({ profile, model } = await resolveProvider('utility'));
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      set({ error: msg });
      throw new Error(msg);
    }
    set({ busy: true, error: null });
    try {
      const wire = [
        {
          role: 'system' as const,
          content: `You are a writing assistant inside a roleplay app. ${REWRITE_INSTRUCTIONS[mode]}`,
        },
        { role: 'user' as const, content: text },
      ];
      return await streamCollect(wire, profile, model);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ busy: false });
    }
  },

  async regenerate() {
    const { stream, messages, activeLeafId } = get();
    if (stream || !activeLeafId) return;
    const last = activePath(messages, activeLeafId).at(-1);
    if (!last || last.role !== 'assistant') return;
    await get().regenerateMessage(last.id);
  },

  /**
   * Regenerates ANY assistant message as a new swipe at that point: the new
   * reply is generated from the story up to (not including) the target, and
   * the active path moves onto it — the old reply and its continuation stay
   * on their branch, reachable via swipes.
   */
  async regenerateMessage(messageId) {
    const { stream, messages, activeChatId } = get();
    if (stream || !activeChatId) return;
    const target = messages.find((m) => m.id === messageId);
    if (!target || target.role !== 'assistant' || target.status === 'streaming') return;
    await generateAssistant(set, get, target.parent_id, target.ord + 1, undefined, target.speaker_character_id);
  },

  async continueLast() {
    const { stream, messages, activeLeafId } = get();
    if (stream || !activeLeafId) return;
    const last = activePath(messages, activeLeafId).at(-1);
    if (!last || last.role !== 'assistant' || last.status !== 'interrupted') return;
    await generateAssistant(set, get, last.parent_id, undefined, last, last.speaker_character_id);
  },

  async impersonate() {
    const { stream, activeLeafId } = get();
    if (stream || !activeLeafId) return null;
    return impersonateInternal(set, get);
  },

  async editMessage(id, content, asBranch) {
    const { activeChatId, messages, stream } = get();
    if (stream || !activeChatId) return;
    const original = messages.find((m) => m.id === id);
    if (!original) return;
    if (asBranch) {
      const dup = await insertMessage({
        chat_id: original.chat_id,
        parent_id: original.parent_id,
        ord: nextOrd(messages, original.parent_id),
        role: original.role,
        content,
      });
      await setActiveLeaf(activeChatId, dup.id);
      set({ activeLeafId: dup.id });
    } else {
      await recordEdit(id, original.content);
      await updateMessageContent(id, content);
    }
    set({ messages: await listMessages(activeChatId) });
  },

  async deleteMessage(id, withSubtree) {
    const { activeChatId, messages, stream } = get();
    if (stream || !activeChatId) return;
    const ids = withSubtree ? [id, ...descendantIds(messages, id)] : [id];
    for (const mid of ids) await softDeleteMessage(mid);
    const onPath = activePath(messages, get().activeLeafId).some((m) => ids.includes(m.id));
    if (onPath) {
      const fallback = nearestSurvivingAncestor(messages, id);
      const leafId = fallback?.id ?? null;
      if (leafId) await setActiveLeaf(activeChatId, leafId);
      set({ activeLeafId: leafId });
    }
    set({ messages: await listMessages(activeChatId) });
  },

  async branchFrom(id) {
    const { activeChatId, messages, stream } = get();
    if (stream || !activeChatId) return;
    const original = messages.find((m) => m.id === id);
    if (!original) return;
    const dup = await insertMessage({
      chat_id: original.chat_id,
      parent_id: original.parent_id,
      ord: nextOrd(messages, original.parent_id),
      role: original.role,
      content: original.content,
    });
    await setActiveLeaf(activeChatId, dup.id);
    set({ activeLeafId: dup.id, messages: await listMessages(activeChatId) });
  },

  async forkToNewChat(id) {
    const { messages, character, persona, stream } = get();
    if (stream || !character) return;
    const current = get();
    const path = activePath(messages, current.activeLeafId);
    const cut = path.findIndex((m) => m.id === id);
    if (cut < 0) return;
    const toCopy = path.slice(0, cut + 1);
    const chat = await createChat(character.id, persona?.id ?? null, []);
    let parentId: string | null = null;
    for (const m of toCopy) {
      const copy = await insertMessage({
        chat_id: chat.id,
        parent_id: parentId,
        role: m.role,
        content: m.content,
      });
      parentId = copy.id;
    }
    if (parentId) await setActiveLeaf(chat.id, parentId);
    await renameChat(chat.id, `${character.name} (fork)`);
    await get().refreshChats();
    await get().openChat(chat.id);
  },

  async switchToSibling(messageId, dir) {
    const { messages, activeChatId, stream } = get();
    if (stream || !activeChatId) return;
    const target = messages.find((m) => m.id === messageId);
    if (!target) return;
    const sibs = messages
      .filter((m) => m.parent_id === target.parent_id && m.deleted_at === null && m.role === target.role)
      .sort((a, b) => a.ord - b.ord);
    const idx = sibs.findIndex((s) => s.id === messageId);
    const next = sibs[idx + dir];
    if (!next) return;
    const leaf = deepestLeaf(messages, next);
    await setActiveLeaf(activeChatId, leaf.id);
    set({ activeLeafId: leaf.id, messages: await listMessages(activeChatId) });
  },

  /** Branch Map: activate exactly this node as the reading position. */
  async jumpToNode(messageId) {
    const { activeChatId, stream } = get();
    if (stream || !activeChatId) return;
    await setActiveLeaf(activeChatId, messageId);
    set({ activeLeafId: messageId, messages: await listMessages(activeChatId) });
  },

  /** Branch Map: soft-delete a whole branch; returns ids for undo. */
  async pruneBranch(messageId) {
    const { activeChatId, messages, stream } = get();
    if (stream || !activeChatId) return [];
    const ids = [messageId, ...descendantIds(messages, messageId)];
    await softDeleteMessages(ids);
    const leaf = nearestSurvivingAncestor(messages, messageId);
    if (leaf) {
      await setActiveLeaf(activeChatId, leaf.id);
      set({ activeLeafId: leaf.id });
    }
    set({ messages: await listMessages(activeChatId) });
    return ids;
  },

  async undoPrune(ids) {
    const { activeChatId } = get();
    if (!activeChatId || ids.length === 0) return;
    await restoreMessages(ids);
    set({ messages: await listMessages(activeChatId) });
  },

  /** Branch Map: permanently destroy every soft-deleted message in this chat. */
  async prunePermanently() {
    const { activeChatId, messages } = get();
    if (!activeChatId) return 0;
    const ids = messages.filter((m) => m.deleted_at !== null).map((m) => m.id);
    if (ids.length === 0) return 0;
    await hardDeleteMessages(ids);
    set({ messages: await listMessages(activeChatId) });
    return ids.length;
  },

  async setPersona(personaId) {
    const { activeChatId, personas } = get();
    if (!activeChatId) return;
    await setChatPersona(activeChatId, personaId);
    set({
      persona: personas.find((p) => p.id === personaId) ?? null,
      messages: await listMessages(activeChatId),
    });
  },

  async saveGenParams(params) {
    const { activeChatId, genSettings } = get();
    if (!activeChatId) return;
    const merged = { ...genSettings, params: { ...genSettings.params, ...params } };
    await saveChatSettings(activeChatId, merged);
    set({ genSettings: merged });
  },

  async saveContextTokens(tokens) {
    const { activeChatId, genSettings } = get();
    if (!activeChatId) return;
    const merged = { ...genSettings, context_tokens: tokens > 0 ? tokens : undefined };
    await saveChatSettings(activeChatId, merged);
    set({ genSettings: merged });
  },

  async saveAccent(enabled) {
    const { activeChatId, genSettings } = get();
    if (!activeChatId) return;
    const merged = { ...genSettings, accent: { enabled } };
    await saveChatSettings(activeChatId, merged);
    set({ genSettings: merged });
  },

  async saveModelOverride(profileId, model) {
    const { activeChatId } = get();
    if (!activeChatId) return;
    const overrides: ChatOverrides = profileId
      ? { main: { profile_id: profileId, model: model || undefined } }
      : {};
    await saveChatOverrides(activeChatId, overrides);
    set({ modelOverride: overrides.main ?? null });
  },

  async toggleBookmark(messageId, bookmarked) {
    const { activeChatId } = get();
    await setMessageBookmark(messageId, bookmarked);
    if (activeChatId) set({ messages: await listMessages(activeChatId) });
  },

  async refreshPrompts() {
    set({ prompts: await listPromptPresets() });
  },

  async addPrompt(name) {
    if (!name.trim()) return null;
    const created = await createPromptPreset(name.trim(), '');
    set({ prompts: await listPromptPresets() });
    return created.id;
  },

  async updatePrompt(id, patch) {
    await updatePromptPreset(id, patch);
    set({ prompts: await listPromptPresets() });
  },

  async deletePrompt(id) {
    await dbDeletePromptPreset(id);
    const { activeChatId, genSettings, activePromptId } = get();
    const prompts = await listPromptPresets();
    set({ prompts });
    if (activePromptId === id && activeChatId) {
      const merged = { ...genSettings, active_prompt_id: null };
      await saveChatSettings(activeChatId, merged);
      set({ activePromptId: null, genSettings: merged });
    }
  },

  async selectPrompt(id) {
    const { activeChatId, genSettings } = get();
    if (!activeChatId) return;
    const merged = { ...genSettings, active_prompt_id: id };
    await saveChatSettings(activeChatId, merged);
    set({ activePromptId: id, genSettings: merged });
  },

  async refreshMemory() {
    const { activeChatId, character } = get();
    if (!activeChatId || !character) return;
    const [memoryItems, summary] = await Promise.all([
      listMemoryItems([
        { scope: 'global', scopeId: null },
        { scope: 'character', scopeId: character.id },
        { scope: 'chat', scopeId: activeChatId },
      ]),
      latestSummary(activeChatId),
    ]);
    set({ memoryItems, summary });
  },

  async addMemory(text, importance) {
    const { activeChatId, character } = get();
    if (!activeChatId || !character || !text.trim()) return;
    await createMemoryItem({ scope: 'chat', scopeId: activeChatId, text: text.trim(), importance });
    await get().refreshMemory();
  },

  async updateMemory(id, patch) {
    await updateMemoryItem(id, patch);
    await get().refreshMemory();
  },

  async deleteMemory(id) {
    await deleteMemoryItem(id);
    await get().refreshMemory();
  },

  async summarizeNow() {
    const { activeChatId, activeLeafId, stream, messages } = get();
    if (!activeChatId || stream) return;
    const history = visibleHistory(messages, activeLeafId);
    if (history.length < 4) {
      set({ error: 'Not enough history to summarize yet (need at least 4 messages).' });
      return;
    }
    let profile, model;
    try {
      ({ profile, model } = await resolveProvider('utility'));
    } catch (e) {
      set({ error: String(e instanceof Error ? e.message : e) });
      return;
    }
    set({ busy: true, error: null });
    try {
      const transcript = history
        .slice(-60)
        .map((m) => `${m.role === 'assistant' ? 'AI' : m.role === 'user' ? 'USER' : 'NARRATOR'}: ${m.content}`)
        .join('\n');
      const wire = [
        {
          role: 'system' as const,
          content:
            'You compress roleplay transcripts. Write at most 150 words summarizing the key events, commitments, promises, and relationship changes. Plain prose, no commentary.',
        },
        { role: 'user' as const, content: `Transcript:\n${transcript}` },
      ];
      const text = await streamCollect(wire, profile, model);
      const anchor = activeLeafId ?? history[history.length - 1]?.id ?? null;
      if (anchor) {
        await createSummary({ chatId: activeChatId, anchorMessageId: anchor, content: text, model });
        await logUsage({
          purpose: 'summary',
          profileId: profile.id,
          model,
          promptTokens: wire.reduce((s, m) => s + Math.ceil(m.content.length / 3.7), 0),
          completionTokens: Math.ceil(text.length / 3.7),
          chatId: activeChatId,
        }).catch(() => {});
        await get().refreshMemory();
      }
    } catch (e) {
      set({ error: String(e instanceof Error ? e.message : e) });
    } finally {
      set({ busy: false });
    }
  },

  async deleteSummaryRow() {
    const { summary } = get();
    if (!summary) return;
    await deleteSummary(summary.id);
    await get().refreshMemory();
  },

  /** Rebuilds the prompt for the current state — powers the meter + Inspector. */
  async previewBuild() {
    const { activeChatId, activeLeafId } = get();
    if (!activeChatId || get().stream) return;
    try {
      const built = await buildContext(get, activeLeafId);
      set({ lastBuild: built });
    } catch (e) {
      set({
        lastBuild: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  async setThreadStatus(threadId, status) {
    const { activeChatId, activeLeafId } = get();
    if (!activeChatId || !activeLeafId) return;
    await appendLedgerEvent({
      chatId: activeChatId,
      anchorMessageId: activeLeafId,
      eventType: 'thread_update',
      payload: { threadId, status },
      source: 'user',
    });
    set({ ledgerEvents: await listLedgerEvents(activeChatId) });
  },

  async deleteThread(threadId) {
    const { activeChatId, activeLeafId } = get();
    if (!activeChatId || !activeLeafId) return;
    await appendLedgerEvent({
      chatId: activeChatId,
      anchorMessageId: activeLeafId,
      eventType: 'thread_delete',
      payload: { threadId },
      source: 'user',
    });
    set({ ledgerEvents: await listLedgerEvents(activeChatId) });
  },

  /** Manual mode (§9.3): the user creates a thread directly; keywords derive from the title. */
  async addThreadManual(title) {
    const { activeChatId, activeLeafId } = get();
    if (!activeChatId || !activeLeafId || !title.trim()) return;
    const keywords = title
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length > 3)
      .slice(0, 4);
    await appendLedgerEvent({
      chatId: activeChatId,
      anchorMessageId: activeLeafId,
      eventType: 'thread_create',
      payload: {
        thread: {
          id: uuidv7(),
          kind: 'quest',
          title: title.trim(),
          detail: '',
          keywords,
          importance: 2,
          status: 'pending',
        },
      },
      source: 'user',
    });
    set({ ledgerEvents: await listLedgerEvents(activeChatId) });
  },

  async updateScene(field, value) {
    const { activeChatId, activeLeafId } = get();
    if (!activeChatId || !activeLeafId) return;
    await appendLedgerEvent({
      chatId: activeChatId,
      anchorMessageId: activeLeafId,
      eventType: 'scene_set',
      payload: { field, value },
      source: 'user',
    });
    set({ ledgerEvents: await listLedgerEvents(activeChatId) });
  },

  async setLedgerEnabled(enabled) {
    const { activeChatId, genSettings } = get();
    if (!activeChatId) return;
    const merged = { ...genSettings, ledger: { ...genSettings.ledger, enabled } };
    await saveChatSettings(activeChatId, merged);
    set({ genSettings: merged });
  },

  async resolveSuggestion(suggestionId, accept) {
    const { activeChatId, memoryItems, ledgerEvents, activeLeafId } = get();
    if (!activeChatId) return;
    const suggestion = get().suggestions.find((s) => s.id === suggestionId);
    if (!suggestion) return;
    const payload = safeParseSuggestion(suggestion.payload);
    if (accept) {
      if (suggestion.kind === 'memory') {
        const text = String(payload?.text ?? '');
        if (text) await createMemoryItem({ scope: 'chat', scopeId: activeChatId, text, importance: 2 });
        await get().refreshMemory();
      } else if (payload?.thread) {
        // thread suggestion: materialize as a real thread_create
        await appendLedgerEvent({
          chatId: activeChatId,
          anchorMessageId: activeLeafId ?? '',
          eventType: 'thread_create',
          payload: { thread: payload.thread },
          source: 'ai',
          confidence: typeof payload.confidence === 'number' ? payload.confidence : undefined,
        });
        set({ ledgerEvents: await listLedgerEvents(activeChatId) });
      }
    }
    await setSuggestionStatus(suggestionId, accept ? 'saved' : 'dismissed');
    set({ suggestions: await listSuggestions(activeChatId) });
    void memoryItems;
    void ledgerEvents;
  },

  /**
   * §9.3 Director run — called after each completed send. Stage 1 gate costs
   * zero tokens; no trigger ⇒ no call (acceptance test 4).
   */
  async runDirectorNow() {
    const { activeChatId, activeLeafId, messages, ledgerEvents, genSettings, character, stream } = get();
    if (!activeChatId || stream || !character) return;
    if (genSettings.ledger?.enabled === false) return;
    const path = activePath(messages, activeLeafId);
    if (path.length < 2) return;

    const pathIds = path.map((m) => m.id);
    const fold = foldLedger(ledgerEvents, pathIds);
    const openThreads = threadsForDisplay(fold).filter((t) => t.status === 'pending' || t.status === 'active');
    const newMessage = path[path.length - 1]?.content ?? '';
    const recentMessages = path.slice(-3, -1).map((m) => m.content);

    const gate = gateDirectorCall({
      newMessage,
      recentMessages,
      openThreadKeywords: openThreads.flatMap((t) => t.keywords),
      messagesSinceLastRun: messagesSinceLastRun(pathIds.length, fold.lastRunPathIndex),
      runEveryN: 15,
    });
    if (!gate.shouldRun) return;

    let profile, model;
    try {
      ({ profile, model } = await resolveProvider('utility'));
    } catch (e) {
      set({ error: String(e instanceof Error ? e.message : e) });
      return;
    }

    const directorWire = [
      {
        role: 'system' as const,
        content:
          'You are the Director sidecar for a roleplay. Track narrative commitments. Reply with ONLY a JSON object, no prose: ' +
          '{"none":true} when nothing changed, or {"none":false,"new_threads":[{"kind":"quest|promise|appointment|mystery|obligation|threat|secret|custom","title":"<=8 words","detail":"one line","keywords":["..."],"importance":1|2|3,"confidence":0-1}],' +
          '"updates":[{"id":"<existing thread id>","status":"pending|active|fulfilled|failed|abandoned","evidence":"one line"}],' +
          '"scene":{"location":"..."},"memory_suggestions":[{"scope":"persona|chat","text":"...","confidence":0-1}]}. ' +
          'Create a thread ONLY for commitments/objectives with future payoff (max 2). Use existing thread ids for updates.',
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          open_threads: openThreads.map((t) => ({ id: t.id, title: t.title, keywords: t.keywords, status: t.status, importance: t.importance })),
          recent_messages: [newMessage, ...recentMessages].slice(0, 4),
          scene: fold.scene,
        }),
      },
    ];

    set({ busy: true });
    try {
      let output;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await streamCollect(directorWire, profile, model);
          output = validateDirectorOutput(extractJsonCandidate(raw));
          break;
        } catch (e) {
          if (attempt === 1) throw e;
        }
      }
      if (!output || output.none) return;

      const anchor = activeLeafId ?? pathIds[pathIds.length - 1] ?? '';
      for (const t of output.new_threads) {
        const id = uuidv7();
        const autoAccept = genSettings.ledger?.autoAccept ?? 0.9;
        await appendLedgerEvent({
          chatId: activeChatId,
          anchorMessageId: anchor,
          eventType: 'thread_create',
          payload: {
            thread: {
              id,
              kind: t.kind,
              title: t.title,
              detail: t.detail ?? '',
              keywords: t.keywords ?? [],
              importance: t.importance ?? 2,
              status: (t.confidence ?? 0) >= autoAccept ? 'pending' : 'suggested',
            },
            confidence: t.confidence,
          },
          source: 'ai',
          confidence: t.confidence,
        });
      }
      for (const u of output.updates) {
        await appendLedgerEvent({
          chatId: activeChatId,
          anchorMessageId: anchor,
          eventType: 'thread_update',
          payload: { threadId: u.id, status: u.status, evidence: u.evidence },
          source: 'ai',
          confidence: u.confidence,
        });
      }
      for (const [field, value] of Object.entries(output.scene)) {
        await appendLedgerEvent({
          chatId: activeChatId,
          anchorMessageId: anchor,
          eventType: 'scene_set',
          payload: { field, value },
          source: 'ai',
        });
      }
      for (const m of output.memory_suggestions) {
        await addSuggestion({ chatId: activeChatId, kind: 'memory', payload: m });
      }
      await appendLedgerEvent({
        chatId: activeChatId,
        anchorMessageId: anchor,
        eventType: 'detector_run',
        payload: { reasons: gate.reasons },
        source: 'heuristic',
      });
      set({
        ledgerEvents: await listLedgerEvents(activeChatId),
        suggestions: await listSuggestions(activeChatId),
      });
    } catch (e) {
      // Director failures are silent for the chat flow; surfaced in console only
      console.warn('[director]', e);
    } finally {
      set({ busy: false });
    }
  },
}));

// ---- generation internals ----

type SetFn = (partial: Partial<ChatStore>) => void;
type GetFn = () => ChatStore;

async function resolveProvider(slot: 'main' | 'utility' = 'main', override?: ChatOverrides['main'] | null) {
  // Per-chat override applies to the main slot only (D-024).
  if (slot === 'main' && override?.profile_id) {
    const profiles = await listProviderProfiles();
    const profile = profiles.find((p) => p.id === override.profile_id);
    if (profile) {
      const model = override.model || profile.default_model;
      if (model) return { profile, model };
      throw new Error('No model selected for this chat override.');
    }
    // Override points at a removed profile → fall through to the global slot.
  }
  const slots = await getModelSlots();
  const row = slots.find((s) => s.slot === slot);
  if (!row?.profile_id) {
    throw new Error(
      slot === 'utility'
        ? 'No utility model slot configured — set one in Providers (used for summaries).'
        : 'No main model slot configured — set one in Providers.',
    );
  }
  const profiles = await listProviderProfiles();
  const profile = profiles.find((p) => p.id === row.profile_id);
  if (!profile) throw new Error(`The ${slot} slot points at a missing provider profile.`);
  const model = row.model ?? profile.default_model;
  if (!model) throw new Error(`No model selected for the ${slot} slot.`);
  return { profile, model };
}

/**
 * M2 pipeline: layered memory + lore triggering + rolling summary + ledger +
 * scene blocks + the block-level builder. Shared by generation, impersonation,
 * and the meter. M5.2: passing `speakerCharacterId` swaps a group member's
 * character card in, adds the protected cast roster block, and labels the
 * other speakers in history.
 */
async function buildContext(get: GetFn, leafId: string | null, opts?: { speakerCharacterId?: string | null }) {
  const { character, persona, messages, genSettings, prompts, activePromptId, memoryItems, summary, ledgerEvents, activeChatId, members } = get();
  if (!character || !activeChatId) throw new Error('no active chat');
  const activePrompt = prompts.find((p) => p.id === activePromptId) ?? null;

  const speaker = opts?.speakerCharacterId ?? null;
  const memberSpeaker =
    speaker && speaker !== character.id ? await getCharacter(speaker).catch(() => null) : null;
  const responder = memberSpeaker ?? character;
  const isGroup = members.length > 0;

  const rawHistory = visibleHistory(messages, leafId);
  let history = rawHistory;
  if (isGroup) {
    const nameOf = new Map<string, string>(members.map((m) => [m.character_id, m.name]));
    nameOf.set(character.id, character.name);
    history = rawHistory.map((h) => {
      if (h.role !== 'assistant') return h;
      const speakerName =
        (h.speaker_character_id ? nameOf.get(h.speaker_character_id) : undefined) ?? character.name;
      return speakerName !== responder.name ? { ...h, content: `${speakerName}: ${h.content}` } : h;
    });
  }
  const groupBlock = isGroup
    ? [
        '[Group scene] This scene is shared by several characters:',
        ...members.map((m) => `- ${m.name}${m.mute === 1 ? ' (muted)' : ''}`),
        `The user plays ${persona?.name ?? 'User'} — never write their dialogue or actions.`,
        `Exactly ONE character speaks per turn. The current speaker is ${responder.name}: write ONLY ${responder.name}'s next message, fully in ${responder.name}'s voice. Other characters' earlier lines are prefixed with their names.`,
      ].join('\n')
    : null;

  // Advanced prompt entries (F17): global + this character + this chat,
  // in the user's drag order.
  let promptEntries: PromptEntryLike[] = [];
  try {
    const rows = await listPromptEntries();
    promptEntries = rows
      .filter((r) => r.enabled === 1)
      .filter((r) => r.scope === 'global' || (r.scope === 'character' && r.scope_id === character.id) || (r.scope === 'chat' && r.scope_id === activeChatId))
      .map((r) => ({
        id: r.id,
        name: r.name,
        content: r.content,
        role: r.role,
        locked: r.locked === 1,
        anchor: r.anchor,
        depth: r.depth,
        timing: r.timing,
        period: r.period,
        phase: r.phase,
        tokenBudget: r.token_budget,
        trimPriority: r.trim_priority,
      }));
  } catch {
    // entries failing never block chatting
  }

  let firedLore: ReturnType<typeof fireLore> = [];
  try {
    // Member speaker: fire the RESPONDER's lore so their own cards trigger.
    const entries = await loreEntriesForContext(responder.id, activeChatId);
    if (entries.length > 0) {
      firedLore = fireLore(entries as LoreEntryLike[], rawHistory.slice(-6));
    }
  } catch {
    // lore failures never block chatting
  }

  const pathIds = activePath(messages, leafId).map((m) => m.id);
  // Ledger off = threads/quests fully out of the prompt and no Director runs;
  // events stay in the database, so re-enabling restores everything.
  const ledgerEnabled = genSettings.ledger?.enabled !== false;
  const fold = foldLedger(ledgerEvents, pathIds);
  const recentText = history.slice(-3).map((h) => h.content).join('\n');
  const ledgerInjection = ledgerEnabled ? buildLedgerBlock(fold, recentText, 200) : null;
  const sceneLine = ledgerEnabled
    ? Object.entries(fold.scene)
        .map(([field, value]) => `${field}: ${value}`)
        .join(' · ')
    : '';

  return buildPrompt({
    character: responder,
    persona,
    activePromptContent: activePrompt?.data.content ?? null,
    memoryItems: memoryItems.map((m) => ({ id: m.id, text: m.text, importance: m.importance })),
    firedLore,
    summary: summary?.content ?? null,
    history,
    postHistory: responder.post_history_instructions,
    ledgerBlock: ledgerInjection ? ledgerInjection.content || null : null,
    sceneBlock: sceneLine || null,
    groupBlock,
    promptEntries,
    contextTokens: genSettings.context_tokens ?? 0,
    maxTokens: genSettings.params?.max_tokens ?? 0,
  });
}

async function generateAssistant(
  set: SetFn,
  get: GetFn,
  parentId: string | null,
  ord?: number,
  continueFrom?: Message,
  speakerCharacterId?: string | null,
): Promise<void> {
  const { activeChatId, character } = get();
  if (!activeChatId || !character) return;
  const config = await loadChatConfig(activeChatId);
  let profile, model;
  try {
    ({ profile, model } = await resolveProvider('main', config.overrides.main ?? null));
  } catch (e) {
    set({ error: String(e instanceof Error ? e.message : e) });
    return;
  }

  const assistant = await insertMessage({
    chat_id: activeChatId,
    parent_id: parentId,
    ord: ord ?? nextOrd(get().messages, parentId),
    role: 'assistant',
    content: '',
    status: 'streaming',
    model,
    provider_profile_id: profile.id,
    speaker_character_id: speakerCharacterId ?? null,
  });

  let built: BuiltPrompt;
  try {
    built = await buildContext(get, parentId, { speakerCharacterId });
  } catch (e) {
    await setMessageStatus(assistant.id, 'failed', { finish_reason: 'error' });
    set({
      error: String(e instanceof Error ? e.message : e),
      messages: await listMessages(activeChatId),
    });
    return;
  }
  const wire = [...built.wire];
  if (continueFrom) {
    wire.push({
      role: 'user',
      content: '[Continue the previous assistant message exactly where it stopped, without repeating any of it.]',
    });
  }
  set({ lastBuild: built });
  if (continueFrom) {
    wire.push({
      role: 'user',
      content: `[Continue the previous assistant message exactly where it stopped, without repeating any of it.]`,
    });
  }
  const generationId = uuidv7();
  set({
    stream: {
      messageId: assistant.id,
      text: '',
      baseContent: continueFrom?.content ?? '',
      startedAt: Date.now(),
    },
    generationId,
    error: null,
  });

  let unlisten: (() => void) | null = null;
  const persistTimer = setInterval(() => {
    const s = get().stream;
    if (s?.messageId) void updateMessageContent(s.messageId, s.baseContent + s.text);
  }, 500);

  const cleanup = () => {
    clearInterval(persistTimer);
    unlisten?.();
  };

  unlisten = await transport.listen<StreamEvent>(
    `provider://stream/${generationId}`,
    (event) => {
      if (event.type === 'delta' && event.text) {
        const s = get().stream;
        if (s) set({ stream: { ...s, text: s.text + event.text } });
      } else if (event.type === 'done') {
        void (async () => {
          const s = get().stream;
          if (s?.messageId) {
            // M5.6: outgoing rules rewrite the final text before it is saved.
            const finalText = applyRules(s.baseContent + s.text, config.settings.outputRules ?? [], {
              direction: 'out',
              characterId: speakerCharacterId ?? character.id,
            });
            await updateMessageContent(s.messageId, finalText);
            await setMessageStatus(s.messageId, event.finish_reason === 'cancelled' ? 'interrupted' : 'complete', {
              prompt_tokens: built.totalTokens,
              completion_tokens: Math.ceil(finalText.length / 3.7),
              latency_ms: Date.now() - s.startedAt,
              finish_reason: event.finish_reason,
              model,
            });
            await logUsage({
              purpose: 'chat',
              profileId: profile.id,
              model,
              promptTokens: built.totalTokens,
              completionTokens: Math.ceil((s.baseContent + s.text).length / 3.7),
              chatId: activeChatId,
            }).catch(() => {});
            // M5.7: refresh the beat chips for the next turn when enabled.
            if (config.settings.nextBeats?.enabled) void get().generateNextBeats();
          }
          cleanup();
          set({ stream: null, generationId: null, activeLeafId: s?.messageId ?? get().activeLeafId });
          set({ messages: await listMessages(activeChatId) });
          // M5.9: zero-token consistency scan of the finished reply.
          void get().checkConsistency();
          // §9.3: the Director runs after each completed send (gate decides cost)
          void useChat.getState().runDirectorNow().catch(() => {});
        })();
      } else if (event.type === 'error') {
        void (async () => {
          const s = get().stream;
          if (s?.messageId) {
            await setMessageStatus(s.messageId, 'failed', {
              finish_reason: 'error',
              latency_ms: Date.now() - s.startedAt,
            });
          }
          cleanup();
          set({ stream: null, generationId: null, error: event.message ?? 'provider error' });
          set({ messages: await listMessages(activeChatId) });
        })();
      }
      // usage events are folded into done for M1 (mock/openai send both)
    },
  );

  try {
    await transport.invoke('provider_stream', {
      request: {
        generation_id: generationId,
        kind: profile.type,
        base_url: profile.base_url,
        api_key_account: profile.id,
        model,
        messages: wire,
        params: config.settings.params ?? {},
      },
    });
  } catch (e) {
    cleanup();
    set({
      stream: null,
      generationId: null,
      error: String(e instanceof Error ? e.message : e),
    });
    await setMessageStatus(assistant.id, 'failed', { finish_reason: 'error' });
    set({ messages: await listMessages(activeChatId) });
  }
}

function estimateWireTokens(wire: { content: string }[]): number {
  return wire.reduce((sum, m) => sum + Math.ceil(m.content.length / 3.7) + 4, 0);
}
void estimateWireTokens;

export type RewriteMode = 'shorter' | 'longer' | 'vivid' | 'grammar';

const REWRITE_INSTRUCTIONS: Record<RewriteMode, string> = {
  shorter:
    'Rewrite the text to be about half the length while keeping its meaning and voice. Reply with ONLY the rewritten text.',
  longer:
    'Rewrite the text to be longer and more detailed, adding sensory detail and depth without changing what happens. Reply with ONLY the rewritten text.',
  vivid:
    'Rewrite the text to be more vivid and descriptive, with stronger imagery, without changing its meaning. Reply with ONLY the rewritten text.',
  grammar:
    'Fix grammar, spelling and punctuation only. Keep the wording and voice exactly as they are. Reply with ONLY the corrected text.',
};

/** M5.2: member rows joined with character names/avatars for the cast bar. */
async function loadMembers(chatId: string): Promise<GroupMemberView[]> {
  const rows = await listChatMembers(chatId);
  return Promise.all(
    rows.map(async (r) => {
      const c = await getCharacter(r.character_id).catch(() => null);
      return { ...r, name: c?.name ?? 'Unknown', avatar_path: c?.avatar_path ?? null };
    }),
  );
}

/**
 * M5.2: who answers next in a group chat. 'auto' honors a leading @Name
 * mention (case-insensitive, ends at punctuation); otherwise round-robin over
 * the non-muted members via the persisted cursor. Returns the speaker's
 * character id plus the cursor value to persist — or null in manual mode and
 * outside group chats.
 */
function resolveGroupSpeaker(
  members: GroupMemberView[],
  order: 'manual' | 'round-robin' | 'auto',
  cursor: number,
  text: string,
): { speakerId: string; nextCursor: number } | null {
  const pool = members.filter((m) => m.mute !== 1);
  if (pool.length === 0) return null;
  if (order === 'auto') {
    const mention = text.match(/^\s*@([\p{L}\p{N}' -]{1,60})/u);
    if (mention) {
      const wanted = (mention[1] ?? '').trim().toLowerCase();
      const hit = pool.find((m) => {
        const n = m.name.toLowerCase();
        return n === wanted || wanted.startsWith(n + ' ');
      });
      if (hit) return { speakerId: hit.character_id, nextCursor: pool.indexOf(hit) + 1 };
    }
  }
  const idx = ((cursor % pool.length) + pool.length) % pool.length;
  const speaker = pool[idx];
  if (!speaker) return null;
  return { speakerId: speaker.character_id, nextCursor: idx + 1 };
}

/**
 * M5.1 compare mode: fire N parallel generations of the current context and
 * stream them into `compare` state. Nothing touches the message tree until
 * the user picks a candidate — on pick, all done candidates become sibling
 * swipes under the current leaf.
 */
let compareUnlisten: Array<() => void> = [];

async function runCompareInternal(
  set: SetFn,
  get: GetFn,
  count: number,
  leafId: string | null,
): Promise<void> {
  const { activeChatId, members, genSettings } = get();
  if (!activeChatId) return;
  const config = await loadChatConfig(activeChatId);
  // M5.2: in a group chat every candidate speaks as the next member in turn
  // (no @mention detection — compare has no message text). The cursor does
  // not advance here; picking a candidate doesn't consume a round-robin step.
  const order = genSettings.group?.turnOrder ?? (members.length > 0 ? 'round-robin' : null);
  const groupPick =
    order && order !== 'manual'
      ? resolveGroupSpeaker(members, order, genSettings.group?.cursor ?? 0, '')
      : null;
  let profile, model, built;
  try {
    ({ profile, model } = await resolveProvider('main', config.overrides.main ?? null));
    built = await buildContext(get, leafId, { speakerCharacterId: groupPick?.speakerId ?? null });
  } catch (e) {
    set({ error: String(e instanceof Error ? e.message : e) });
    return;
  }

  const n = Math.min(4, Math.max(2, count));
  const candidates: CompareCandidate[] = Array.from({ length: n }, () => ({
    genId: uuidv7(),
    text: '',
    status: 'streaming' as const,
  }));
  set({
    compare: { count: n, candidates, active: true, speakerCharacterId: groupPick?.speakerId ?? null },
    error: null,
  });

  const patch = (i: number, p: Partial<CompareCandidate>) => {
    const cur = get().compare;
    if (!cur) return;
    const next = cur.candidates.map((c, j) => (j === i ? { ...c, ...p } : c));
    set({ compare: { ...cur, candidates: next, active: next.some((c) => c.status === 'streaming') } });
  };

  compareUnlisten = await Promise.all(
    candidates.map((c, i) =>
      transport.listen<StreamEvent>(`provider://stream/${c.genId}`, (event) => {
        if (event.type === 'delta' && event.text) {
          const cur = get().compare?.candidates[i];
          if (cur) patch(i, { text: cur.text + event.text });
        } else if (event.type === 'done') {
          const cur = get().compare?.candidates[i];
          const completionTokens = Math.ceil((cur?.text ?? '').length / 3.7);
          patch(i, { status: 'done', completionTokens });
          void logUsage({
            purpose: 'chat',
            profileId: profile.id,
            model,
            promptTokens: built.totalTokens,
            completionTokens,
            chatId: activeChatId,
          }).catch(() => {});
        } else if (event.type === 'error') {
          patch(i, { status: 'error', message: event.message ?? 'provider error' });
        }
      }),
    ),
  );

  // Fire all N generations in parallel; events flow through the listeners.
  await Promise.allSettled(
    candidates.map((c) =>
      transport.invoke('provider_stream', {
        request: {
          generation_id: c.genId,
          kind: profile.type,
          base_url: profile.base_url,
          api_key_account: profile.id,
          model,
          messages: built.wire,
          params: config.settings.params ?? {},
        },
      }),
    ),
  );
}

/** Unsubscribes compare stream listeners (called on pick/cancel). */
function cleanupCompareListeners(): void {
  for (const fn of compareUnlisten) fn();
  compareUnlisten = [];
}

function safeParseSuggestion(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Collects a full (non-streamed-to-UI) generation: used by summaries. */
async function streamCollect(
  wire: { role: string; content: string }[],
  profile: { type: string; base_url: string; id: string },
  model: string,
): Promise<string> {
  const generationId = uuidv7();
  return await new Promise<string>((resolve, reject) => {
    let text = '';
    let unlisten: (() => void) | null = null;
    void transport
      .listen<{ type: string; text?: string; message?: string }>(
        `provider://stream/${generationId}`,
        (event) => {
          if (event.type === 'delta' && event.text) text += event.text;
          else if (event.type === 'done') {
            unlisten?.();
            resolve(text);
          } else if (event.type === 'error') {
            unlisten?.();
            reject(new Error(event.message ?? 'provider error'));
          }
        },
      )
      .then((off) => {
        unlisten = off;
      });
    void transport
      .invoke('provider_stream', {
        request: {
          generation_id: generationId,
          kind: profile.type,
          base_url: profile.base_url,
          api_key_account: profile.id,
          model,
          messages: wire,
          params: {},
        },
      })
      .catch((e) => {
        unlisten?.();
        reject(new Error(String(e)));
      });
  });
}

async function finalizeStream(set: SetFn, get: GetFn, status: 'interrupted'): Promise<void> {
  const { stream, activeChatId } = get();
  if (!stream?.messageId || !activeChatId) return;
  await updateMessageContent(stream.messageId, stream.baseContent + stream.text);
  await setMessageStatus(stream.messageId, status, {
    latency_ms: Date.now() - stream.startedAt,
    finish_reason: 'cancelled',
  });
  set({ stream: null, generationId: null, messages: await listMessages(activeChatId) });
}

async function impersonateInternal(set: SetFn, get: GetFn): Promise<string | null> {
  const { activeChatId, activeLeafId } = get();
  if (!activeChatId || !activeLeafId) return null;
  const config = await loadChatConfig(activeChatId);
  let profile, model;
  try {
    ({ profile, model } = await resolveProvider('main', config.overrides.main ?? null));
  } catch (e) {
    set({ error: String(e instanceof Error ? e.message : e) });
    return null;
  }
  let built: BuiltPrompt;
  try {
    built = await buildContext(get, activeLeafId);
  } catch (e) {
    set({ error: String(e instanceof Error ? e.message : e) });
    return null;
  }
  set({ lastBuild: built });
  const wire = [
    ...built.wire,
    {
      role: 'user' as const,
      content: '[Write the next message as the user ({{user}}). Output only their message, in first person.]',
    },
  ];
  wire.push({
    role: 'user',
    content: '[Write the next message as the user ({{user}}). Output only their message, in first person.]',
  });
  const generationId = uuidv7();
  set({
    stream: { messageId: null, text: '', baseContent: '', startedAt: Date.now() },
    generationId,
  });
  return await new Promise<string | null>((resolve) => {
    let unlisten: (() => void) | null = null;
    void transport
      .listen<StreamEvent>(`provider://stream/${generationId}`, (event) => {
        const s = get().stream;
        if (!s) return;
        if (event.type === 'delta' && event.text) {
          set({ stream: { ...s, text: s.text + event.text } });
        } else if (event.type === 'done' || event.type === 'error') {
          unlisten?.();
          const text = event.type === 'done' ? (get().stream?.text ?? null) : null;
          set({ stream: null, generationId: null });
          resolve(text);
        }
      })
      .then((off) => {
        unlisten = off;
      });
    void transport
      .invoke('provider_stream', {
        request: {
          generation_id: generationId,
          kind: profile.type,
          base_url: profile.base_url,
          api_key_account: profile.id,
          model,
          messages: wire,
          params: config.settings.params ?? {},
        },
      })
      .catch(() => {
        set({ stream: null, generationId: null });
        resolve(null);
      });
  });
}

if (import.meta.env.DEV) {
  (window as unknown as { __hearthChat: typeof useChat }).__hearthChat = useChat;
}

