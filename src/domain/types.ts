export type Role = 'user' | 'assistant' | 'system' | 'narrator';
export type MessageStatus = 'complete' | 'streaming' | 'interrupted' | 'failed';

export interface CharacterCard {
  id: string;
  name: string;
  avatar_asset_id: string | null;
  /** Resolved from character_assets at query time; a data: URL (D-023). */
  avatar_path: string | null;
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
  favorite: number;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Persona {
  id: string;
  name: string;
  pronouns: string | null;
  role: string | null;
  appearance: string | null;
  personality: string | null;
  backstory: string | null;
  preferences: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface Chat {
  id: string;
  title: string;
  character_id: string;
  persona_id: string | null;
  active_leaf_id: string | null;
  pinned: number;
  archived: number;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
  last_message_at: number | null;
}

/** M5.2 group chats: one row per character in the cast of a chat. */
export interface ChatMember {
  id: string;
  chat_id: string;
  character_id: string;
  mute: number;
  color: string | null;
  sort: number;
}

/** M5.4: a chapter marks where a new story beat begins in a chat. */
export interface Chapter {
  id: string;
  chat_id: string;
  title: string;
  anchor_message_id: string;
  summary: string | null;
  ord: number;
}

export interface Message {
  id: string;
  chat_id: string;
  parent_id: string | null;
  ord: number;
  role: Role;
  speaker_character_id: string | null;
  content: string;
  status: MessageStatus;
  model: string | null;
  provider_profile_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  finish_reason: string | null;
  hidden: number;
  pinned: number;
  bookmarked: number;
  meta: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export type ProviderType = 'mock' | 'openai_compat' | 'anthropic' | 'gemini';

export interface ProviderProfile {
  id: string;
  name: string;
  type: ProviderType;
  base_url: string;
  default_model: string | null;
  proxy_id: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export type ModelSlot = 'main' | 'utility' | 'embedding';

export interface ModelSlotRow {
  slot: ModelSlot;
  profile_id: string | null;
  model: string | null;
}

/** Per-chat generation settings (chats.settings JSON). */
/** M5.6: a find/replace rewrite applied to outgoing or incoming text. */
export interface OutputRule {
  id: string;
  find: string;
  replace: string;
  regex: boolean;
  direction: 'out' | 'in';
  /** null = any speaker; otherwise only that character's output. */
  characterId: string | null;
  enabled: boolean;
}

export interface ChatGenSettings {
  params?: { temperature?: number; top_p?: number; max_tokens?: number };
  context_tokens?: number;
  /** The named prompt currently in use for this chat (presets.id). */
  active_prompt_id?: string | null;
  /** Story ledger config (§9.5): on/off + suggestion auto-accept threshold. */
  ledger?: { enabled?: boolean; autoAccept?: number };
  /** Per-chat accent (M4.4): tint the chat with the character-derived color. */
  accent?: { enabled?: boolean };
  /** M5.2 group chat config: how the cast takes turns. */
  group?: { turnOrder?: 'manual' | 'round-robin' | 'auto'; cursor?: number };
  /** M5.6 output rules: ordered find/replace rewrites. */
  outputRules?: OutputRule[];
  /** M5.7 "next beat" suggestion chips (off by default). */
  nextBeats?: { enabled?: boolean };
  /** M5.9 consistency guard (on unless disabled). */
  consistency?: { enabled?: boolean };
}

/** Per-chat model override (chats.slot_overrides JSON, D-013). */
export interface ChatOverrides {
  main?: { profile_id: string; model?: string };
}

/**
 * A named prompt — the user-facing "advanced/custom/system prompt" is ONE
 * concept (D-025). Its content replaces the default chat intro while active;
 * the character card is always included regardless.
 */
export interface PromptPresetData {
  content: string;
}
