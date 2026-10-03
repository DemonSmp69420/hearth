-- Hearth schema v1 (M0). See docs/ARCHITECTURE.md §6.
-- Conventions: UUIDv7 text ids generated app-side; INTEGER ms epoch timestamps;
-- soft delete via deleted_at; derived rows anchor to message nodes.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
);

CREATE TABLE proxy_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK (protocol IN ('http', 'https', 'socks5', 'socks5h')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE provider_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  default_model TEXT,
  custom_headers TEXT NOT NULL DEFAULT '{}',
  default_params TEXT NOT NULL DEFAULT '{}',
  proxy_id TEXT REFERENCES proxy_profiles (id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE model_slots (
  slot TEXT PRIMARY KEY CHECK (slot IN ('main', 'utility', 'embedding')),
  profile_id TEXT REFERENCES provider_profiles (id) ON DELETE SET NULL,
  model TEXT,
  params TEXT
);

CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_asset_id TEXT,
  pronouns TEXT,
  role TEXT,
  appearance TEXT,
  personality TEXT,
  backstory TEXT,
  preferences TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'character')),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_asset_id TEXT,
  banner_asset_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  scenario TEXT NOT NULL DEFAULT '',
  first_message TEXT NOT NULL DEFAULT '',
  alt_greetings TEXT NOT NULL DEFAULT '[]',
  example_dialogue TEXT NOT NULL DEFAULT '',
  system_prompt_override TEXT,
  post_history_instructions TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  creator_notes TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  extra TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE character_assets (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'banner', 'gallery', 'sprite', 'background')),
  path TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  character_id TEXT REFERENCES characters (id) ON DELETE RESTRICT,
  persona_id TEXT REFERENCES personas (id) ON DELETE SET NULL,
  active_leaf_id TEXT,
  slot_overrides TEXT,
  prompt_preset_id TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_message_at INTEGER,
  deleted_at INTEGER
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES messages (id) ON DELETE RESTRICT,
  ord INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'narrator')),
  speaker_character_id TEXT,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'complete'
    CHECK (status IN ('complete', 'streaming', 'interrupted', 'failed')),
  model TEXT,
  provider_profile_id TEXT,
  params_snapshot TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  finish_reason TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  bookmarked INTEGER NOT NULL DEFAULT 0,
  bookmark_note TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_messages_tree ON messages (chat_id, parent_id, ord);
CREATE INDEX idx_messages_chat ON messages (chat_id, deleted_at, created_at);

CREATE TABLE message_edits (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  prior_content TEXT NOT NULL,
  edited_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'persona', 'character', 'chat')),
  scope_id TEXT,
  kind TEXT NOT NULL DEFAULT 'fact',
  text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  pinned INTEGER NOT NULL DEFAULT 0,
  importance INTEGER NOT NULL DEFAULT 2 CHECK (importance BETWEEN 1 AND 3),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai')),
  anchor_message_id TEXT,
  confidence REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE summaries (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  anchor_message_id TEXT NOT NULL,
  covers_from_id TEXT,
  covers_to_id TEXT,
  content TEXT NOT NULL,
  token_count INTEGER,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_summaries ON summaries (chat_id, anchor_message_id);

CREATE TABLE lorebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE lore_entries (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES lorebooks (id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  keywords_primary TEXT NOT NULL DEFAULT '[]',
  keywords_secondary TEXT NOT NULL DEFAULT '[]',
  regexes TEXT NOT NULL DEFAULT '[]',
  constant INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 50,
  position TEXT NOT NULL DEFAULT 'before_char',
  scan_depth INTEGER NOT NULL DEFAULT 2,
  probability INTEGER NOT NULL DEFAULT 100,
  inclusion_group TEXT,
  token_budget INTEGER,
  cooldown INTEGER NOT NULL DEFAULT 0,
  sticky INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE lore_attachments (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES lorebooks (id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'character', 'persona', 'chat')),
  scope_id TEXT
);

-- Append-only, event-sourced (ledger + scene state + detector-run markers).
CREATE TABLE ledger_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  anchor_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('thread_create', 'thread_update', 'thread_merge', 'thread_delete', 'scene_set', 'detector_run')),
  payload TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai', 'heuristic')),
  confidence REAL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ledger ON ledger_events (chat_id, anchor_message_id, seq);

CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  anchor_message_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'thread')),
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'saved', 'edited', 'dismissed')),
  created_at INTEGER NOT NULL
);

CREATE TABLE prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'completion')),
  body TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('params', 'prompt')),
  data TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE prompt_entries (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'character', 'chat')),
  scope_id TEXT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'system' CHECK (role IN ('system', 'user', 'assistant')),
  enabled INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  anchor TEXT NOT NULL DEFAULT 'before:history',
  depth INTEGER,
  timing TEXT NOT NULL DEFAULT 'always' CHECK (timing IN ('always', 'once', 'every_n')),
  period INTEGER NOT NULL DEFAULT 1,
  phase INTEGER NOT NULL DEFAULT 0,
  token_budget INTEGER,
  trim_priority INTEGER NOT NULL DEFAULT 50,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_color TEXT NOT NULL,
  scheme_variant TEXT NOT NULL DEFAULT 'tonal_spot',
  contrast TEXT NOT NULL DEFAULT 'standard',
  custom TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE usage_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('chat', 'summary', 'director', 'title', 'suggest', 'embedding', 'test')),
  profile_id TEXT,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL,
  chat_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_usage_ts ON usage_log (ts);
CREATE INDEX idx_usage_chat ON usage_log (chat_id);
