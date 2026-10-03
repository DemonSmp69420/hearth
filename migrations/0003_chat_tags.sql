-- M4.6: per-chat tags (JSON array of strings), mirroring characters.tags.
ALTER TABLE chats ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
