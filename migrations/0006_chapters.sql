-- M5.4: chapters anchor at a message; a chapter covers the messages AFTER its
-- anchor up to (not including) the next chapter's anchor. Branch-aware: a
-- chapter only appears while its anchor lies on the active path.
CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  anchor_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  summary TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_chapters_chat ON chapters(chat_id, ord);
