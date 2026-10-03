-- M5.2: group chats — per-chat cast members with mute + order.
CREATE TABLE chat_members (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  mute INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (chat_id, character_id)
);

CREATE INDEX idx_chat_members_chat ON chat_members (chat_id);
